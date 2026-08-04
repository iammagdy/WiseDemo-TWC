// Steel.dev cloud-browser integration. Everything in this module runs on the
// server; callers must never send the Steel API key or authenticated HLS URLs
// to the browser.

import { Mp4RemuxError, remuxFragmentedMp4 } from "./mp4-remux.server.ts";
import type { RuntimeBrowserMetrics } from "../composition/source-viewport.ts";
import {
  DEFAULT_RECORDING_LOCALE,
  localeProfile,
  recordingLocaleCategory,
  type RecordingLocaleDiagnostic,
  type RecordingLocale,
} from "./recording-locale.ts";
import { serverEnv } from "./server-env.server.ts";

const STEEL_BASE = "https://api.steel.dev/v1";
const DEFAULT_CDP_TIMEOUT_MS = 20_000;
const DEFAULT_STEEL_HTTP_TIMEOUT_MS = 20_000;
const RELEASE_STEEL_HTTP_TIMEOUT_MS = 10_000;
// The directed flow reserves 150s for protected bootstrap, 125s for fixture
// preflight, and 30s for the clean take. Keep a small release margin so the
// browser cannot expire during an otherwise in-budget capture.
export const DIRECTED_STEEL_SESSION_TIMEOUT_MS = 360_000;
const MAX_RECORDING_BYTES = 500 * 1024 * 1024;
const CDP_READINESS_ATTEMPTS = 7;
const CDP_READINESS_CONNECT_TIMEOUT_MS = 10_000;

export type SteelSession = {
  id: string;
  websocketUrl?: string;
  debugUrl?: string;
  sessionViewerUrl?: string;
  liveViewUrl?: string;
};

export type DecryptedCredentials = {
  loginUrl: string;
  username: string;
  secret: string;
} | null;

export type ActionExpectation = {
  selector?: string;
  urlIncludes?: string;
};

type ActionOptions = {
  timeoutMs?: number;
  expected?: ActionExpectation;
  fallbackSelectors?: string[];
};

export type CdpAction =
  | ({ type: "goto"; url: string; waitMs?: number } & ActionOptions)
  | ({ type: "wait"; ms?: number; selector?: string } & ActionOptions)
  | ({ type: "scroll"; deltaY: number } & ActionOptions)
  | ({ type: "click"; selector: string } & ActionOptions)
  | ({ type: "type"; selector: string; text: string } & ActionOptions)
  | ({ type: "eval"; expression: string } & ActionOptions);

