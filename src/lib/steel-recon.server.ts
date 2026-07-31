// Agentic recon pass: drive a real cloud browser, sign in when credentials are
// provided, and read the actual DOM so scene planning uses real selectors.

import { cdpCall, delay, openCdp, type DecryptedCredentials } from "./steel-recorder.server";
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

async function attach(websocketUrl: string): Promise<Cdp> {
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

/** Opens the product in a real browser, signs in when possible, and reads the real DOM. */
export async function reconSite(input: {
  websocketUrl: string;
  baseUrl: string;
  loginUrl?: string | null;
  credentials: DecryptedCredentials;
  maxPages?: number;
}): Promise<ReconResult> {
  const { websocketUrl, baseUrl, loginUrl, credentials } = input;
  const maxPages = input.maxPages ?? 4;
  const notes: string[] = [];
  const pages: PageOutline[] = [];
  let loggedIn = false;

  const cdp = await attach(websocketUrl);
  try {
    await goto(cdp, baseUrl, 3500);
    const landing = await outline(cdp);
    if (landing) pages.push(landing);

    if (credentials) {
      const target = loginUrl ?? credentials.loginUrl ?? baseUrl;
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
            Array.from(document.querySelectorAll('button')).find((b) => /sign in|log in|login|continue/i.test(b.innerText || ''));
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
      if (afterLogin) {
        const stillOnLogin = /password/i.test(JSON.stringify(afterLogin.inputs));
        loggedIn = isVerifiedLoginOutcome({
          fieldsApplied: filled.filled === true,
          submitted: filled.submitted === true,
          loginFormGone: leftLoginForm,
          outlineHasPasswordField: stillOnLogin,
        });
        pages.push(afterLogin);
        if (!loggedIn) {
          throw new Error("Stored credential sign-in did not reach an authenticated screen.");
        }
        notes.push("Signed in with the stored credentials.");
      } else {
        throw new Error("Could not inspect the page after credential sign-in.");
      }
    }

    const seen = new Set(pages.map((p) => p.url));
    const origin = new URL(baseUrl).origin;
    const candidates = (pages.at(-1)?.navLinks ?? [])
      .map((l) => l.href)
      .filter((href) => isSafeReconNavigation(href, origin) && !seen.has(href))
      .slice(0, maxPages - pages.length);

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
