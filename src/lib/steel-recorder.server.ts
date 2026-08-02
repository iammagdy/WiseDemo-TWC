// Steel.dev cloud-browser integration. Everything in this module runs on the
// server; callers must never send the Steel API key or authenticated HLS URLs
// to the browser.

import { Mp4RemuxError, remuxFragmentedMp4 } from "./mp4-remux.server.ts";
import type { RuntimeBrowserMetrics } from "../composition/source-viewport.ts";
import {
  DEFAULT_RECORDING_LOCALE,
  localeProfile,
  type RecordingLocale,
} from "./recording-locale.ts";
import { serverEnv } from "./server-env.server.ts";

const STEEL_BASE = "https://api.steel.dev/v1";
const DEFAULT_CDP_TIMEOUT_MS = 20_000;
const MAX_RECORDING_BYTES = 500 * 1024 * 1024;

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

export async function createSteelSession(
  _startUrl: string,
  _recordingLocale: RecordingLocale = DEFAULT_RECORDING_LOCALE,
): Promise<SteelSession> {
  const key = requireSteelKey();
  const res = await fetch(`${STEEL_BASE}/sessions`, {
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
      timeout: 180_000,
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

export async function releaseSteelSession(sessionId: string): Promise<SteelSession> {
  const key = requireSteelKey();
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      res = await fetch(`${STEEL_BASE}/sessions/${encodeURIComponent(sessionId)}/release`, {
        method: "POST",
        headers: steelHeaders(key),
      });
    } catch (error) {
      if (attempt >= 4) throw error;
      await delay(250 * 2 ** (attempt - 1));
      continue;
    }
    if (![429, 502, 503, 504].includes(res.status) || attempt >= 4) break;
    await delay(250 * 2 ** (attempt - 1));
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
  const attempts = 4;

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
          }, 8_000);
          socket.addEventListener("open", onOpen);
          socket.addEventListener("error", onError);
        });
      } catch {
        // Steel can return a session just before its browser endpoint is ready.
      }
    }

    if (attempt < attempts) await delay(500 * attempt);
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

export async function configureCdpRecordingLocale(
  socket: WebSocket,
  nextId: () => number,
  sessionId: string,
  locale: RecordingLocale = DEFAULT_RECORDING_LOCALE,
): Promise<void> {
  await cdpCall(socket, nextId(), "Network.enable", {}, sessionId);
  const profile = localeProfile(locale);
  if (!profile) return;

  // Emulation has no separate `enable` command in the CDP protocol; invoking
  // its override commands activates the domain before the first navigation.
  await cdpCall(
    socket,
    nextId(),
    "Emulation.setLocaleOverride",
    { locale: profile.locale },
    sessionId,
  );
  await cdpCall(
    socket,
    nextId(),
    "Network.setExtraHTTPHeaders",
    { headers: { "Accept-Language": profile.acceptLanguage } },
    sessionId,
  );

  try {
    const result = (await cdpCall(
      socket,
      nextId(),
      "Runtime.evaluate",
      {
        expression: "({userAgent: navigator.userAgent, platform: navigator.platform})",
        returnByValue: true,
      },
      sessionId,
    )) as { result?: { value?: { userAgent?: string; platform?: string } } };
    const userAgent = result.result?.value?.userAgent;
    if (userAgent) {
      await cdpCall(
        socket,
        nextId(),
        "Network.setUserAgentOverride",
        {
          userAgent,
          acceptLanguage: profile.acceptLanguage,
          platform: result.result?.value?.platform ?? "Win32",
        },
        sessionId,
      );
    }
  } catch {
    // Some Chromium builds do not permit the user-agent override on an
    // attached target. Locale and request headers remain mandatory above.
  }
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
  options?: { now?: () => number },
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
    await configureCdpRecordingLocale(socket, () => msgId++, sid, recordingLocale);
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
