export type RecordingStorageClient = {
  upsertRecording: (fileId: string, bytes: Uint8Array) => Promise<void>;
  fetchRecording: (fileId: string, range?: string) => Promise<Response>;
};

export class RecordingStorageError extends Error {
  readonly code: string;
  readonly retryable = true;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecordingStorageError";
    this.code = code;
  }
}

export function recordingFileId(demoId: string): string {
  return demoId;
}

export async function storeRecordingArtifact(options: {
  storage: RecordingStorageClient;
  fileId: string;
  bytes: Uint8Array;
}): Promise<void> {
  try {
    await options.storage.upsertRecording(options.fileId, options.bytes);
  } catch {
    throw new RecordingStorageError(
      "APPWRITE_UPLOAD_FAILED",
      "Completed video could not be uploaded to storage.",
    );
  }

  let verification: Response;
  try {
    verification = await options.storage.fetchRecording(options.fileId, "bytes=0-31");
  } catch {
    throw new RecordingStorageError(
      "APPWRITE_PLAYBACK_VERIFICATION_FAILED",
      "Uploaded Appwrite video could not be fetched for playback verification.",
    );
  }
  const contentType = verification.headers.get("content-type") ?? "";
  await verification.body?.cancel().catch(() => undefined);
  if (!verification.ok || !contentType.toLowerCase().includes("video/mp4")) {
    throw new RecordingStorageError(
      "APPWRITE_PLAYBACK_VERIFICATION_FAILED",
      "Uploaded Appwrite video failed its playback verification.",
    );
  }
}
