export const WISE_RESUME_APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
export const WISE_RESUME_APPWRITE_PROJECT_ID = "69fd362b001eb325a192";
export const WISE_RESUME_WEB_SDK_VERSION = "25.0.0";
export const WISE_RESUME_RESPONSE_FORMAT = "1.9.2";

export type WiseResumeInventoryRequestStatus =
  | "success"
  | "unauthorized"
  | "forbidden"
  | "invalid-query"
  | "not-found"
  | "rate-limited"
  | "server-error"
  | "network-error"
  | "invalid-response";

export type WiseResumeHttpStatusClass = "2xx" | "4xx" | "5xx" | "network" | "unknown";

export function serializeWiseResumeWebSdkQuery(
  method: string,
  attribute: string | undefined,
  value: unknown,
): string {
  const query: { method: string; attribute?: string; values?: unknown[] } = { method };
  if (attribute !== undefined) query.attribute = attribute;
  if (value !== undefined) query.values = Array.isArray(value) ? value : [value];
  return JSON.stringify(query);
}

export function wiseResumeInventoryQueries(authenticatedUserId: string): string[] {
  return [
    serializeWiseResumeWebSdkQuery("equal", "user_id", [authenticatedUserId]),
    serializeWiseResumeWebSdkQuery("orderDesc", "$updatedAt", undefined),
    serializeWiseResumeWebSdkQuery("limit", undefined, 50),
  ];
}

export function wiseResumeWebSdkHeaders(): Record<string, string> {
  return {
    "X-Appwrite-Project": WISE_RESUME_APPWRITE_PROJECT_ID,
    "X-Appwrite-Response-Format": WISE_RESUME_RESPONSE_FORMAT,
    "x-sdk-name": "Web",
    "x-sdk-platform": "client",
    "x-sdk-language": "web",
    "x-sdk-version": WISE_RESUME_WEB_SDK_VERSION,
  };
}

export function classifyWiseResumeInventoryHttpStatus(status: number): {
  requestStatus: WiseResumeInventoryRequestStatus;
  httpStatusClass: WiseResumeHttpStatusClass;
} {
  if (status >= 200 && status < 300) return { requestStatus: "success", httpStatusClass: "2xx" };
  if (status === 400) return { requestStatus: "invalid-query", httpStatusClass: "4xx" };
  if (status === 401) return { requestStatus: "unauthorized", httpStatusClass: "4xx" };
  if (status === 403) return { requestStatus: "forbidden", httpStatusClass: "4xx" };
  if (status === 404) return { requestStatus: "not-found", httpStatusClass: "4xx" };
  if (status === 429) return { requestStatus: "rate-limited", httpStatusClass: "4xx" };
  if (status >= 500 && status < 600)
    return { requestStatus: "server-error", httpStatusClass: "5xx" };
  return { requestStatus: "invalid-query", httpStatusClass: status >= 400 ? "4xx" : "unknown" };
}

export function wiseResumeWebSdkQueryRuntimeSource(): string {
  return `const sdkQuery = (method, attribute, value) => {
    const query = { method };
    if (attribute !== undefined) query.attribute = attribute;
    if (value !== undefined) query.values = Array.isArray(value) ? value : [value];
    return JSON.stringify(query);
  };`;
}
