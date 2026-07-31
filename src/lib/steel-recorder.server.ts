// Steel.dev cloud browser integration for real demo recording.
// Runs entirely on Cloudflare Workers via Steel's REST API.
// Docs: https://docs.steel.dev/api-reference

const STEEL_BASE = "https://api.steel.dev/v1";

type SteelSession = {
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

function requireSteelKey(): string {
  const key = process.env.STEEL_API_KEY;
  if (!key || key.length < 8) {
    throw new Error(
      "Steel API key not configured. Sign up at steel.dev (free, no card), copy the API key, and paste it in DemoForge secrets.",
    );
  }
  return key;
}

export async function createSteelSession(startUrl: string): Promise<SteelSession> {
  const key = requireSteelKey();
  const res = await fetch(`${STEEL_BASE}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Steel-Api-Key": key,
    },
    body: JSON.stringify({
      startUrl,
      dimensions: { width: 1280, height: 800 },
      solveCaptcha: false,
      blockAds: true,
      recordSession: true,
      sessionTimeout: 180000, // 3 min hard cap
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Steel session create failed [${res.status}]: ${body || res.statusText}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return {
    id: String(data.id),
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

export async function releaseSteelSession(sessionId: string): Promise<SteelSession | null> {
  const key = requireSteelKey();
  const res = await fetch(`${STEEL_BASE}/sessions/${sessionId}/release`, {
    method: "POST",
    headers: { "Steel-Api-Key": key },
  });
  if (!res.ok) return null;
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
  const res = await fetch(`${STEEL_BASE}/sessions/${sessionId}`, {
    headers: { "Steel-Api-Key": key },
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

// ---- CDP over WebSocket ------------------------------------------------
// Cloudflare Workers support outbound WebSocket via fetch() upgrade.

type CdpAction =
  | { type: "goto"; url: string; waitMs?: number }
  | { type: "wait"; ms: number }
  | { type: "scroll"; deltaY: number }
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "eval"; expression: string };

export type ScenePlan = {
  actions: CdpAction[];
  narration: string[];
};

export async function openCdp(websocketUrl: string): Promise<WebSocket> {
  // Steel's websocketUrl already includes auth. Cloudflare Workers open sockets
  // with a fetch Upgrade; Node (dev server) uses the standard WebSocket global.
  const upgradeUrl = websocketUrl.replace(/^ws/, "http");
  try {
    const res = await fetch(upgradeUrl, { headers: { Upgrade: "websocket" } });
    const socket = (res as unknown as { webSocket?: WebSocket }).webSocket;
    if (socket) {
      (socket as unknown as { accept: () => void }).accept();
      return socket;
    }
  } catch {
    /* fall through to the standard WebSocket client */
  }

  if (typeof WebSocket === "undefined") {
    throw new Error("This runtime cannot open a CDP WebSocket to the cloud browser.");
  }

  return await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    const timer = setTimeout(() => reject(new Error("Timed out connecting to the cloud browser.")), 15000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not connect to the cloud browser session."));
    });
  });
}

export function cdpCall(
  socket: WebSocket,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`CDP timeout on ${method}`));
    }, 15000);

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
        /* ignore */
      }
    }

    socket.addEventListener("message", onMessage);
    socket.send(
      JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }),
    );
  });
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Recording retrieval ---------------------------------------------
// Steel finalizes each session recording as fragmented MP4 segments behind an
// HLS playlist. Concatenating init.mp4 + segments yields a single playable MP4.

export async function fetchSessionMp4(
  sessionId: string,
  { attempts = 6, waitMs = 4000 }: { attempts?: number; waitMs?: number } = {},
): Promise<{ bytes: Uint8Array; durationSeconds: number } | null> {
  const key = requireSteelKey();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(`${STEEL_BASE}/sessions/${sessionId}/hls`, {
      headers: { "Steel-Api-Key": key },
    });
    const playlist = res.ok ? await res.text() : "";

    if (playlist.includes("#EXT-X-ENDLIST")) {
      const initMatch = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/);
      const segments = playlist.match(/^https?:\/\/\S+$/gm) ?? [];
      const duration = (playlist.match(/#EXTINF:([\d.]+)/g) ?? []).reduce(
        (total, line) => total + Number(line.replace("#EXTINF:", "")),
        0,
      );
      if (!segments.length) return null;

      const urls = [initMatch?.[1], ...segments].filter((u): u is string => Boolean(u));
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (const url of urls) {
        const partRes = await fetch(url);
        if (!partRes.ok) continue;
        const buffer = new Uint8Array(await partRes.arrayBuffer());
        chunks.push(buffer);
        size += buffer.byteLength;
      }
      if (!size) return null;

      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes, durationSeconds: Math.round(duration) };
    }

    await delay(waitMs);
  }

  return null;
}

export async function runScenesOverCdp(
  websocketUrl: string,
  actions: CdpAction[],
  maxWallMs = 22000,
): Promise<{ executed: number; error?: string }> {
  const socket = await openCdp(websocketUrl);
  const deadline = Date.now() + maxWallMs;
  let msgId = 1;
  let executed = 0;
  let error: string | undefined;

  try {
    // Discover the page target
    const targets = (await cdpCall(socket, msgId++, "Target.getTargets")) as {
      targetInfos?: Array<{ targetId: string; type: string; url: string }>;
    };
    const pageTarget = targets.targetInfos?.find((t) => t.type === "page");
    if (!pageTarget) throw new Error("Steel session has no page target yet.");

    const attached = (await cdpCall(socket, msgId++, "Target.attachToTarget", {
      targetId: pageTarget.targetId,
      flatten: true,
    })) as { sessionId: string };
    const sid = attached.sessionId;

    await cdpCall(socket, msgId++, "Page.enable", {}, sid);
    await cdpCall(socket, msgId++, "Runtime.enable", {}, sid);

    for (const action of actions) {
      if (Date.now() > deadline) {
        error = "Time budget exhausted";
        break;
      }
      try {
        if (action.type === "goto") {
          await cdpCall(socket, msgId++, "Page.navigate", { url: action.url }, sid);
          await delay(action.waitMs ?? 2500);
        } else if (action.type === "wait") {
          await delay(Math.min(action.ms, 5000));
        } else if (action.type === "scroll") {
          await cdpCall(
            socket,
            msgId++,
            "Runtime.evaluate",
            {
              expression: `window.scrollBy({ top: ${Number(action.deltaY) || 400}, behavior: 'smooth' })`,
              returnByValue: true,
            },
            sid,
          );
          await delay(1400);
        } else if (action.type === "click") {
          const selector = JSON.stringify(action.selector);
          await cdpCall(
            socket,
            msgId++,
            "Runtime.evaluate",
            {
              expression: `(function(){var el=document.querySelector(${selector});if(el){el.scrollIntoView({block:'center'});el.click();return true;}return false;})()`,
              returnByValue: true,
            },
            sid,
          );
          await delay(1600);
        } else if (action.type === "type") {
          const selector = JSON.stringify(action.selector);
          const text = JSON.stringify(action.text);
          await cdpCall(
            socket,
            msgId++,
            "Runtime.evaluate",
            {
              expression: `(function(){var el=document.querySelector(${selector});if(!el)return false;el.focus();var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,${text});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
              returnByValue: true,
            },
            sid,
          );
          await delay(600);
        } else if (action.type === "eval") {
          await cdpCall(
            socket,
            msgId++,
            "Runtime.evaluate",
            { expression: action.expression, returnByValue: true },
            sid,
          );
          await delay(400);
        }
        executed += 1;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        break;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }

  return { executed, error };
}

