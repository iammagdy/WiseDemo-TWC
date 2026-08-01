// Agentic recon pass: drive a real cloud browser, sign in when credentials are
// provided, and read the actual DOM so scene planning uses real selectors.

import type { RuntimeBrowserMetrics } from "@/composition/source-viewport";

import {
  DEFAULT_RECORDING_LOCALE,
  localePersistenceSources,
  verifyApplicationLocale,
  type ApplicationLocaleState,
  type RecordingLocale,
} from "./recording-locale";
import {
  cdpCall,
  configureCdpRecordingLocale,
  delay,
  openCdp,
  type DecryptedCredentials,
} from "./steel-recorder.server";
import { isVerifiedLoginOutcome } from "./demo-state";
import { isSafeReconNavigation } from "./recon-safety";

export type PageOutline = {
  url: string;
  title: string;
  headings: string[];
  navLinks: { text: string; href: string }[];
  clickables: { text: string; selector: string }[];
  inputs: { label: string; selector: string }[];
};

export type ReconResult = {
  loggedIn: boolean;
  pages: PageOutline[];
  notes: string[];
};

export type AuthenticatedSiteResult = {
  outline: PageOutline;
  localeState: ApplicationLocaleState;
  localePersistence: string[];
  browserMetrics: RuntimeBrowserMetrics;
};

const EXTRACT_EXPRESSION = `(() => {
  const text = (el) => (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  };
  const cssPath = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    if (el.getAttribute("data-testid")) return '[data-testid="' + el.getAttribute("data-testid") + '"]';
    if (el.getAttribute("aria-label")) return '[aria-label="' + el.getAttribute("aria-label").replace(/"/g, "") + '"]';
    if (el.getAttribute("name")) return el.tagName.toLowerCase() + '[name="' + el.getAttribute("name") + '"]';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const headings = Array.from(document.querySelectorAll("h1, h2, h3")).filter(visible).map(text).filter(Boolean).slice(0, 14);
  const navLinks = Array.from(document.querySelectorAll("a[href]")).filter(visible).map((a) => ({ text: text(a), href: a.href })).filter((l) => l.text && l.href.startsWith("http")).slice(0, 25);
  const clickables = Array.from(document.querySelectorAll("button, a[href], [role=button], [role=tab], [role=menuitem]")).filter(visible).map((el) => ({ text: text(el), selector: cssPath(el) })).filter((c) => c.text).slice(0, 25);
  const inputs = Array.from(document.querySelectorAll("input, textarea, select")).filter(visible).map((el) => ({
    label: (el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("name") || el.type || "field"),
    selector: cssPath(el),
  })).slice(0, 15);
  return JSON.stringify({ url: location.href, title: document.title, headings, navLinks, clickables, inputs });
})()`;

type Cdp = { socket: WebSocket; sid: string; nextId: () => number };

async function attach(
  websocketUrl: string,
  recordingLocale: RecordingLocale = DEFAULT_RECORDING_LOCALE,
): Promise<Cdp> {
  const socket = await openCdp(websocketUrl);
  let id = 1;
  const nextId = () => id++;
  const targets = (await cdpCall(socket, nextId(), "Target.getTargets")) as {
    targetInfos?: Array<{ targetId: string; type: string }>;
  };
  const page = targets.targetInfos?.find((t) => t.type === "page");
  if (!page) throw new Error("Cloud browser has no page yet.");
  const attached = (await cdpCall(socket, nextId(), "Target.attachToTarget", {
    targetId: page.targetId,
    flatten: true,
  })) as { sessionId: string };
  const sid = attached.sessionId;
  await cdpCall(socket, nextId(), "Page.enable", {}, sid);
  await cdpCall(socket, nextId(), "Runtime.enable", {}, sid);
  await configureCdpRecordingLocale(socket, nextId, sid, recordingLocale);
  return { socket, sid, nextId };
}

async function evaluate(cdp: Cdp, expression: string): Promise<unknown> {
  const result = (await cdpCall(
    cdp.socket,
    cdp.nextId(),
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    cdp.sid,
  )) as { result?: { value?: unknown } };
  return result.result?.value;
}

