export type RecordingStorageClient = {
  from: (bucket: string) => {
    upload: (
      path: string,
      body: Uint8Array,
      options: { contentType: string; cacheControl: string; upsert: boolean },
    ) => Promise<{ error: { message: string } | null }>;
    createSignedUrl: (
      path: string,
      expiresIn: number,
    ) => Promise<{
      data: { signedUrl: string } | null;
      error: { message: string } | null;
    }>;
  };
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

export function recordingObjectPath(ownerId: string, demoId: string): string {
  return `${ownerId}/${demoId}/recording.mp4`;
}

export async function storeRecordingArtifact(options: {
  storage: RecordingStorageClient;
  path: string;
  bytes: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const bucket = options.storage.from("demo-recordings");
  const upload = await bucket.upload(options.path, options.bytes, {
    contentType: "video/mp4",
    cacheControl: "3600",
    upsert: true,
  });
  if (upload.error) {
    throw new RecordingStorageError(
      "SUPABASE_UPLOAD_FAILED",
      "Completed video could not be uploaded to storage.",
    );
  }

  const signed = await bucket.createSignedUrl(options.path, 5 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    throw new RecordingStorageError(
      "SUPABASE_SIGNED_URL_FAILED",
      "Uploaded video could not be signed for playback.",
    );
  }

  const verification = await (options.fetchImpl ?? fetch)(signed.data.signedUrl, {
    headers: { Range: "bytes=0-31" },
  });
  const contentType = verification.headers.get("content-type") ?? "";
  await verification.body?.cancel().catch(() => undefined);
  if (!verification.ok || !contentType.toLowerCase().includes("video/mp4")) {
    throw new RecordingStorageError(
      "STORAGE_PLAYBACK_VERIFICATION_FAILED",
      "Uploaded video URL failed its playback verification.",
    );
  }
}
