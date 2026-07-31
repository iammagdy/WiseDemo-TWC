import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchFinalizedHlsMp4,
  normalizeSelectorCandidates,
  parseHlsPlaylist,
  splitSelectorList,
  SteelRecordingError,
} from "./steel-recorder.server.ts";

const playlistUrl = "https://api.steel.dev/v1/sessions/session-id/hls";

function box(type: string, payloadLength = 0): Uint8Array {
  const bytes = new Uint8Array(8 + payloadLength);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
  for (let index = 0; index < 4; index += 1) bytes[4 + index] = type.charCodeAt(index);
  return bytes;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const initMp4 = concat(box("ftyp", 4), box("moov", 4));
const mediaSegment = concat(box("moof", 4), box("mdat", 4));

const finalizedPlaylist = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI="media/init.mp4"
#EXTINF:1.25,
media/segment-1.m4s
#EXTINF:2.5,
https://media.example.test/segment-2.m4s
#EXT-X-ENDLIST
`;

test("parses finalized HLS with relative map and media URLs", () => {
  const parsed = parseHlsPlaylist(finalizedPlaylist, playlistUrl);
  assert.equal(parsed.finalized, true);
  assert.equal(parsed.durationSeconds, 3.75);
  assert.equal(parsed.init?.url, "https://api.steel.dev/v1/sessions/session-id/media/init.mp4");
  assert.deepEqual(
    parsed.segments.map((segment) => segment.url),
    [
      "https://api.steel.dev/v1/sessions/session-id/media/segment-1.m4s",
      "https://media.example.test/segment-2.m4s",
    ],
  );
});

test("detects a playlist that is not finalized", () => {
  const parsed = parseHlsPlaylist(
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nsegment.m4s\n',
    playlistUrl,
  );
  assert.equal(parsed.finalized, false);
});

test("retries recording-not-ready responses and downloads every authenticated part", async () => {
  let playlistCalls = 0;
  const authenticatedUrls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (headers.get("steel-api-key") === "test-key") authenticatedUrls.push(url);
    if (url === playlistUrl) {
      playlistCalls += 1;
      if (playlistCalls < 3) return new Response("not ready", { status: 404 });
      return new Response(finalizedPlaylist, {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }
    if (url.endsWith("init.mp4")) return new Response(responseBody(initMp4));
    if (url.endsWith(".m4s")) return new Response(responseBody(mediaSegment));
    return new Response("missing", { status: 404 });
  }) as typeof fetch;

  const result = await fetchFinalizedHlsMp4({
    playlistUrl,
    apiKey: "test-key",
    attempts: 4,
    fetchImpl,
    sleep: async () => undefined,
  });

  assert.ok(result);
  assert.equal(playlistCalls, 3);
  assert.equal(result.durationSeconds, 4);
  assert.equal(result.bytes.byteLength, initMp4.byteLength + mediaSegment.byteLength * 2);
  assert.equal(authenticatedUrls.length, 6);
});

test("returns pending after bounded attempts without an end list", async () => {
  const fetchImpl = (async () =>
    new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n')) as typeof fetch;
  const result = await fetchFinalizedHlsMp4({
    playlistUrl,
    apiKey: "test-key",
    attempts: 2,
    fetchImpl,
    sleep: async () => undefined,
  });
  assert.equal(result, null);
});

test("fails the whole artifact when any finalized segment cannot download", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === playlistUrl) return new Response(finalizedPlaylist);
    if (url.endsWith("init.mp4")) return new Response(responseBody(initMp4));
    if (url.endsWith("segment-1.m4s")) return new Response(responseBody(mediaSegment));
    return new Response("temporary failure", { status: 503 });
  }) as typeof fetch;

  await assert.rejects(
    fetchFinalizedHlsMp4({
      playlistUrl,
      apiKey: "test-key",
      fetchImpl,
      sleep: async () => undefined,
    }),
    (error) =>
      error instanceof SteelRecordingError &&
      error.code === "STEEL_SEGMENT_DOWNLOAD_FAILED" &&
      error.retryable,
  );
});

test("splits selector fallbacks without breaking commas inside pseudo arguments", () => {
  assert.deepEqual(splitSelectorList('button[type="submit"], button:has-text("Sign in, please")'), [
    'button[type="submit"]',
    'button:has-text("Sign in, please")',
  ]);
  assert.deepEqual(
    normalizeSelectorCandidates('button:has-text("Sign in")', ['button[type="submit"]']),
    [{ css: "button", text: "Sign in" }, { css: 'button[type="submit"]' }],
  );
});
