import assert from "node:assert/strict";
import test from "node:test";

import {
  recordingObjectPath,
  RecordingStorageError,
  storeRecordingArtifact,
  type RecordingStorageClient,
} from "./recording-storage.server.ts";

function fakeStorage(options: { uploadFails?: boolean } = {}) {
  const uploads: Array<{ path: string; upsert: boolean }> = [];
  const storage: RecordingStorageClient = {
    from: () => ({
      upload: async (path, _body, uploadOptions) => {
        uploads.push({ path, upsert: uploadOptions.upsert });
        return {
          error: options.uploadFails ? { message: "simulated upload failure" } : null,
        };
      },
      createSignedUrl: async () => ({
        data: { signedUrl: "https://storage.example.test/signed-recording" },
        error: null,
      }),
    }),
  };
  return { storage, uploads };
}

test("uses a deterministic collision-safe path and upsert for idempotency", async () => {
  const path = recordingObjectPath(
    "00000000-0000-0000-0000-000000000001",
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(
    path,
    "00000000-0000-0000-0000-000000000001/11111111-1111-4111-8111-111111111111/recording.mp4",
  );
  const { storage, uploads } = fakeStorage();
  const fetchImpl = (async () =>
    new Response(new ArrayBuffer(0), {
      headers: { "content-type": "video/mp4" },
    })) as typeof fetch;

  await storeRecordingArtifact({ storage, path, bytes: new Uint8Array([1]), fetchImpl });
  await storeRecordingArtifact({ storage, path, bytes: new Uint8Array([1]), fetchImpl });

  assert.deepEqual(uploads, [
    { path, upsert: true },
    { path, upsert: true },
  ]);
});

test("surfaces Supabase upload failure as retryable", async () => {
  const { storage } = fakeStorage({ uploadFails: true });
  await assert.rejects(
    storeRecordingArtifact({
      storage,
      path: "owner/demo/recording.mp4",
      bytes: new Uint8Array([1]),
    }),
    (error) =>
      error instanceof RecordingStorageError &&
      error.code === "SUPABASE_UPLOAD_FAILED" &&
      error.retryable,
  );
});
