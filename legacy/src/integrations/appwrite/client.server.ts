import { Client, Storage, TablesDB } from "node-appwrite";

import { getAppwriteConfig } from "./config.server.ts";

let services:
  | {
      tables: TablesDB;
      storage: Storage;
      config: ReturnType<typeof getAppwriteConfig>;
    }
  | undefined;

const RETRYABLE_METHODS = new Set(["getRow", "listRows", "updateRow", "upsertRow"]);
export const MAX_APPWRITE_TRANSPORT_ATTEMPTS = 12;

export function appwriteRetryDelayMs(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** (attempt - 1));
}

export function isRetryableAppwriteTransportError(error: unknown): boolean {
  const failure = error as { message?: string; cause?: { code?: string } } | null;
  return (
    [
      "UND_ERR_CONNECT_TIMEOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
    ].includes(failure?.cause?.code ?? "") ||
    /fetch failed|connect timeout|socket hang up/i.test(failure?.message ?? "")
  );
}

export function withAppwriteTransportRetries<T extends object>(
  service: T,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): T {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || !RETRYABLE_METHODS.has(String(property))) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        for (let attempt = 1; ; attempt += 1) {
          try {
            return await value.apply(target, args);
          } catch (error) {
            if (
              !isRetryableAppwriteTransportError(error) ||
              attempt >= MAX_APPWRITE_TRANSPORT_ATTEMPTS
            ) {
              throw error;
            }
            await delay(appwriteRetryDelayMs(attempt));
          }
        }
      };
    },
  });
}

export function appwriteServer() {
  if (services) return services;
  const config = getAppwriteConfig();
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setKey(config.apiKey);
  services = {
    tables: withAppwriteTransportRetries(new TablesDB(client)),
    storage: new Storage(client),
    config,
  };
  return services;
}

export function resetAppwriteServerForTests(): void {
  services = undefined;
}