async function goto(cdp: Cdp, url: string, waitMs = 3000) {
  const navigation = (await cdpCall(
    cdp.socket,
    cdp.nextId(),
    "Page.navigate",
    { url },
    cdp.sid,
  )) as { errorText?: string };
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  const ready = await waitUntil(
    cdp,
    'document.readyState === "interactive" || document.readyState === "complete"',
    15_000,
  );
  if (!ready) throw new Error("Page did not become ready during product recon.");
  await delay(Math.min(waitMs, 1_500));
}

async function waitUntil(cdp: Cdp, expression: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await evaluate(cdp, expression)) === true) return true;
    } catch {
      // Navigation can briefly replace the execution context; retry it.
    }
    await delay(300);
  }
  return false;
}

async function outline(cdp: Cdp): Promise<PageOutline | null> {
  const raw = await evaluate(cdp, EXTRACT_EXPRESSION);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as PageOutline;
  } catch {
    return null;
  }
}

async function inspectApplicationLocale(cdp: Cdp): Promise<ApplicationLocaleState> {
  const value = await evaluate(
    cdp,
    `(() => {
      const clean = (value, max = 80) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 4 && rect.height > 4 && style.display !== "none" && style.visibility !== "hidden";
      };
      const localeKey = (key) => /(^|[_-])(lang|language|locale|i18n)([_-]|$)/i.test(key) || /^(lang|language|locale|i18nextLng)$/i.test(key);
      const navigationLabels = Array.from(document.querySelectorAll("nav a, nav button, aside a, aside button, [role=navigation] a, [role=navigation] button, [role=menuitem]"))
        .filter(visible)
        .map((element) => clean(element.innerText || element.textContent || element.getAttribute("aria-label")))
        .filter(Boolean)
        .slice(0, 30);
      const localeCookies = document.cookie.split(";").map((part) => part.trim()).map((part) => {
        const separator = part.indexOf("=");
        return { key: clean(separator >= 0 ? part.slice(0, separator) : part, 64), value: clean(separator >= 0 ? part.slice(separator + 1) : "", 32) };
      }).filter((entry) => localeKey(entry.key)).slice(0, 12);
      const localeStorage = [];
      try {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index) || "";
          if (localeKey(key)) localeStorage.push({ key: clean(key, 64), value: clean(localStorage.getItem(key), 32) });
        }
      } catch {}
      const url = new URL(location.href);
      const urlLocale = ["lang", "language", "locale"].map((key) => url.searchParams.get(key)).find(Boolean) || null;
      const languageControls = Array.from(document.querySelectorAll("select, button, [role=button]"))
        .filter((element) => /language|locale|اللغة|english|الإنجليزية|arabic|العربية/i.test(clean(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent, 80)))
        .map((element) => ({
          kind: element.tagName.toLowerCase(),
          label: clean(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent, 80),
          values: element instanceof HTMLSelectElement ? Array.from(element.options).map((option) => clean(option.value, 24)).slice(0, 8) : [],
        }))
        .slice(0, 12);
      return {
        pathname: clean(location.pathname, 160),
        documentLanguage: clean(document.documentElement.lang, 24),
        navigatorLanguage: clean(navigator.language, 24),
        navigatorLanguages: Array.from(navigator.languages || []).map((entry) => clean(entry, 24)).slice(0, 8),
        navigationLabels,
        localeCookies,
        localeStorage,
        urlLocale: urlLocale ? clean(urlLocale, 24) : null,
        languageControls,
      };
    })()`,
  );
  if (!value || typeof value !== "object")
    throw new Error("Could not inspect application language state.");
  return value as ApplicationLocaleState;
}

async function waitForVerifiedApplicationLocale(
  cdp: Cdp,
  locale: RecordingLocale,
  timeoutMs = 10_000,
): Promise<ApplicationLocaleState> {
  const deadline = Date.now() + timeoutMs;
  let state = await inspectApplicationLocale(cdp);
  while (Date.now() < deadline) {
    if (verifyApplicationLocale(state, locale).verified) return state;
    await delay(350);
    state = await inspectApplicationLocale(cdp);
  }
  return state;
}