export type ActionDiagnostic = {
  index: number;
  type: CdpAction["type"];
  success: boolean;
  code: string;
  message: string;
  startedAt?: number;
  completedAt?: number;
  cursor?: { x: number; y: number };
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export type SceneExecutionResult = {
  executed: number;
  completed: boolean;
  diagnostics: ActionDiagnostic[];
  browserMetrics?: RuntimeBrowserMetrics;
  error?: string;
};

export class SteelRecordingError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(code: string, message: string, retryable: boolean, httpStatus?: number) {
    super(message);
    this.name = "SteelRecordingError";
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

function requireSteelKey(): string {
  const key = serverEnv("STEEL_API_KEY");
  if (!key || key.length < 8) {
    throw new Error("Steel API key not configured. Add STEEL_API_KEY to the server environment.");
  }
  return key;
}

function steelHeaders(key: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("steel-api-key", key);
  return headers;
}

async function boundedSteelFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_STEEL_HTTP_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? fetch;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = fetchImpl(input, { ...init, signal: controller.signal });
  // A transport implementation may ignore AbortSignal. Observe its eventual
  // rejection while the timeout race lets the directed lifecycle release its
  // lease instead of holding the studio request indefinitely.
  void request.catch(() => undefined);
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Steel API request timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function createSteelSession(
  _startUrl: string,
  _recordingLocale: RecordingLocale = DEFAULT_RECORDING_LOCALE,
): Promise<SteelSession> {
  const key = requireSteelKey();
  const res = await boundedSteelFetch(`${STEEL_BASE}/sessions`, {
    method: "POST",
    headers: steelHeaders(key, { "content-type": "application/json" }),
    body: JSON.stringify({
      // Deliberately omit startUrl. The target application must not load until
      // CDP locale and request headers have been configured on the blank page.
      dimensions: { width: 1280, height: 800 },
      solveCaptcha: false,
      blockAds: true,
      recordSession: true,
      // Steel's documented field is `timeout`, in milliseconds.
      // This covers the full directed capture budget plus release margin.
      timeout: DIRECTED_STEEL_SESSION_TIMEOUT_MS,
    }),
  });

  if (!res.ok) {
    throw new Error(`Steel session create failed with HTTP ${res.status}.`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data.id !== "string" || !data.id) {
    throw new Error("Steel session create returned no session ID.");
  }
  return {
    id: data.id,
    websocketUrl: typeof data.websocketUrl === "string" ? data.websocketUrl : undefined,
    debugUrl: typeof data.debugUrl === "string" ? data.debugUrl : undefined,
    sessionViewerUrl: typeof data.sessionViewerUrl === "string" ? data.sessionViewerUrl : undefined,
    liveViewUrl:
      typeof data.sessionViewerFullscreenUrl === "string"
        ? data.sessionViewerFullscreenUrl
        : typeof data.debugUrl === "string"
          ? data.debugUrl
          : undefined,
  };
}

export async function releaseSteelSession(
  sessionId: string,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    sleep?: (milliseconds: number) => Promise<unknown>;
  },
): Promise<SteelSession> {
  const key = requireSteelKey();
  const sleep = options?.sleep ?? delay;
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      res = await boundedSteelFetch(
        `${STEEL_BASE}/sessions/${encodeURIComponent(sessionId)}/release`,
        {
          method: "POST",
          headers: steelHeaders(key),
        },
        {
          fetchImpl: options?.fetchImpl,
          timeoutMs: options?.timeoutMs ?? RELEASE_STEEL_HTTP_TIMEOUT_MS,
        },
      );
    } catch (error) {
      if (attempt >= 4) throw error;
      await sleep(250 * 2 ** (attempt - 1));
      continue;
    }
    if (![429, 502, 503, 504].includes(res.status) || attempt >= 4) break;
    await sleep(250 * 2 ** (attempt - 1));
  }
  if (!res) throw new Error("Steel session release returned no response.");

  // Release is idempotent. Steel may report a missing/already-released session
  // after the first successful call.
  if (res.status === 404 || res.status === 409) return { id: sessionId };
  if (!res.ok) {
    throw new Error(`Steel session release failed with HTTP ${res.status}.`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    id: sessionId,
    sessionViewerUrl: typeof data.sessionViewerUrl === "string" ? data.sessionViewerUrl : undefined,
    liveViewUrl:
      typeof data.sessionViewerFullscreenUrl === "string"
        ? data.sessionViewerFullscreenUrl
        : undefined,
  };
}

export async function getSteelSession(sessionId: string): Promise<Record<string, unknown> | null> {
  const key = requireSteelKey();
  const res = await fetch(`${STEEL_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: steelHeaders(key),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Steel session lookup failed with HTTP ${res.status}.`);
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

// ---- CDP over WebSocket ------------------------------------------------

export async function openCdp(websocketUrl: string): Promise<WebSocket> {
  const upgradeUrl = websocketUrl.replace(/^ws/, "http");
  const attempts = CDP_READINESS_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(upgradeUrl, { headers: { Upgrade: "websocket" } });
      const socket = (res as unknown as { webSocket?: WebSocket }).webSocket;
      if (socket) {
        (socket as unknown as { accept: () => void }).accept();
        return socket;
      }
    } catch {
      // Fall through to the standard WebSocket client used by local Node.
    }

    if (typeof WebSocket !== "undefined") {
      try {
        return await new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(websocketUrl);
          const cleanup = () => {
            clearTimeout(timer);
            socket.removeEventListener("open", onOpen);
            socket.removeEventListener("error", onError);
          };
          const onOpen = () => {
            cleanup();
            resolve(socket);
          };
          const onError = () => {
            cleanup();
            try {
              socket.close();
            } catch {
              /* ignore */
            }
            reject(new Error("Could not connect to the cloud browser session."));
          };
          const timer = setTimeout(() => {
            cleanup();
            try {
              socket.close();
            } catch {
              /* ignore */
            }
            reject(new Error("Timed out connecting to the cloud browser."));
          }, CDP_READINESS_CONNECT_TIMEOUT_MS);
          socket.addEventListener("open", onOpen);
          socket.addEventListener("error", onError);
        });
      } catch {
        // Steel can return a session just before its browser endpoint is ready.
      }
    }

    if (attempt < attempts) await delay(Math.min(3_000, 500 * attempt));
  }

  if (typeof WebSocket === "undefined") {
    throw new Error("This runtime cannot open a CDP WebSocket to the cloud browser.");
  }
  throw new Error("Could not connect to the cloud browser session after readiness retries.");
}

export function cdpCall(
  socket: WebSocket,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
  timeoutMs = DEFAULT_CDP_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`CDP timeout on ${method}`));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : "");
        if (msg && msg.id === id) {
          clearTimeout(timeout);
          socket.removeEventListener("message", onMessage);
          if (msg.error) reject(new Error(String(msg.error.message ?? "CDP error")));
          else resolve(msg.result ?? {});
        }
      } catch {
        // Ignore unrelated non-JSON events.
      }
    }

    socket.addEventListener("message", onMessage);
    socket.send(
      JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }),
    );
  });
}

export type CdpLocaleMode = "initialize" | "verify";

export type CdpRecordingLocaleResult = {
  requestedLocale: RecordingLocale;
  effectiveLocale: string | null;
  localeOverride:
    "applied" | "already-effective" | "already-active-verified" | "not-required" | "failed";
  acceptLanguageApplied: boolean;
  userAgentLanguageApplied: boolean;
  verified: boolean;
};

