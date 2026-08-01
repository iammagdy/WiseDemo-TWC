export type AppwriteConfig = {
  endpoint: string;
  projectId: string;
  apiKey: string;
  databaseId: string;
  projectsTableId: string;
  credentialsTableId: string;
  demosTableId: string;
  demoEventsTableId: string;
  compositionsTableId: string;
  compositionExportsTableId: string;
  recordingsBucketId: string;
};

const APPWRITE_ENV = {
  endpoint: "APPWRITE_ENDPOINT",
  projectId: "APPWRITE_PROJECT_ID",
  apiKey: "APPWRITE_API_KEY",
  databaseId: "APPWRITE_DATABASE_ID",
  projectsTableId: "APPWRITE_PROJECTS_COLLECTION_ID",
  credentialsTableId: "APPWRITE_CREDENTIALS_COLLECTION_ID",
  demosTableId: "APPWRITE_DEMOS_COLLECTION_ID",
  demoEventsTableId: "APPWRITE_DEMO_EVENTS_COLLECTION_ID",
  compositionsTableId: "APPWRITE_COMPOSITIONS_COLLECTION_ID",
  compositionExportsTableId: "APPWRITE_COMPOSITION_EXPORTS_COLLECTION_ID",
  recordingsBucketId: "APPWRITE_RECORDINGS_BUCKET_ID",
} as const;

const APPWRITE_RESOURCE_DEFAULTS = {
  databaseId: "wisedemo",
  projectsTableId: "projects",
  credentialsTableId: "project_credentials",
  demosTableId: "demos",
  demoEventsTableId: "demo_events",
  compositionsTableId: "compositions",
  compositionExportsTableId: "composition_exports",
  recordingsBucketId: "demo-recordings",
} as const;

function configured(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getAppwriteConfig(): AppwriteConfig {
  const required = [APPWRITE_ENV.endpoint, APPWRITE_ENV.projectId, APPWRITE_ENV.apiKey];
  const missing = required.filter((name) => !configured(name));
  if (missing.length) {
    throw new Error(
      `Missing Appwrite environment variable(s): ${missing.join(", ")}. Configure the server-only Appwrite integration.`,
    );
  }

  const endpoint = configured(APPWRITE_ENV.endpoint) as string;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("APPWRITE_ENDPOINT must be a valid HTTP(S) URL ending in /v1.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.pathname.replace(/\/$/, "").endsWith("/v1")
  ) {
    throw new Error("APPWRITE_ENDPOINT must be a valid HTTP(S) URL ending in /v1.");
  }

  return {
    endpoint: endpoint.replace(/\/$/, ""),
    projectId: configured(APPWRITE_ENV.projectId) as string,
    apiKey: configured(APPWRITE_ENV.apiKey) as string,
    databaseId: configured(APPWRITE_ENV.databaseId) ?? APPWRITE_RESOURCE_DEFAULTS.databaseId,
    projectsTableId:
      configured(APPWRITE_ENV.projectsTableId) ?? APPWRITE_RESOURCE_DEFAULTS.projectsTableId,
    credentialsTableId:
      configured(APPWRITE_ENV.credentialsTableId) ?? APPWRITE_RESOURCE_DEFAULTS.credentialsTableId,
    demosTableId: configured(APPWRITE_ENV.demosTableId) ?? APPWRITE_RESOURCE_DEFAULTS.demosTableId,
    demoEventsTableId:
      configured(APPWRITE_ENV.demoEventsTableId) ?? APPWRITE_RESOURCE_DEFAULTS.demoEventsTableId,
    compositionsTableId:
      configured(APPWRITE_ENV.compositionsTableId) ??
      APPWRITE_RESOURCE_DEFAULTS.compositionsTableId,
    compositionExportsTableId:
      configured(APPWRITE_ENV.compositionExportsTableId) ??
      APPWRITE_RESOURCE_DEFAULTS.compositionExportsTableId,
    recordingsBucketId:
      configured(APPWRITE_ENV.recordingsBucketId) ?? APPWRITE_RESOURCE_DEFAULTS.recordingsBucketId,
  };
}