async function captureBrowserMetrics(cdp: Cdp): Promise<RuntimeBrowserMetrics> {
  const value = await evaluate(
    cdp,
    `(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: window.screenX,
      screenY: window.screenY,
      devicePixelRatio: window.devicePixelRatio || 1,
      visualViewportWidth: window.visualViewport?.width || window.innerWidth,
      visualViewportHeight: window.visualViewport?.height || window.innerHeight,
      visualViewportOffsetLeft: window.visualViewport?.offsetLeft || 0,
      visualViewportOffsetTop: window.visualViewport?.offsetTop || 0,
    }))()`,
  );
  if (!value || typeof value !== "object")
    throw new Error("Could not capture the recording viewport metrics.");
  return value as RuntimeBrowserMetrics;
}

async function selectVisibleApplicationLanguage(
  cdp: Cdp,
  locale: Exclude<RecordingLocale, "auto">,
) {
  const desired = locale === "english" ? "en" : "ar";
  const targetText = locale === "english" ? /english/i : /arabic|العربية|عربي/i;
  const result = await evaluate(
    cdp,
    `(() => {
      const desired = ${JSON.stringify(desired)};
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 4 && rect.height > 4 && style.display !== "none" && style.visibility !== "hidden";
      };
      const label = (element) => [element.innerText, element.textContent, element.getAttribute("aria-label"), element.getAttribute("title"), element.id, element.getAttribute("name")].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
      const select = Array.from(document.querySelectorAll("select")).find((element) => visible(element) && /language|locale|اللغة/i.test(label(element)));
      if (select) {
        const option = Array.from(select.options).find((entry) => desired === "en" ? /english|^en([-_]|$)/i.test(entry.text + " " + entry.value) : /arabic|العربية|^ar([-_]|$)/i.test(entry.text + " " + entry.value));
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return "selected";
        }
      }
      const direct = Array.from(document.querySelectorAll("[role=menu] button, [role=menuitem], [role=listbox] [role=option]"))
        .find((element) => visible(element) && (${targetText}.test(label(element))));
      if (direct) { direct.click(); return "selected"; }
      const trigger = Array.from(document.querySelectorAll("button, [role=button], [aria-haspopup], a"))
        .find((element) => visible(element) && /language|locale|اللغة|العربية/i.test(label(element)));
      if (trigger) { trigger.click(); return "opened"; }
      return "missing";
    })()`,
  );
  if (result === "opened") {
    await delay(600);
    const selected = await evaluate(
      cdp,
      `(() => {
        const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 4 && rect.height > 4 && style.display !== "none" && style.visibility !== "hidden"; };
        const label = (element) => String(element.innerText || element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
        const option = Array.from(document.querySelectorAll("button, a, [role=menuitem], [role=option]"))
          .find((element) => visible(element) && (${targetText}.test(label(element))));
        if (!option) return false;
        option.click();
        return true;
      })()`,
    );
    if (selected !== true) return false;
  } else if (result !== "selected") return false;
  await delay(1_200);
  await waitUntil(
    cdp,
    'document.readyState === "interactive" || document.readyState === "complete"',
    8_000,
  );
  return true;
}

async function applyLocalePersistenceHints(
  cdp: Cdp,
  state: ApplicationLocaleState,
  locale: Exclude<RecordingLocale, "auto">,
) {
  const desired = locale === "english" ? "en" : "ar";
  if (!state.localeStorage.length && !state.localeCookies.length && !state.urlLocale) return false;
  const changed = await evaluate(
    cdp,
    `(() => {
      const desired = ${JSON.stringify(desired)};
      const storageKeys = ${JSON.stringify(state.localeStorage.map((entry) => entry.key))};
      const cookieKeys = ${JSON.stringify(state.localeCookies.map((entry) => entry.key))};
      for (const key of storageKeys) { try { localStorage.setItem(key, desired); } catch {} }
      for (const key of cookieKeys) document.cookie = encodeURIComponent(key) + "=" + desired + "; path=/; SameSite=Lax";
      const url = new URL(location.href);
      let urlChanged = false;
      for (const key of ["lang", "language", "locale"]) if (url.searchParams.has(key)) { url.searchParams.set(key, desired); urlChanged = true; }
      if (urlChanged) location.assign(url.toString()); else location.reload();
      return true;
    })()`,
  );
  if (changed !== true) return false;
  await delay(1_500);
  await waitUntil(
    cdp,
    'document.readyState === "interactive" || document.readyState === "complete"',
    10_000,
  );
  return true;
}