type CdpLocaleCommand = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type CdpLocaleRuntime = {
  language?: unknown;
  languages?: unknown;
  intlLocale?: unknown;
  userAgent?: unknown;
  platform?: unknown;
};

const localeInitializationLocks = new Map<string, Promise<void>>();
const MAX_LOCALE_INITIALIZATION_LOCKS = 64;

export function cdpLocaleConnectionKey(connectionIdentity: string, targetIdentity: string): string {
  let hash = 2_166_136_261;
  for (const character of `${connectionIdentity}|${targetIdentity}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `locale-${(hash >>> 0).toString(36)}`;
}

export class CdpRecordingLocaleError extends Error {
  readonly result: CdpRecordingLocaleResult;
  readonly conflict: boolean;

  constructor(message: string, result: CdpRecordingLocaleResult, conflict = false) {
    super(message);
    this.result = result;
    this.conflict = conflict;
  }
}

function normalizedLocale(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/_/g, "-").toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized) ? normalized : null;
}

function effectiveLocaleFromRuntime(value: unknown): string | null {
  const runtime = value && typeof value === "object" ? (value as CdpLocaleRuntime) : {};
  const languages = Array.isArray(runtime.languages) ? runtime.languages : [];
  return (
    normalizedLocale(runtime.language) ??
    normalizedLocale(runtime.intlLocale) ??
    languages.map(normalizedLocale).find((locale): locale is string => Boolean(locale)) ??
    null
  );
}

function localeMatchesRequested(
  effectiveLocale: string | null,
  requestedLocale: RecordingLocale,
): boolean {
  if (requestedLocale === "auto") return true;
  const language = requestedLocale === "english" ? "en" : "ar";
  return effectiveLocale === language || effectiveLocale?.startsWith(`${language}-`) === true;
}

function duplicateOverrideError(error: unknown): boolean {
  return (
    error instanceof Error && /another locale override is already in effect/i.test(error.message)
  );
}

function localeResult(
  requestedLocale: RecordingLocale,
  effectiveLocale: string | null,
  localeOverride: CdpRecordingLocaleResult["localeOverride"],
  acceptLanguageApplied: boolean,
  userAgentLanguageApplied: boolean,
): CdpRecordingLocaleResult {
  return {
    requestedLocale,
    effectiveLocale,
    localeOverride,
    acceptLanguageApplied,
    userAgentLanguageApplied,
    verified:
      localeOverride !== "failed" && localeMatchesRequested(effectiveLocale, requestedLocale),
  };
}

async function readCdpEffectiveLocale(
  call: CdpLocaleCommand,
): Promise<{ locale: string | null; runtime: CdpLocaleRuntime }> {
  const response = (await call("Runtime.evaluate", {
    expression:
      "({language:navigator.language,languages:Array.from(navigator.languages||[]),intlLocale:Intl.DateTimeFormat().resolvedOptions().locale,userAgent:navigator.userAgent,platform:navigator.platform})",
    returnByValue: true,
  })) as { result?: { value?: CdpLocaleRuntime } };
  const runtime = response.result?.value ?? {};
  return { locale: effectiveLocaleFromRuntime(runtime), runtime };
}

async function applyAttachmentLocaleNetwork(
  call: CdpLocaleCommand,
  locale: RecordingLocale,
  runtime: CdpLocaleRuntime,
): Promise<{ acceptLanguageApplied: boolean; userAgentLanguageApplied: boolean }> {
  const profile = localeProfile(locale);
  if (!profile) return { acceptLanguageApplied: false, userAgentLanguageApplied: false };
  await call("Network.setExtraHTTPHeaders", {
    headers: { "Accept-Language": profile.acceptLanguage },
  });
  const userAgent = typeof runtime.userAgent === "string" ? runtime.userAgent : null;
  if (!userAgent) return { acceptLanguageApplied: true, userAgentLanguageApplied: false };
  try {
    await call("Network.setUserAgentOverride", {
      userAgent,
      acceptLanguage: profile.acceptLanguage,
      platform: typeof runtime.platform === "string" ? runtime.platform : "Win32",
    });
    return { acceptLanguageApplied: true, userAgentLanguageApplied: true };
  } catch {
    // User-agent override support is attachment-specific. It cannot invalidate a verified locale.
    return { acceptLanguageApplied: true, userAgentLanguageApplied: false };
  }
}

async function runLocaleInitializationLock(
  key: string,
  execute: () => Promise<void>,
): Promise<void> {
  const existing = localeInitializationLocks.get(key);
  if (existing) return existing;
  if (localeInitializationLocks.size >= MAX_LOCALE_INITIALIZATION_LOCKS)
    localeInitializationLocks.clear();
  const pending = execute().finally(() => localeInitializationLocks.delete(key));
  localeInitializationLocks.set(key, pending);
  return pending;
}

export function recordingLocaleDiagnostic(
  result: CdpRecordingLocaleResult,
  initializationMode: CdpLocaleMode,
  conflict = false,
): RecordingLocaleDiagnostic {
  return {
    requestedCategory: result.requestedLocale,
    initializationMode,
    result:
      result.localeOverride === "failed"
        ? conflict
          ? "conflict"
          : "failed"
        : result.localeOverride,
    effectiveLocaleCategory: recordingLocaleCategory(result.effectiveLocale),
    verified: result.verified,
  };
}

export async function configureCdpRecordingLocaleWithClient(input: {
  call: CdpLocaleCommand;
  locale?: RecordingLocale;
  mode?: CdpLocaleMode;
  connectionKey: string;
}): Promise<CdpRecordingLocaleResult> {
  const locale = input.locale ?? DEFAULT_RECORDING_LOCALE;
  const mode = input.mode ?? "verify";
  await input.call("Network.enable", {});
  let state = await readCdpEffectiveLocale(input.call);
  let network = await applyAttachmentLocaleNetwork(input.call, locale, state.runtime);
  if (locale === "auto")
    return localeResult(
      locale,
      state.locale,
      "not-required",
      network.acceptLanguageApplied,
      network.userAgentLanguageApplied,
    );
  if (localeMatchesRequested(state.locale, locale))
    return localeResult(
      locale,
      state.locale,
      "already-effective",
      network.acceptLanguageApplied,
      network.userAgentLanguageApplied,
    );
  if (mode === "verify") {
    throw new CdpRecordingLocaleError(
      "Recording locale is not effective on this CDP attachment.",
      localeResult(
        locale,
        state.locale,
        "failed",
        network.acceptLanguageApplied,
        network.userAgentLanguageApplied,
      ),
    );
  }

  let override: CdpRecordingLocaleResult["localeOverride"] = "failed";
  await runLocaleInitializationLock(input.connectionKey, async () => {
    state = await readCdpEffectiveLocale(input.call);
    if (localeMatchesRequested(state.locale, locale)) {
      override = "already-effective";
      return;
    }
    const profile = localeProfile(locale);
    if (!profile) {
      override = "not-required";
      return;
    }
    try {
      await input.call("Emulation.setLocaleOverride", { locale: profile.locale });
      override = "applied";
    } catch (error) {
      if (!duplicateOverrideError(error)) {
        throw new CdpRecordingLocaleError(
          "Recording locale initialization failed.",
          localeResult(
            locale,
            state.locale,
            "failed",
            network.acceptLanguageApplied,
            network.userAgentLanguageApplied,
          ),
        );
      }
      const afterDuplicate = await readCdpEffectiveLocale(input.call);
      if (localeMatchesRequested(afterDuplicate.locale, locale)) {
        state = afterDuplicate;
        override = "already-active-verified";
        return;
      }
      throw new CdpRecordingLocaleError(
        "Recording locale conflicts with an existing browser override.",
        localeResult(
          locale,
          afterDuplicate.locale,
          "failed",
          network.acceptLanguageApplied,
          network.userAgentLanguageApplied,
        ),
        true,
      );
    }
    state = await readCdpEffectiveLocale(input.call);
    if (!localeMatchesRequested(state.locale, locale)) {
      throw new CdpRecordingLocaleError(
        "Recording locale could not be verified after initialization.",
        localeResult(
          locale,
          state.locale,
          "failed",
          network.acceptLanguageApplied,
          network.userAgentLanguageApplied,
        ),
      );
    }
  });
  state = await readCdpEffectiveLocale(input.call);
  if (override === "failed" && localeMatchesRequested(state.locale, locale))
    override = "already-effective";
  network = await applyAttachmentLocaleNetwork(input.call, locale, state.runtime);
  const result = localeResult(
    locale,
    state.locale,
    override,
    network.acceptLanguageApplied,
    network.userAgentLanguageApplied,
  );
  if (!result.verified)
    throw new CdpRecordingLocaleError("Recording locale verification failed.", {
      ...result,
      localeOverride: "failed",
      verified: false,
    });
  return result;
}

export async function configureCdpRecordingLocale(
  socket: WebSocket,
  nextId: () => number,
  sessionId: string,
  locale: RecordingLocale = DEFAULT_RECORDING_LOCALE,
  options: { mode?: CdpLocaleMode; connectionKey?: string } = {},
): Promise<CdpRecordingLocaleResult> {
  return configureCdpRecordingLocaleWithClient({
    locale,
    mode: options.mode,
    connectionKey: options.connectionKey ?? `attachment-${sessionId}`,
    call: (method, params = {}) => cdpCall(socket, nextId(), method, params, sessionId),
  });
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SelectorCandidate = { css: string; text?: string };

export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  let depth = 0;
  let escaped = false;
  for (const char of selector) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function normalizeSelectorCandidates(
  selector: string,
  fallbacks: string[] = [],
): SelectorCandidate[] {
  const result: SelectorCandidate[] = [];
  for (const raw of [selector, ...fallbacks].flatMap(splitSelectorList)) {
    const hasText = raw.match(/^(.*?):has-text\(\s*(["'])(.*?)\2\s*\)$/i);
    if (hasText) {
      result.push({ css: hasText[1]?.trim() || "*", text: hasText[3]?.trim() });
    } else if (raw.trim()) {
      result.push({ css: raw.trim() });
    }
  }
  return result.slice(0, 12);
}

function elementExpression(candidates: SelectorCandidate[], operation: string): string {
  return `(() => {
    const candidates = ${JSON.stringify(candidates)};
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden" && style.display !== "none";
    };
    const label = (el) => [el.innerText, el.textContent, el.getAttribute("aria-label"), el.getAttribute("title"), el.value]
      .filter(Boolean).join(" ").replace(/\\s+/g, " ").trim().toLowerCase();
    const find = () => {
      for (const candidate of candidates) {
        let nodes = [];
        try { nodes = Array.from(document.querySelectorAll(candidate.css || "*")); } catch { continue; }
        const expectedText = String(candidate.text || "").trim().toLowerCase();
        const found = nodes.find((el) => visible(el) && (!expectedText || label(el).includes(expectedText)));
        if (found) return found;
      }
      return null;
    };
    const el = find();
    ${operation}
  })()`;
}

function runtimeResultValue(result: Record<string, unknown>): unknown {
  const exception = result.exceptionDetails as { text?: string } | undefined;
  if (exception) throw new Error(exception.text || "Browser evaluation failed.");
  return (result.result as { value?: unknown } | undefined)?.value;
}

async function evaluateValue(
  socket: WebSocket,
  id: number,
  sid: string,
  expression: string,
  timeoutMs?: number,
): Promise<unknown> {
  const result = await cdpCall(
    socket,
    id,
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sid,
    timeoutMs,
  );
  return runtimeResultValue(result);
}

async function waitForCondition(
  evaluate: (expression: string) => Promise<unknown>,
  expression: string,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if ((await evaluate(expression)) === true) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(message);
}

function selectorExistsExpression(selector: string): string {
  const candidates = normalizeSelectorCandidates(selector);
  return elementExpression(candidates, "return Boolean(el);");
}

async function verifyExpectation(
  action: CdpAction,
  evaluate: (expression: string) => Promise<unknown>,
): Promise<void> {
  if (action.expected?.selector) {
    await waitForCondition(
      evaluate,
      selectorExistsExpression(action.expected.selector),
      Math.min(action.timeoutMs ?? 10_000, 20_000),
      "Expected element did not appear after the action.",
    );
  }
  if (action.expected?.urlIncludes) {
    const expected = JSON.stringify(action.expected.urlIncludes);
    await waitForCondition(
      evaluate,
      `location.href.includes(${expected})`,
      Math.min(action.timeoutMs ?? 10_000, 20_000),
      "Expected URL was not reached after the action.",
    );
  }
}

export async function runScenesOverCdp(
  websocketUrl: string,
  actions: CdpAction[],
  maxWallMs = 90_000,
  recordingLocale: RecordingLocale = DEFAULT_RECORDING_LOCALE,
  options?: {
    now?: () => number;
    localeMode?: CdpLocaleMode;
    onLocaleDiagnostic?: (diagnostic: RecordingLocaleDiagnostic) => Promise<void> | void;
  },
): Promise<SceneExecutionResult> {
  const socket = await openCdp(websocketUrl);
  const now = options?.now ?? Date.now;
  const deadline = now() + maxWallMs;
  const diagnostics: ActionDiagnostic[] = [];
  let msgId = 1;
  let executed = 0;
  let error: string | undefined;
  let browserMetrics: RuntimeBrowserMetrics | undefined;

  try {
    const targets = (await cdpCall(socket, msgId++, "Target.getTargets")) as {
      targetInfos?: Array<{ targetId: string; type: string; url: string }>;
    };
    const pageTarget = targets.targetInfos?.find((target) => target.type === "page");
    if (!pageTarget) throw new Error("Steel session has no page target yet.");

    const attached = (await cdpCall(socket, msgId++, "Target.attachToTarget", {
      targetId: pageTarget.targetId,
      flatten: true,
    })) as { sessionId?: string };
    if (!attached.sessionId) throw new Error("Could not attach to the Steel page target.");
    const sid = attached.sessionId;

    await cdpCall(socket, msgId++, "Page.enable", {}, sid);
    await cdpCall(socket, msgId++, "Runtime.enable", {}, sid);
    const localeMode = options?.localeMode ?? "initialize";
    const localeResult = await configureCdpRecordingLocale(
      socket,
      () => msgId++,
      sid,
      recordingLocale,
      {
        mode: localeMode,
        connectionKey: cdpLocaleConnectionKey(websocketUrl, pageTarget.targetId),
      },
    );
    await options?.onLocaleDiagnostic?.(recordingLocaleDiagnostic(localeResult, localeMode));
    const evaluate = (expression: string, timeoutMs?: number) =>
      evaluateValue(socket, msgId++, sid, expression, timeoutMs);

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      const startedAt = now();
      let cursor: { x: number; y: number } | undefined;
      let boundingBox: ActionDiagnostic["boundingBox"];
      if (now() >= deadline) {
        error = "The scene run exceeded its wall-clock budget.";
        diagnostics.push({
          index,
          type: action.type,
          success: false,
          code: "WALL_CLOCK_TIMEOUT",
          message: error,
        });
        break;
      }

      try {
        const timeoutMs = Math.min(action.timeoutMs ?? 15_000, 30_000);
        if (action.type === "goto") {
          const target = new URL(action.url);
          if (target.protocol !== "http:" && target.protocol !== "https:") {
            throw new Error("Navigation target must use HTTP or HTTPS.");
          }
          const navigation = (await cdpCall(
            socket,
            msgId++,
            "Page.navigate",
            { url: target.toString() },
            sid,
            timeoutMs,
          )) as { errorText?: string };
          if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
          await waitForCondition(
            evaluate,
            'document.readyState === "interactive" || document.readyState === "complete"',
            timeoutMs,
            "Page did not become ready after navigation.",
          );
          if (action.waitMs) await delay(Math.min(action.waitMs, 3_000));
        } else if (action.type === "wait") {
          if (action.selector) {
            await waitForCondition(
              evaluate,
              selectorExistsExpression(action.selector),
              timeoutMs,
              "Timed out waiting for the requested element.",
            );
          } else {
            await delay(Math.min(Math.max(action.ms ?? 500, 0), 10_000));
          }
        } else if (action.type === "scroll") {
          const value = await evaluate(
            `(() => { window.scrollBy({ top: ${Number(action.deltaY) || 400}, behavior: "smooth" }); return true; })()`,
            timeoutMs,
          );
          if (value !== true) throw new Error("Browser did not accept the scroll action.");
          await delay(700);
        } else if (action.type === "click") {
          const candidates = normalizeSelectorCandidates(action.selector, action.fallbackSelectors);
          if (!candidates.length) throw new Error("Click action has no usable selector.");
          const value = (await evaluate(
            elementExpression(
              candidates,
              'if (!el) return { success: false }; el.scrollIntoView({ block: "center", inline: "center" }); const rect = el.getBoundingClientRect(); el.click(); return { success: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };',
            ),
            timeoutMs,
          )) as {
            success?: boolean;
            x?: number;
            y?: number;
            width?: number;
            height?: number;
          } | null;
          if (!value?.success) throw new Error("Click target was not found or was not visible.");
          if (Number.isFinite(value.x) && Number.isFinite(value.y))
            cursor = { x: value.x as number, y: value.y as number };
          if (
            Number.isFinite(value.x) &&
            Number.isFinite(value.y) &&
            Number.isFinite(value.width) &&
            Number.isFinite(value.height)
          ) {
            boundingBox = {
              x: (value.x as number) - (value.width as number) / 2,
              y: (value.y as number) - (value.height as number) / 2,
              width: value.width as number,
              height: value.height as number,
            };
          }
          await delay(500);
        } else if (action.type === "type") {
          const candidates = normalizeSelectorCandidates(action.selector, action.fallbackSelectors);
          if (!candidates.length) throw new Error("Type action has no usable selector.");
          const text = JSON.stringify(action.text);
          const value = await evaluate(
            elementExpression(
              candidates,
              `if (!el) return false;
               el.scrollIntoView({ block: "center" }); el.focus();
               if (el.isContentEditable) {
                 el.textContent = ${text};
               } else {
                 const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                 const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
                 if (!setter) return false;
                 setter.call(el, ${text});
               }
               el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
               el.dispatchEvent(new Event("change", { bubbles: true }));
               return el.isContentEditable ? el.textContent === ${text} : el.value === ${text};`,
            ),
            timeoutMs,
          );
          if (value !== true)
            throw new Error("Input target was not found or did not retain the value.");
        } else if (action.type === "eval") {
          const value = await evaluate(action.expression, timeoutMs);
          if (value === false || value === null || value === undefined) {
            throw new Error("Evaluation returned an unsuccessful result.");
          }
        }

        await verifyExpectation(action, evaluate);
        executed += 1;
        diagnostics.push({
          index,
          type: action.type,
          success: true,
          code: "ACTION_SUCCEEDED",
          message: `${action.type} action completed and was verified.`,
          startedAt,
          completedAt: now(),
          cursor,
          boundingBox,
        });
      } catch (actionError) {
        error = actionError instanceof Error ? actionError.message : String(actionError);
        diagnostics.push({
          index,
          type: action.type,
          success: false,
          code: "ACTION_FAILED",
          message: error,
          startedAt,
          completedAt: now(),
        });
        break;
      }
    }
    try {
      const metrics = await evaluate(`(() => ({
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
      }))()`);
      if (metrics && typeof metrics === "object") browserMetrics = metrics as RuntimeBrowserMetrics;
    } catch {
      // Recording can still complete; full-frame fallback remains available.
    }
  } catch (runError) {
    error = runError instanceof Error ? runError.message : String(runError);
  } finally {
    try {
      socket.close();
    } catch {
      // Best-effort socket cleanup.
    }
  }

  return {
    executed,
    completed: !error && executed === actions.length && actions.length > 0,
    diagnostics,
    browserMetrics,
    error,
  };
}

// ---- Recording retrieval ---------------------------------------------

export type HlsResource = { url: string; durationSeconds?: number };

export type ParsedHlsPlaylist = {
  finalized: boolean;
  durationSeconds: number;
  init: HlsResource | null;
  segments: HlsResource[];
  variants: HlsResource[];
};

function extractQuotedAttribute(line: string, name: string): string | null {
  const match = line.match(new RegExp(`${name}=(?:"([^"]+)"|([^,]+))`, "i"));
  return match?.[1] ?? match?.[2]?.trim() ?? null;
}

