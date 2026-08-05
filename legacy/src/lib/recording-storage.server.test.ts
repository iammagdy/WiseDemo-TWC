import assert from "node:assert/strict";
import test from "node:test";

import {
  recordingFileId,
  RecordingStorageError,
  storeRecordingArtifact,
  type RecordingStorageClient,
} from "./recording-storage.server.ts";

function fakeStorage(options: { uploadFails?: boolean; playbackFails?: boolean } = {}) {
  const uploads: string[] = [];
  const storage: RecordingStorageClient = {
    upsertRecording: async (fileId) => {
      uploads.push(fileId);
      if (options.uploadFails) throw new Error("simulated upload failure");
    },
    fetchRecording: async () => {
      if (options.playbackFails) throw new Error("simulated playback failure");
      return new Response(new ArrayBuffer(0), {
        status: 206,
        headers: { "content-type": "video/mp4" },
      });
    },
  };
  return { storage, uploads };
}

test("uses the deterministic demo id as the Appwrite file id", async () => {
  const fileId = recordingFileId("11111111-1111-4111-8111-111111111111");
  assert.equal(fileId, "11111111-1111-4111-8111-111111111111");
  const { storage, uploads } = fakeStorage();

  await storeRecordingArtifact({ storage, fileId, bytes: new Uint8Array([1]) });
  await storeRecordingArtifact({ storage, fileId, bytes: new Uint8Array([1]) });

  assert.deepEqual(uploads, [fileId, fileId]);
});

test("surfaces Appwrite upload failure as retryable", async () => {
  const { storage } = fakeStorage({ uploadFails: true });
  await assert.rejects(
    storeRecordingArtifact({
      storage,
      fileId: "11111111-1111-4111-8111-111111111111",
      bytes: new Uint8Array([1]),
    }),
    (error) =>
      error instanceof RecordingStorageError &&
      error.code === "APPWRITE_UPLOAD_FAILED" &&
      error.retryable,
  );
});

test("surfaces Appwrite playback verification failure as retryable", async () => {
  const { storage } = fakeStorage({ playbackFails: true });
  await assert.rejects(
    storeRecordingArtifact({
      storage,
      fileId: "11111111-1111-4111-8111-111111111111",
      bytes: new Uint8Array([1]),
    }),
    (error) =>
      error instanceof RecordingStorageError &&
      error.code === "APPWRITE_PLAYBACK_VERIFICATION_FAILED" &&
      error.retryable,
  );
});