async function openWiseResumeLanguageSettings(cdp: Cdp): Promise<boolean> {
  const host = await evaluate(cdp, "location.hostname");
  if (typeof host !== "string" || !/(^|\.)wiseresume\.app$/i.test(host)) return false;
  // WiseResume persists `wiseresume-locale` locally and synchronizes the same
  // value to its authenticated user_preferences profile. Use the real Settings
  // select so both stores change through the application's own code path.
  const clicked = await evaluate(
    cdp,
    `(() => {
      const visible = (element) => { const rect = element.getBoundingClientRect(); return rect.width > 4 && rect.height > 4; };
      const label = (element) => String(element.innerText || element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
      const settings = Array.from(document.querySelectorAll("a[href], button, [role=button], [role=menuitem]"))
        .find((element) => visible(element) && (/settings|الإعدادات/i.test(label(element)) || /settings/i.test(element.getAttribute("href") || "")));
      if (!settings) return false;
      settings.click();
      return true;
    })()`,
  );
  if (clicked === true) await delay(900);
  const selectorReady = await waitUntil(
    cdp,
    `Array.from(document.querySelectorAll("select")).some((select) => Array.from(select.options).some((option) => /english|^en([-_]|$)/i.test(option.text + " " + option.value)))`,
    12_000,
  );
  if (selectorReady) return true;

  const origin = await evaluate(cdp, "location.origin");
  if (typeof origin !== "string") return false;
  await goto(cdp, new URL("/settings", origin).toString(), 1_500);
  return waitUntil(
    cdp,
    `Array.from(document.querySelectorAll("select")).some((select) => Array.from(select.options).some((option) => /english|^en([-_]|$)/i.test(option.text + " " + option.value)))`,
    15_000,
  );
}

async function applyWiseResumeProfileLocale(
  cdp: Cdp,
  locale: Exclude<RecordingLocale, "auto">,
): Promise<boolean> {
  const host = await evaluate(cdp, "location.hostname");
  if (typeof host !== "string" || !/(^|\.)wiseresume\.app$/i.test(host)) return false;
  const language = locale === "english" ? "en" : "ar";
  // Verified against WiseResume's public production bundle. This fallback uses
  // the already-authenticated browser session and the application's own
  // user_preferences document when its feature-gated Settings selector is not
  // rendered. No account identifiers or response data leave the page.
  const updated = await evaluate(
    cdp,
    `(async () => {
      const endpoint = "https://fra.cloud.appwrite.io/v1";
      const project = "69fd362b001eb325a192";
      const headers = { "X-Appwrite-Project": project, "Content-Type": "application/json" };
      const accountResponse = await fetch(endpoint + "/account", { credentials: "include", headers });
      if (!accountResponse.ok) return false;
      const account = await accountResponse.json();
      if (!account || typeof account.$id !== "string") return false;
      const query = encodeURIComponent(JSON.stringify({ method: "equal", attribute: "user_id", values: [account.$id] }));
      const listResponse = await fetch(endpoint + "/databases/main/collections/user_preferences/documents?queries[]=" + query, { credentials: "include", headers });
      if (!listResponse.ok) return false;
      const list = await listResponse.json();
      const documentId = list?.documents?.[0]?.$id;
      if (typeof documentId !== "string") return false;
      const updateResponse = await fetch(endpoint + "/databases/main/collections/user_preferences/documents/" + encodeURIComponent(documentId), {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({ data: { language: ${JSON.stringify(language)} } }),
      });
      if (!updateResponse.ok) return false;
      localStorage.setItem("wiseresume-locale", ${JSON.stringify(language)});
      location.reload();
      return true;
    })()`,
  );
  if (updated !== true) return false;
  await delay(1_500);
  await waitUntil(
    cdp,
    'document.readyState === "interactive" || document.readyState === "complete"',
    12_000,
  );
  return true;
}

