import type { Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

import type { RecordingStorageClient } from "@/lib/recording-storage.server";

import {
  appwriteRetryDelayMs,
  appwriteServer,
  isRetryableAppwriteTransportError,
  MAX_APPWRITE_TRANSPORT_ATTEMPTS,
} from "./client.server.ts";
import type { AppwriteConfig } from "./config.server.ts";

type AppwriteFailure = { code?: number };

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as AppwriteFailure).code === 404;
}

async function withStorageTransportRetries<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableAppwriteTransportError(error) || attempt >= MAX_APPWRITE_TRANSPORT_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, appwriteRetryDelayMs(attempt)));
    }
  }
}

export function appwriteFileUrl(
  config: Pick<AppwriteConfig, "endpoint" | "recordingsBucketId">,
  fileId: string,
): string {
  return `${config.endpoint}/storage/buckets/${encodeURIComponent(config.recordingsBucketId)}/files/${encodeURIComponent(fileId)}/view`;
}

export async function fetchAppwriteRecording(
  config: Pick<AppwriteConfig, "endpoint" | "projectId" | "apiKey" | "recordingsBucketId">,
  fileId: string,
  options: { range?: string | null; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const headers = new Headers({
    "X-Appwrite-Project": config.projectId,
    "X-Appwrite-Key": config.apiKey,
  });
  if (options.range) headers.set("Range", options.range);
  const fetchImpl = options.fetchImpl ?? fetch;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetchImpl(appwriteFileUrl(config, fileId), {
        headers,
        redirect: "follow",
        signal: options.signal,
      });
      if (
        ![429, 502, 503, 504].includes(response.status) ||
        attempt >= MAX_APPWRITE_TRANSPORT_ATTEMPTS
      ) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (
        options.signal?.aborted ||
        !isRetryableAppwriteTransportError(error) ||
        attempt >= MAX_APPWRITE_TRANSPORT_ATTEMPTS
      ) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, appwriteRetryDelayMs(attempt)));
  }
}

export class AppwriteRecordingStorage implements RecordingStorageClient {
  readonly #storage: Storage;
  readonly #config: Pick<
    AppwriteConfig,
    "endpoint" | "projectId" | "apiKey" | "recordingsBucketId"
  >;

  constructor(
    storage: Storage,
    config: Pick<AppwriteConfig, "endpoint" | "projectId" | "apiKey" | "recordingsBucketId">,
  ) {
    this.#storage = storage;
    this.#config = config;
  }

  async upsertRecording(fileId: string, bytes: Uint8Array): Promise<void> {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        try {
          await withStorageTransportRetries(() =>
            this.#storage.deleteFile({
              bucketId: this.#config.recordingsBucketId,
              fileId,
            }),
          );
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }

        await this.#storage.createFile({
          bucketId: this.#config.recordingsBucketId,
          fileId,
          file: InputFile.fromBuffer(bytes, `${fileId}.mp4`),
          permissions: [],
        });
      } catch (error) {
        if (!isRetryableAppwriteTransportError(error) || attempt >= 5) throw error;
      }

      if (await this.#verifyStoredRecording(fileId, bytes.byteLength)) return;
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, appwriteRetryDelayMs(attempt)));
      }
    }

    throw new Error("Appwrite stored recording metadata without a playable file.");
  }

  async #verifyStoredRecording(fileId: string, expectedSize: number): Promise<boolean> {
    try {
      const stored = await withStorageTransportRetries(() =>
        this.#storage.getFile({
          bucketId: this.#config.recordingsBucketId,
          fileId,
        }),
      );
      if (stored.sizeOriginal !== expectedSize) return false;
      const response = await fetchAppwriteRecording(this.#config, fileId, { range: "bytes=0-31" });
      if (![200, 206].includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        return false;
      }
      const header = new Uint8Array(await response.arrayBuffer());
      return (
        header.byteLength >= 12 && new TextDecoder().decode(header.slice(4, 12)).startsWith("ftyp")
      );
    } catch (error) {
      if (isNotFound(error) || isRetryableAppwriteTransportError(error)) return false;
      throw error;
    }
  }

  fetchRecording(fileId: string, range?: string): Promise<Response> {
    return fetchAppwriteRecording(this.#config, fileId, { range });
  }
}

export function appwriteRecordingStorage(): AppwriteRecordingStorage {
  const { storage, config } = appwriteServer();
  return new AppwriteRecordingStorage(storage, config);
}