export function parseHlsPlaylist(text: string, playlistUrl: string): ParsedHlsPlaylist {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "#EXTM3U") {
    throw new SteelRecordingError(
      "INVALID_HLS_PLAYLIST",
      "Steel returned an invalid HLS playlist.",
      false,
    );
  }
  if (lines.some((line) => line.startsWith("#EXT-X-BYTERANGE"))) {
    throw new SteelRecordingError(
      "UNSUPPORTED_HLS_BYTERANGE",
      "Steel returned byte-range HLS media, which this renderer does not support.",
      false,
    );
  }
  const encrypted = lines.find(
    (line) => line.startsWith("#EXT-X-KEY:") && !/METHOD=NONE(?:,|$)/i.test(line),
  );
  if (encrypted) {
    throw new SteelRecordingError(
      "UNSUPPORTED_HLS_ENCRYPTION",
      "Steel returned encrypted HLS media that cannot be finalized safely.",
      false,
    );
  }

  let init: HlsResource | null = null;
  const segments: HlsResource[] = [];
  const variants: HlsResource[] = [];
  let durationSeconds = 0;
  let pendingSegmentDuration: number | null = null;
  let expectsSegment = false;
  let expectsVariant = false;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MAP:")) {
      const uri = extractQuotedAttribute(line, "URI");
      if (uri) init = { url: new URL(uri, playlistUrl).toString() };
    } else if (line.startsWith("#EXTINF:")) {
      const duration = Number(line.slice(8).split(",", 1)[0]);
      if (Number.isFinite(duration) && duration >= 0) {
        durationSeconds += duration;
        pendingSegmentDuration = duration;
      }
      expectsSegment = true;
    } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
      expectsVariant = true;
    } else if (!line.startsWith("#")) {
      const resource = { url: new URL(line, playlistUrl).toString() };
      if (expectsVariant) variants.push(resource);
      else if (expectsSegment || !variants.length) {
        segments.push({ ...resource, durationSeconds: pendingSegmentDuration ?? undefined });
      }
      pendingSegmentDuration = null;
      expectsSegment = false;
      expectsVariant = false;
    }
  }

  return {
    finalized: lines.includes("#EXT-X-ENDLIST"),
    durationSeconds,
    init,
    segments,
    variants,
  };
}