async function ensureApplicationLocale(
  cdp: Cdp,
  locale: RecordingLocale,
): Promise<ApplicationLocaleState> {
  let state = await inspectApplicationLocale(cdp);
  if (verifyApplicationLocale(state, locale).verified) return state;
  if (locale === "auto") return state;

  await selectVisibleApplicationLanguage(cdp, locale);
  state = await waitForVerifiedApplicationLocale(cdp, locale);
  if (verifyApplicationLocale(state, locale).verified) return state;

  if (await openWiseResumeLanguageSettings(cdp)) {
    await selectVisibleApplicationLanguage(cdp, locale);
    state = await waitForVerifiedApplicationLocale(cdp, locale, 12_000);
    if (verifyApplicationLocale(state, locale).verified) return state;
  }

  if (await applyWiseResumeProfileLocale(cdp, locale)) {
    state = await waitForVerifiedApplicationLocale(cdp, locale, 12_000);
    if (verifyApplicationLocale(state, locale).verified) return state;
  }

  await applyLocalePersistenceHints(cdp, state, locale);
  state = await inspectApplicationLocale(cdp);
  const verification = verifyApplicationLocale(state, locale);
  if (!verification.verified) {
    const storage =
      state.localeStorage.map((entry) => `${entry.key}=${entry.value}`).join(",") || "none";
    const controls =
      state.languageControls
        .map((control) => `${control.kind}:${control.label}[${control.values.join("|")}]`)
        .join(",") || "none";
    throw Object.assign(
      new Error(
        `Recording locale verification failed: ${verification.reason}. Safe diagnostics: path=${state.pathname || "/"}; document=${state.documentLanguage || "unset"}; navigator=${state.navigatorLanguage || "unset"}; storage=${storage}; controls=${controls}.`,
      ),
      {
        code: locale === "english" ? "ENGLISH_LOCALE_UNVERIFIED" : "ARABIC_LOCALE_UNVERIFIED",
      },
    );
  }
  return state;
}

async function signIn(
  cdp: Cdp,
  target: string,
  credentials: NonNullable<DecryptedCredentials>,
): Promise<PageOutline> {
  await goto(cdp, target, 3500);
  const filled = (await evaluate(
    cdp,
    `(() => {
      const user = document.querySelector('input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[type="text"]');
      const pass = document.querySelector('input[type="password"], input[name="password"]');
      if (!user || !pass) return { filled: false, submitted: false };
      const setValue = (el, value) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (!setter) return false;
        el.focus();
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value === value;
      };
      const userApplied = setValue(user, ${JSON.stringify(credentials.username)});
      const passApplied = setValue(pass, ${JSON.stringify(credentials.secret)});
      const form = pass.closest('form');
      const submit = (form && form.querySelector('button[type="submit"], input[type="submit"]')) ||
        Array.from(document.querySelectorAll('button')).find((button) => /sign in|log in|login|continue/i.test(button.innerText || ''));
      if (submit) submit.click();
      else if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
      return { filled: userApplied && passApplied, submitted: Boolean(submit || form) };
    })()`,
  )) as { filled?: boolean; submitted?: boolean } | null;
  if (!filled?.filled || !filled.submitted) {
    throw new Error("Stored credential fields could not be filled and submitted.");
  }

  const leftLoginForm = await waitUntil(
    cdp,
    `(() => {
      const password = document.querySelector('input[type="password"], input[name="password"]');
      return !password;
    })()`,
    15_000,
  );
  const afterLogin = await outline(cdp);
  if (!afterLogin) {
    throw new Error("Could not inspect the page after credential sign-in.");
  }
  const stillOnLogin = /password/i.test(JSON.stringify(afterLogin.inputs));
  if (
    !isVerifiedLoginOutcome({
      fieldsApplied: filled.filled === true,
      submitted: filled.submitted === true,
      loginFormGone: leftLoginForm,
      outlineHasPasswordField: stillOnLogin,
    })
  ) {
    throw new Error("Stored credential sign-in did not reach an authenticated screen.");
  }
  return afterLogin;
}

