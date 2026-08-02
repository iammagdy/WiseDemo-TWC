import ContextDev from "context.dev";

import { serverEnv } from "../../lib/server-env.server.ts";

export type ContextDevClient = Pick<ContextDev, "brand" | "web">;

export function createContextClient(): ContextDevClient {
  const apiKey = serverEnv("CONTEXT_DEV_API_KEY");
  if (!apiKey || apiKey.length < 8) {
    throw new Error("CONTEXT_DEV_API_KEY is not configured in the server environment.");
  }
  return new ContextDev({ apiKey, timeout: 90_000, maxRetries: 0 });
}