export function listIsoBmffBoxes(bytes: Uint8Array): string[] {
  const boxes: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 8 <= bytes.byteLength && boxes.length < 10_000) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > bytes.byteLength) break;
      const largeSize = view.getBigUint64(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = bytes.byteLength - offset;
    }
    if (size < headerSize || offset + size > bytes.byteLength) break;
    boxes.push(type);
    offset += size;
  }
  return boxes;
}

export function validateFragmentedMp4(init: Uint8Array, segments: Uint8Array[]): void {
  const initBoxes = listIsoBmffBoxes(init);
  if (!initBoxes.includes("ftyp") || !initBoxes.includes("moov")) {
    throw new SteelRecordingError(
      "INVALID_MP4_INIT",
      "Steel recording initialization data is not a valid fragmented MP4 header.",
      false,
    );
  }
  if (!segments.length) {
    throw new SteelRecordingError("EMPTY_RECORDING", "Steel finalized an empty recording.", false);
  }
  for (const segment of segments) {
    const boxes = listIsoBmffBoxes(segment);
    if (!boxes.includes("moof") || !boxes.includes("mdat")) {
      throw new SteelRecordingError(
        "INVALID_MP4_SEGMENT",
        "A Steel recording segment is not valid fragmented MP4 media.",
        false,
      );
    }
  }
}

function concatenateBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (total > MAX_RECORDING_BYTES) {
    throw new SteelRecordingError(
      "RECORDING_TOO_LARGE",
      "The finalized recording exceeds the 500 MB processing limit.",
      false,
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function finalizeFragmentedMp4(
  init: Uint8Array,
  segments: Uint8Array[],
  durationsSeconds: number[],
): Uint8Array {
  validateFragmentedMp4(init, segments);
  const durationSeconds = durationsSeconds.reduce((sum, duration) => sum + duration, 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new SteelRecordingError(
      "INVALID_HLS_DURATION",
      "Steel returned a finalized recording without a usable duration.",
      false,
    );
  }
  try {
    return remuxFragmentedMp4(concatenateBytes([init, ...segments]));
  } catch (error) {
    if (error instanceof SteelRecordingError) throw error;
    const message = error instanceof Mp4RemuxError ? error.message : "Unknown MP4 remux failure.";
    throw new SteelRecordingError(
      "MP4_REMUX_FAILED",
      `Steel recording could not be finalized into a seekable MP4. ${message}`,
      false,
    );
  }
}

async function downloadResource(
  resource: HlsResource,
  apiKey: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<unknown>,
): Promise<Uint8Array> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(resource.url, { headers: steelHeaders(apiKey) });
    lastStatus = response.status;
    if (response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength) {
        throw new SteelRecordingError(
          "EMPTY_HLS_RESOURCE",
          "Steel returned an empty recording resource.",
          true,
        );
      }
      return bytes;
    }
    if (response.status === 401 || response.status === 403) break;
    await sleep(250 * 2 ** attempt);
  }
  throw new SteelRecordingError(
    "STEEL_SEGMENT_DOWNLOAD_FAILED",
    `A finalized Steel recording resource could not be downloaded (HTTP ${lastStatus}).`,
    lastStatus !== 401 && lastStatus !== 403,
    lastStatus,
  );
}

