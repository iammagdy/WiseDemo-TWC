export type ProviderRetryEvent = {
  provider: string;
  stage: string;
  attempt: number;
  retryable: boolean;
  status: number | null;
  durationMs: number;
};

type RetryFailure = {
  code?: number | string;
  status?: number;
  response?: { status?: number; headers?: Headers | Record<string, string | undefined> };
  headers?: Headers | Record<string, string | undefined>;
};

function statusFromError(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const failure = error as RetryFailure;
  const value = failure.status ?? failure.response?.status ?? failure.code;
  return typeof value === "number" ? value : null;
}

function headerValue(error: unknown, name: string): string | null {
  if (!error || typeof error !== "object") return null;
  const failure = error as RetryFailure;
  const headers = failure.response?.headers ?? failure.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

export function retryAfterMs(error: unknown, now = Date.now()): number | null {
  const raw = headerValue(error, "retry-after")?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.min(60_000, Math.max(0, date - now)) : null;
}

export function isRetryableProviderError(provider: "context" | "gemini", error: unknown): boolean {
  const status = statusFromError(error);
  if (provider === "context") return status === 408 || status === 429 || status === 500;
  if (status === 429 || status === 500 || status === 503) return true;
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as RetryFailure).code ?? "").toLowerCase()
      : "";
  return ["rate_limit_exceeded", "api_error", "service_unavailable"].includes(code);
}

export async function retryProviderCall<T>(options: {
  provider: "context" | "gemini";
  stage: string;
  execute: () => Promise<T>;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<unknown>;
  random?: () => number;
  onEvent?: (event: ProviderRetryEvent) => void;
}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const result = await options.execute();
      options.onEvent?.({
        provider: options.provider,
        stage: options.stage,
        attempt,
        retryable: false,
        status: null,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableProviderError(options.provider, error) && attempt < maxAttempts;
      options.onEvent?.({
        provider: options.provider,
        stage: options.stage,
        attempt,
        retryable,
        status: statusFromError(error),
        durationMs: Date.now() - startedAt,
      });
      if (!retryable) throw error;
      const requestedDelay = retryAfterMs(error);
      const exponentialDelay = Math.min(4_000, 1_000 * 2 ** (attempt - 1));
      const jitter = Math.round(exponentialDelay * 0.2 * random());
      await sleep(requestedDelay ?? exponentialDelay + jitter);
    }
  }
  throw lastError ?? new Error("Provider retry loop ended unexpectedly.");
}