/** Signs into a fresh recording session without crawling unrelated product routes. */
export async function authenticateSite(input: {
  websocketUrl: string;
  loginUrl: string;
  credentials: NonNullable<DecryptedCredentials>;
  recordingLocale?: RecordingLocale;
}): Promise<AuthenticatedSiteResult> {
  const recordingLocale = input.recordingLocale ?? DEFAULT_RECORDING_LOCALE;
  const cdp = await attach(input.websocketUrl, recordingLocale);
  try {
    await signIn(cdp, input.loginUrl, input.credentials);
    const localeState = await ensureApplicationLocale(cdp, recordingLocale);
    const authenticatedOutline = await outline(cdp);
    if (!authenticatedOutline) throw new Error("Could not inspect the authenticated application.");
    return {
      outline: authenticatedOutline,
      localeState,
      localePersistence: localePersistenceSources(localeState),
      browserMetrics: await captureBrowserMetrics(cdp),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    throw new Error("Stored credential login failed. Check the login URL and test credentials.");
  } finally {
    try {
      cdp.socket.close();
    } catch {
      /* ignore */
    }
  }
}

/** Opens the product in a real browser, signs in when possible, and reads the real DOM. */
export async function reconSite(input: {
  websocketUrl: string;
  baseUrl: string;
  loginUrl?: string | null;
  credentials: DecryptedCredentials;
  maxPages?: number;
  recordingLocale?: RecordingLocale;
}): Promise<ReconResult> {
  const { websocketUrl, baseUrl, loginUrl, credentials } = input;
  const maxPages = input.maxPages ?? 4;
  const notes: string[] = [];
  const pages: PageOutline[] = [];
  let loggedIn = false;

  const recordingLocale = input.recordingLocale ?? DEFAULT_RECORDING_LOCALE;
  const cdp = await attach(websocketUrl, recordingLocale);
  try {
    await goto(cdp, baseUrl, 3500);
    const landing = await outline(cdp);
    if (landing) pages.push(landing);

    if (credentials) {
      const target = loginUrl ?? credentials.loginUrl ?? baseUrl;
      await signIn(cdp, target, credentials);
      const localeState = await ensureApplicationLocale(cdp, recordingLocale);
      const authenticatedOutline = await outline(cdp);
      if (!authenticatedOutline)
        throw new Error("Could not inspect the authenticated application.");
      pages.push(authenticatedOutline);
      loggedIn = true;
      notes.push(
        `Signed in with the stored credentials; ${recordingLocale} UI verified (${localePersistenceSources(localeState).join(", ") || "application selector"}).`,
      );
    }

    const seen = new Set(pages.map((p) => p.url));
    const origin = new URL(baseUrl).origin;
    const candidates = (pages.at(-1)?.navLinks ?? [])
      .map((l) => l.href)
      .filter((href) => isSafeReconNavigation(href, origin) && !seen.has(href))
      .slice(0, Math.max(0, maxPages - pages.length));

    for (const href of candidates) {
      await goto(cdp, href, 3000);
      const page = await outline(cdp);
      if (page && !seen.has(page.url)) {
        pages.push(page);
        seen.add(page.url);
      }
    }
  } catch (err) {
    if (credentials && !loggedIn) {
      if (err && typeof err === "object" && "code" in err) throw err;
      throw new Error("Stored credential login failed. Check the login URL and test credentials.");
    }
    notes.push(err instanceof Error ? err.message : String(err));
  } finally {
    try {
      cdp.socket.close();
    } catch {
      /* ignore */
    }
  }

  return { loggedIn, pages, notes };
}

export function outlineToMarkdown(name: string, baseUrl: string, recon: ReconResult): string {
  const lines: string[] = [`# ${name} — real product map`, "", `Base URL: ${baseUrl}`, ""];
  lines.push(
    recon.loggedIn
      ? "Authenticated recon: yes (agent signed in)."
      : "Authenticated recon: no (public pages only).",
    "",
  );
  for (const page of recon.pages) {
    lines.push(`## ${page.title || page.url}`, `URL: ${page.url}`, "");
    if (page.headings.length) lines.push("Headings:", ...page.headings.map((h) => `- ${h}`), "");
    if (page.clickables.length)
      lines.push(
        "Clickable elements (real selectors):",
        ...page.clickables.map((c) => `- "${c.text}" → \`${c.selector}\``),
        "",
      );
    if (page.inputs.length)
      lines.push("Inputs:", ...page.inputs.map((i) => `- ${i.label} → \`${i.selector}\``), "");
  }
  if (recon.notes.length) lines.push("## Agent notes", ...recon.notes.map((n) => `- ${n}`));
  return lines.join("\n");
}