async function loadMediaPlaylist(
  response: Response,
  playlistUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ParsedHlsPlaylist> {
  const playlist = parseHlsPlaylist(await response.text(), playlistUrl);
  if (!playlist.variants.length) return playlist;
  const variant = playlist.variants[0];
  const variantResponse = await fetchImpl(variant.url, { headers: steelHeaders(apiKey) });
  if (!variantResponse.ok) {
    throw new SteelRecordingError(
      "STEEL_PLAYLIST_NOT_READY",
      `Steel recording playlist is not ready (HTTP ${variantResponse.status}).`,
      true,
      variantResponse.status,
    );
  }
  return parseHlsPlaylist(await variantResponse.text(), variant.url);
}

export async function fetchFinalizedHlsMp4(options: {
  playlistUrl: string;
  apiKey: string;
  attempts?: number;
  initialWaitMs?: number;
  maxWaitMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
}): Promise<{ bytes: Uint8Array; durationSeconds: number } | null> {
  const attempts = options.attempts ?? 6;
  const initialWaitMs = options.initialWaitMs ?? 1_000;
  const maxWaitMs = options.maxWaitMs ?? 8_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? delay;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(options.playlistUrl, {
      headers: steelHeaders(options.apiKey),
    });
    if (response.status === 401 || response.status === 403) {
      throw new SteelRecordingError(
        "STEEL_RECORDING_UNAUTHORIZED",
        "Steel rejected recording access. Check the server API key.",
        false,
        response.status,
      );
    }
    if (response.ok) {
      const playlist = await loadMediaPlaylist(
        response,
        options.playlistUrl,
        options.apiKey,
        fetchImpl,
      );
      if (playlist.finalized) {
        if (!playlist.init) {
          throw new SteelRecordingError(
            "MISSING_MP4_INIT",
            "Finalized Steel playlist has no #EXT-X-MAP initialization fragment.",
            false,
          );
        }
        if (!playlist.segments.length) {
          throw new SteelRecordingError(
            "EMPTY_RECORDING",
            "Finalized Steel playlist has no media segments.",
            false,
          );
        }
        const init = await downloadResource(playlist.init, options.apiKey, fetchImpl, sleep);
        const segments: Uint8Array[] = [];
        for (const segment of playlist.segments) {
          segments.push(await downloadResource(segment, options.apiKey, fetchImpl, sleep));
        }
        const durationsSeconds = playlist.segments.map((segment) => segment.durationSeconds ?? 0);
        return {
          bytes: finalizeFragmentedMp4(init, segments, durationsSeconds),
          durationSeconds: Math.max(1, Math.round(playlist.durationSeconds)),
        };
      }
    } else if (response.status >= 400 && response.status < 500 && response.status !== 404) {
      throw new SteelRecordingError(
        "STEEL_RECORDING_UNAVAILABLE",
        `Steel recording cannot be retrieved (HTTP ${response.status}).`,
        false,
        response.status,
      );
    }

    if (attempt < attempts - 1) {
      await sleep(Math.min(initialWaitMs * 2 ** attempt, maxWaitMs));
    }
  }
  return null;
}

export async function fetchSessionMp4(
  sessionId: string,
  options: {
    attempts?: number;
    initialWaitMs?: number;
    maxWaitMs?: number;
  } = {},
): Promise<{ bytes: Uint8Array; durationSeconds: number } | null> {
  return fetchFinalizedHlsMp4({
    playlistUrl: `${STEEL_BASE}/sessions/${encodeURIComponent(sessionId)}/hls`,
    apiKey: requireSteelKey(),
    ...options,
  });
}