// ---- Scene planning ---------------------------------------------------

export function planScenes(input: {
  baseUrl: string;
  loginUrl?: string | null;
  credentials: DecryptedCredentials;
  featurePrompt: string;
  siteMapMd: string | null;
}): ScenePlan {
  const actions: CdpAction[] = [];
  const narration: string[] = [];
  const { baseUrl, loginUrl, credentials, featurePrompt, siteMapMd } = input;

  // Discovered links from site map
  const links = extractLinksFromMap(siteMapMd, baseUrl).slice(0, 3);

  // Scene 1 — establish
  actions.push({ type: "goto", url: baseUrl, waitMs: 3000 });
  narration.push(`Opening ${new URL(baseUrl).hostname}`);

  if (credentials && loginUrl) {
    // Sign in flow
    actions.push({ type: "goto", url: loginUrl, waitMs: 2500 });
    narration.push("Signing in to the real product");
    actions.push({
      type: "type",
      selector: 'input[type="email"], input[name="email"], input[name="username"], input[type="text"]',
      text: credentials.username,
    });
    actions.push({
      type: "type",
      selector: 'input[type="password"], input[name="password"]',
      text: credentials.secret,
    });
    actions.push({
      type: "click",
      selector: 'button[type="submit"], input[type="submit"], button:has-text("Sign in")',
    });
    actions.push({ type: "wait", ms: 3500 });
    narration.push("Product workspace loaded");
    actions.push({ type: "scroll", deltaY: 500 });
    narration.push(`Highlighting: ${truncate(featurePrompt, 90)}`);
  } else {
    // Public landing tour
    actions.push({ type: "scroll", deltaY: 500 });
    narration.push("Scrolling the landing page to show product proof");
    actions.push({ type: "scroll", deltaY: 700 });
    for (const link of links) {
      actions.push({ type: "goto", url: link, waitMs: 2500 });
      narration.push(`Exploring ${new URL(link).pathname || "/"}`);
      actions.push({ type: "scroll", deltaY: 500 });
    }
    narration.push(`Focus: ${truncate(featurePrompt, 90)}`);
  }

  return { actions, narration };
}

function extractLinksFromMap(map: string | null, baseUrl: string): string[] {
  if (!map) return [];
  const base = new URL(baseUrl);
  const urls = new Set<string>();
  const regex = /https?:\/\/[^\s)"']+/g;
  const matches = map.match(regex) ?? [];
  for (const raw of matches) {
    try {
      const url = new URL(raw.replace(/[).,]+$/, ""));
      if (url.hostname === base.hostname && url.href !== baseUrl) urls.add(url.href);
    } catch {
      /* skip */
    }
  }
  return [...urls];
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}