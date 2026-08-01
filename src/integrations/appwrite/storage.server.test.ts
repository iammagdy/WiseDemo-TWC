import assert from "node:assert/strict";
import test from "node:test";

import { fetchAppwriteRecording } from "./storage.server.ts";

test("fetches private Appwrite media with server credentials and a byte range", async () => {
  let requestedUrl = "";
  let requestedHeaders = new Headers();
  const fetchImpl = (async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": "bytes 0-2/3",
        "content-type": "video/mp4",
      },
    });
  }) as typeof fetch;

  const response = await fetchAppwriteRecording(
    {
      endpoint: "https://fra.cloud.appwrite.io/v1",
      projectId: "project-id",
      apiKey: "server-secret",
      recordingsBucketId: "demo-recordings",
    },
    "11111111-1111-4111-8111-111111111111",
    { range: "bytes=0-31", fetchImpl },
  );

  assert.equal(response.status, 206);
  assert.equal(
    requestedUrl,
    "https://fra.cloud.appwrite.io/v1/storage/buckets/demo-recordings/files/11111111-1111-4111-8111-111111111111/view",
  );
  assert.equal(requestedHeaders.get("range"), "bytes=0-31");
  assert.equal(requestedHeaders.get("x-appwrite-project"), "project-id");
  assert.equal(requestedHeaders.get("x-appwrite-key"), "server-secret");
  assert.equal(requestedUrl.includes("server-secret"), false);
});

test("retries private Appwrite range reads after a transport failure", async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("fetch failed");
    return new Response(new Uint8Array([1]), { status: 206 });
  }) as typeof fetch;

  const response = await fetchAppwriteRecording(
    {
      endpoint: "https://fra.cloud.appwrite.io/v1",
      projectId: "project-id",
      apiKey: "server-secret",
      recordingsBucketId: "demo-recordings",
    },
    "11111111-1111-4111-8111-111111111111",
    { range: "bytes=0-0", fetchImpl },
  );

  assert.equal(attempts, 2);
  assert.equal(response.status, 206);
});
