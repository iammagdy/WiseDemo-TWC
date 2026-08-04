import assert from "node:assert/strict";
import test from "node:test";
import { createFile, type MP4BoxBuffer } from "mp4box";

import {
  fetchFinalizedHlsMp4,
  finalizeFragmentedMp4,
  listIsoBmffBoxes,
  normalizeSelectorCandidates,
  parseHlsPlaylist,
  splitSelectorList,
  SteelRecordingError,
} from "./steel-recorder.server.ts";

const playlistUrl = "https://api.steel.dev/v1/sessions/session-id/hls";

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fragmentedFixture(): { init: Uint8Array; segments: Uint8Array[] } {
  const file = createFile();
  const trackId = file.addTrack({
    type: "avc1",
    timescale: 1_000,
    width: 16,
    height: 16,
  });
  file.addSample(trackId, new Uint8Array([0, 0, 0, 1, 9]), {
    duration: 1_000,
    dts: 0,
    cts: 0,
    is_sync: true,
  });
  file.addSample(trackId, new Uint8Array([0, 0, 0, 1, 9]), {
    duration: 1_000,
    dts: 1_000,
    cts: 1_000,
    is_sync: true,
  });
  const bytes = new Uint8Array(file.getBuffer().buffer);
  const view = new DataView(bytes.buffer);
  const top: Array<{ offset: number; size: number; type: string }> = [];
  for (let offset = 0; offset + 8 <= bytes.byteLength;) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    top.push({ offset, size, type });
    offset += size;
  }
  const firstMoof = top.findIndex((entry) => entry.type === "moof");
  const segments: Uint8Array[] = [];
  for (let index = firstMoof; index < top.length; index += 2) {
    const moof = top[index];
    const mdat = top[index + 1];
    assert.equal(moof?.type, "moof");
    assert.equal(mdat?.type, "mdat");
    segments.push(bytes.slice(moof.offset, mdat.offset + mdat.size));
  }
  return { init: bytes.slice(0, top[firstMoof].offset), segments };
}

const fixture = fragmentedFixture();
const initMp4 = fixture.init;
const mediaSegment = fixture.segments[0];

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
  assert.deepEqual(
    parsed.segments.map((segment) => segment.durationSeconds),
    [1.25, 2.5],
  );
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
    if (url.endsWith("segment-1.m4s")) {
      return new Response(responseBody(fixture.segments[0]));
    }
    if (url.endsWith("segment-2.m4s")) {
      return new Response(responseBody(fixture.segments[1]));
    }
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
  assert.deepEqual(listIsoBmffBoxes(result.bytes), ["ftyp", "moov", "mdat"]);
  const remuxed = result.bytes.slice().buffer as MP4BoxBuffer;
  remuxed.fileStart = 0;
  const parsed = createFile(true);
  parsed.appendBuffer(remuxed, true);
  parsed.flush();
  assert.equal(parsed.getInfo().isFragmented, false);
  assert.equal(parsed.getInfo().tracks[0]?.nb_samples, 2);
  const parsedTrack = parsed.getTrackById(1);
  const mdat = parsed.boxes.find((entry) => entry.type === "mdat");
  assert.equal(
    (parsedTrack.mdia.minf.stbl.stco ?? parsedTrack.mdia.minf.stbl.co64).chunk_offsets[0],
    (mdat?.start ?? 0) + (mdat?.hdr_size ?? 0),
  );
  assert.deepEqual(parsed.getTrackSample(1, 0).data, new Uint8Array([0, 0, 0, 1, 9]));
  assert.equal(authenticatedUrls.length, 6);
});

test("rejects standalone fragmented MP4 output without per-fragment durations", () => {
  assert.throws(
    () => finalizeFragmentedMp4(initMp4, [mediaSegment], []),
    (error) => error instanceof SteelRecordingError && error.code === "INVALID_HLS_DURATION",
  );
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
