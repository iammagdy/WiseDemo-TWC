const STEEL_BASE = "https://api.steel.dev/v1";
const steelKey = process.env.STEEL_API_KEY;

if (!steelKey) {
  throw new Error("STEEL_API_KEY is missing.");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parsePlaylist(text, playlistUrl) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const mapMatch = lines
    .find((line) => line.startsWith("#EXT-X-MAP:"))
    ?.match(/URI=(?:"([^"]+)"|([^,]+))/i);
  const media = lines.filter((line) => !line.startsWith("#"));
  const resolve = (value) => (value ? new URL(value, playlistUrl).toString() : null);
  return {
    finalized: lines.includes("#EXT-X-ENDLIST"),
    initUrl: resolve(mapMatch?.[1] ?? mapMatch?.[2] ?? null),
    mediaUrls: media.map(resolve).filter(Boolean),
    durationSeconds: lines
      .filter((line) => line.startsWith("#EXTINF:"))
      .reduce((total, line) => total + Number(line.slice(8).split(",", 1)[0] || 0), 0),
    lineCount: lines.length,
  };
}

function topLevelBoxes(bytes) {
  const boxes = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 8 <= bytes.byteLength && boxes.length < 20) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let header = 8;
    if (size === 1 && offset + 16 <= bytes.byteLength) {
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = bytes.byteLength - offset;
    }
    if (size < header || offset + size > bytes.byteLength) break;
    boxes.push(type);
    offset += size;
  }
  return boxes;
}

async function steelFetch(url, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("steel-api-key", steelKey);
  return fetch(url, { ...init, headers });
}

let sessionId;
let released = false;

try {
  const created = await steelFetch(`${STEEL_BASE}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      startUrl: "https://example.com/",
      dimensions: { width: 1280, height: 800 },
      recordSession: true,
      timeout: 120000,
    }),
  });
  if (!created.ok) throw new Error(`Session create failed with HTTP ${created.status}.`);
  const session = await created.json();
  sessionId = session.id;

  await sleep(8000);
  const release = await steelFetch(`${STEEL_BASE}/sessions/${sessionId}/release`, {
    method: "POST",
  });
  released = release.ok;
  if (!release.ok) throw new Error(`Session release failed with HTTP ${release.status}.`);

  const playlistUrl = `${STEEL_BASE}/sessions/${sessionId}/hls`;
  const attempts = [];
  let parsed;
  let playlistContentType = null;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const response = await steelFetch(playlistUrl);
    const body = await response.text();
    playlistContentType = response.headers.get("content-type");
    parsed = response.ok && body.startsWith("#EXTM3U") ? parsePlaylist(body, playlistUrl) : null;
    attempts.push({
      attempt,
      status: response.status,
      playlist: Boolean(parsed),
      finalized: parsed?.finalized ?? false,
      mediaCount: parsed?.mediaUrls.length ?? 0,
    });
    if (parsed?.finalized) break;
    await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
  }

  if (!parsed?.finalized) {
    console.log(JSON.stringify({ released, playlistContentType, attempts }, null, 2));
    process.exitCode = 2;
  } else {
    const urls = [...(parsed.initUrl ? [parsed.initUrl] : []), ...parsed.mediaUrls];
    const parts = [];
    for (const url of urls) {
      const response = await steelFetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      parts.push({
        status: response.status,
        contentType: response.headers.get("content-type"),
        byteLength: bytes.byteLength,
        boxes: response.ok ? topLevelBoxes(bytes) : [],
      });
    }
    console.log(
      JSON.stringify(
        {
          released,
          playlistContentType,
          attempts,
          playlist: {
            finalized: parsed.finalized,
            hasInitMap: Boolean(parsed.initUrl),
            mediaCount: parsed.mediaUrls.length,
            durationSeconds: parsed.durationSeconds,
          },
          parts,
        },
        null,
        2,
      ),
    );
  }
} finally {
  if (sessionId && !released) {
    await steelFetch(`${STEEL_BASE}/sessions/${sessionId}/release`, { method: "POST" }).catch(
      () => undefined,
    );
  }
}
