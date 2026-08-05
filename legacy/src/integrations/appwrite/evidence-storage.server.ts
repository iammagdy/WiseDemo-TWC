import { InputFile } from "node-appwrite/file";

import { appwriteServer } from "./client.server";

export async function storeEvidenceScreenshot(fileId: string, bytes: Uint8Array): Promise<void> {
  const { storage, config } = appwriteServer();
  await storage.deleteFile({ bucketId: config.evidenceBucketId, fileId }).catch(() => undefined);
  await storage.createFile({
    bucketId: config.evidenceBucketId,
    fileId,
    file: InputFile.fromBuffer(bytes, `${fileId}.jpg`),
    permissions: [],
  });
}

export async function fetchEvidenceScreenshot(
  fileId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Response> {
  const { config } = appwriteServer();
  return fetch(
    `${config.endpoint}/storage/buckets/${encodeURIComponent(config.evidenceBucketId)}/files/${encodeURIComponent(fileId)}/view`,
    {
      headers: { "X-Appwrite-Project": config.projectId, "X-Appwrite-Key": config.apiKey },
      signal: options.signal,
    },
  );
}
