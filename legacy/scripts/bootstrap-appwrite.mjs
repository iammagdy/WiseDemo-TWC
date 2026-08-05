import { Client, Compression, Storage, TablesDB, TablesDBIndexType } from "node-appwrite";

const envNames = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_SETUP_API_KEY"];

const missing = envNames.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(`Missing Appwrite bootstrap environment variable(s): ${missing.join(", ")}.`);
}

const config = {
  endpoint: process.env.APPWRITE_ENDPOINT.trim().replace(/\/$/, ""),
  projectId: process.env.APPWRITE_PROJECT_ID.trim(),
  setupKey: process.env.APPWRITE_SETUP_API_KEY.trim(),
  databaseId: process.env.APPWRITE_DATABASE_ID?.trim() || "wisedemo",
  projectsTableId: process.env.APPWRITE_PROJECTS_COLLECTION_ID?.trim() || "projects",
  credentialsTableId:
    process.env.APPWRITE_CREDENTIALS_COLLECTION_ID?.trim() || "project_credentials",
  demosTableId: process.env.APPWRITE_DEMOS_COLLECTION_ID?.trim() || "demos",
  eventsTableId: process.env.APPWRITE_DEMO_EVENTS_COLLECTION_ID?.trim() || "demo_events",
  compositionsTableId: process.env.APPWRITE_COMPOSITIONS_COLLECTION_ID?.trim() || "compositions",
  compositionExportsTableId:
    process.env.APPWRITE_COMPOSITION_EXPORTS_COLLECTION_ID?.trim() || "composition_exports",
  productIntelligenceTableId:
    process.env.APPWRITE_PRODUCT_INTELLIGENCE_COLLECTION_ID?.trim() || "product_intelligence",
  storyboardsTableId: process.env.APPWRITE_STORYBOARDS_COLLECTION_ID?.trim() || "storyboards",
  demoScenesTableId: process.env.APPWRITE_DEMO_SCENES_COLLECTION_ID?.trim() || "demo_scenes",
  qualityReviewsTableId:
    process.env.APPWRITE_QUALITY_REVIEWS_COLLECTION_ID?.trim() || "quality_reviews",
  directorArtifactsTableId:
    process.env.APPWRITE_DIRECTOR_ARTIFACTS_COLLECTION_ID?.trim() || "director_artifacts",
  recordingsBucketId: process.env.APPWRITE_RECORDINGS_BUCKET_ID?.trim() || "demo-recordings",
  evidenceBucketId: process.env.APPWRITE_EVIDENCE_BUCKET_ID?.trim() || "demo-evidence",
};

const client = new Client()
  .setEndpoint(config.endpoint)
  .setProject(config.projectId)
  .setKey(config.setupKey);
const tables = withTransportRetries(new TablesDB(client));
const storage = withTransportRetries(new Storage(client));

const schemas = [
  {
    id: config.projectsTableId,
    name: "projects",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("name", 80, true),
      varchar("base_url", 300, true),
      varchar("description", 800),
      mediumtext("site_map_md"),
      varchar("site_map_source", 16),
      datetime("site_map_updated_at"),
    ],
    indexes: [keyIndex("workspace_id_idx", ["workspace_id"])],
  },
  {
    id: config.credentialsTableId,
    name: "project_credentials",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      varchar("kind", 16, true),
      varchar("login_url", 300),
      varchar("username_hint", 160),
      mediumtext("ciphertext", false, true),
    ],
    indexes: [
      keyIndex("workspace_id_idx", ["workspace_id"]),
      uniqueIndex("project_id_unique", ["project_id"]),
    ],
  },
  {
    id: config.demosTableId,
    name: "demos",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      varchar("title", 100, true),
      text("feature_prompt", true),
      mediumtext("scene_script"),
      varchar("recording_locale", 16),
      mediumtext("source_viewport_json"),
      varchar("product_intelligence_id", 36),
      varchar("feature_candidate_id", 96),
      varchar("storyboard_id", 36),
      varchar("status", 16, true),
      integer("progress_pct", true, 0, 100),
      varchar("current_step", 500),
      varchar("mp4_url", 2048),
      varchar("thumbnail_url", 2048),
      integer("duration_seconds", false, 0, 86_400),
      varchar("share_slug", 64),
      booleanColumn("is_public", true),
      varchar("steel_session_id", 128),
      varchar("live_view_url", 2048),
      varchar("session_viewer_url", 2048),
      varchar("recording_url", 2048),
      varchar("recording_file_id", 36),
      datetime("recording_completed_at"),
      varchar("error_code", 128),
      text("error_message"),
      integer("execution_attempts", true, 0, 1_000),
      datetime("execution_started_at"),
      integer("finalization_attempts", true, 0, 1_000),
      datetime("finalization_started_at"),
    ],
    indexes: [
      keyIndex("workspace_id_idx", ["workspace_id"]),
      keyIndex("workspace_project_idx", ["workspace_id", "project_id"]),
      keyIndex("workspace_status_idx", ["workspace_id", "status"]),
      uniqueIndex("share_slug_unique", ["share_slug"]),
    ],
  },
  {
    id: config.eventsTableId,
    name: "demo_events",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("demo_id", 36, true),
      varchar("level", 16, true),
      varchar("step", 128, true),
      text("message"),
    ],
    indexes: [
      keyIndex("workspace_id_idx", ["workspace_id"]),
      keyIndex("workspace_demo_idx", ["workspace_id", "demo_id"]),
    ],
  },
  {
    id: config.compositionsTableId,
    name: "compositions",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      varchar("demo_id", 36, true),
      mediumtext("composition_json", true),
      integer("composition_version", true, 1, 10_000),
      varchar("template_id", 64, true),
      varchar("raw_recording_file_id", 36, true),
    ],
    indexes: [
      keyIndex("workspace_id_idx", ["workspace_id"]),
      keyIndex("workspace_demo_idx", ["workspace_id", "demo_id"]),
      keyIndex("workspace_project_idx", ["workspace_id", "project_id"]),
    ],
  },
  {
    id: config.compositionExportsTableId,
    name: "composition_exports",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      varchar("demo_id", 36, true),
      varchar("composition_id", 36, true),
      varchar("raw_recording_file_id", 36, true),
      varchar("final_recording_file_id", 36),
      varchar("render_status", 16, true),
      varchar("render_job_id", 36, true),
      text("render_error"),
      integer("render_attempts", true, 0, 10_000),
      integer("output_width", true, 320, 4096),
      integer("output_height", true, 320, 4096),
      integer("output_fps", true, 15, 60),
      floatColumn("output_duration", false, 0, 86_400),
    ],
    indexes: [
      keyIndex("workspace_id_idx", ["workspace_id"]),
      keyIndex("workspace_composition_idx", ["workspace_id", "composition_id"]),
      keyIndex("workspace_demo_idx", ["workspace_id", "demo_id"]),
      keyIndex("workspace_status_idx", ["workspace_id", "render_status"]),
    ],
  },
  {
    id: config.productIntelligenceTableId,
    name: "product_intelligence",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      integer("version", true, 1, 10_000),
      mediumtext("intelligence_json", true),
      floatColumn("global_confidence", true, 0, 1),
    ],
    indexes: [keyIndex("workspace_project_idx", ["workspace_id", "project_id"])],
  },
  {
    id: config.storyboardsTableId,
    name: "storyboards",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      varchar("demo_id", 36, true),
      varchar("feature_candidate_id", 96, true),
      integer("version", true, 1, 10_000),
      mediumtext("storyboard_json", true),
    ],
    indexes: [keyIndex("workspace_demo_idx", ["workspace_id", "demo_id"])],
  },
  {
    id: config.demoScenesTableId,
    name: "demo_scenes",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      varchar("demo_id", 36, true),
      varchar("storyboard_id", 36, true),
      varchar("scene_key", 96, true),
      integer("sequence", true, 0, 100),
      mediumtext("capture_json", true),
    ],
    indexes: [
      keyIndex("workspace_demo_idx", ["workspace_id", "demo_id"]),
      uniqueIndex("demo_scene_unique", ["demo_id", "scene_key"]),
    ],
  },
  {
    id: config.qualityReviewsTableId,
    name: "quality_reviews",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      varchar("demo_id", 36, true),
      varchar("composition_export_id", 36),
      mediumtext("review_json", true),
      floatColumn("score", true, 0, 100),
      varchar("status", 32, true),
      integer("revision", true, 1, 10_000),
    ],
    indexes: [keyIndex("workspace_demo_idx", ["workspace_id", "demo_id"])],
  },
  {
    id: config.directorArtifactsTableId,
    name: "director_artifacts",
    columns: [
      varchar("workspace_id", 64, true),
      varchar("project_id", 36, true),
      varchar("demo_id", 36),
      varchar("artifact_kind", 64, true),
      varchar("cache_key", 128, true),
      varchar("status", 32, true),
      mediumtext("payload_json", true),
      varchar("expires_at", 40),
      varchar("provider", 32),
      varchar("model", 160),
      integer("duration_ms", false, 0, 3_600_000),
      integer("revision", true, 0, 100),
      mediumtext("failure_reason"),
    ],
    indexes: [
      keyIndex("workspace_project_kind_idx", ["workspace_id", "project_id", "artifact_kind"]),
      keyIndex("workspace_cache_idx", ["workspace_id", "cache_key"]),
    ],
  },
];

function varchar(key, size, required = false, encrypt = false) {
  return { kind: "varchar", key, size, required, encrypt };
}

function text(key, required = false, encrypt = false) {
  return { kind: "text", key, required, encrypt };
}

function mediumtext(key, required = false, encrypt = false) {
  return { kind: "mediumtext", key, required, encrypt };
}

function integer(key, required = false, min, max) {
  return { kind: "integer", key, required, min, max };
}

function floatColumn(key, required = false, min, max) {
  return { kind: "float", key, required, min, max };
}

function booleanColumn(key, required = false) {
  return { kind: "boolean", key, required };
}

function datetime(key, required = false) {
  return { kind: "datetime", key, required };
}

function keyIndex(key, columns) {
  return { key, type: TablesDBIndexType.Key, columns };
}

function uniqueIndex(key, columns) {
  return { key, type: TablesDBIndexType.Unique, columns };
}

function isNotFound(error) {
  return error && typeof error === "object" && error.code === 404;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableTransportError(error) {
  const causeCode = error?.cause?.code;
  return (
    [
      "UND_ERR_CONNECT_TIMEOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
    ].includes(causeCode) ||
    /fetch failed|connect timeout|socket hang up/i.test(String(error?.message || ""))
  );
}

async function retryTransport(operation) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableTransportError(error) || attempt >= 5) throw error;
      await delay(500 * 2 ** (attempt - 1));
    }
  }
}

function withTransportRetries(service) {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args) => retryTransport(() => value.apply(target, args));
    },
  });
}

async function ensureDatabase() {
  try {
    await tables.get({ databaseId: config.databaseId });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await tables.create({
      databaseId: config.databaseId,
      name: "WiseDemo",
      enabled: true,
    });
  }
}

async function ensureTable(schema) {
  try {
    await tables.getTable({ databaseId: config.databaseId, tableId: schema.id });
    await tables.updateTable({
      databaseId: config.databaseId,
      tableId: schema.id,
      name: schema.name,
      permissions: [],
      rowSecurity: false,
      enabled: true,
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await tables.createTable({
      databaseId: config.databaseId,
      tableId: schema.id,
      name: schema.name,
      permissions: [],
      rowSecurity: false,
      enabled: true,
    });
  }
}

async function ensureColumn(tableId, definition) {
  let existing;
  try {
    existing = await tables.getColumn({
      databaseId: config.databaseId,
      tableId,
      key: definition.key,
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  if (!existing) {
    const common = {
      databaseId: config.databaseId,
      tableId,
      key: definition.key,
      required: definition.required,
    };
    if (definition.kind === "varchar") {
      await tables.createVarcharColumn({
        ...common,
        size: definition.size,
        encrypt: definition.encrypt,
      });
    } else if (definition.kind === "text") {
      await tables.createTextColumn({ ...common, encrypt: definition.encrypt });
    } else if (definition.kind === "mediumtext") {
      await tables.createMediumtextColumn({ ...common, encrypt: definition.encrypt });
    } else if (definition.kind === "integer") {
      await tables.createIntegerColumn({
        ...common,
        min: definition.min,
        max: definition.max,
      });
    } else if (definition.kind === "float") {
      await tables.createFloatColumn({
        ...common,
        min: definition.min,
        max: definition.max,
      });
    } else if (definition.kind === "boolean") {
      await tables.createBooleanColumn(common);
    } else if (definition.kind === "datetime") {
      await tables.createDatetimeColumn(common);
    } else {
      throw new Error(`Unsupported column kind ${definition.kind}.`);
    }
  }

  const ready = await waitForColumn(tableId, definition.key);
  const expectedType = definition.kind === "float" ? "double" : definition.kind;
  if (ready.type !== expectedType || ready.required !== definition.required) {
    throw new Error(
      `Appwrite column ${tableId}.${definition.key} does not match the WiseDemo schema.`,
    );
  }
  if (definition.kind === "varchar" && ready.size !== definition.size) {
    throw new Error(`Appwrite column ${tableId}.${definition.key} has the wrong size.`);
  }
  if (definition.encrypt && ready.encrypt !== true) {
    throw new Error(`Appwrite column ${tableId}.${definition.key} must enable encryption.`);
  }
}

async function waitForColumn(tableId, key) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const column = await tables.getColumn({
      databaseId: config.databaseId,
      tableId,
      key,
    });
    if (column.status === "available") return column;
    if (column.status === "failed" || column.status === "stuck") {
      throw new Error(`Appwrite could not create column ${tableId}.${key}: ${column.error}`);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for Appwrite column ${tableId}.${key}.`);
}

async function ensureIndex(tableId, definition) {
  let existing;
  try {
    existing = await tables.getIndex({
      databaseId: config.databaseId,
      tableId,
      key: definition.key,
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (!existing) {
    await tables.createIndex({
      databaseId: config.databaseId,
      tableId,
      ...definition,
    });
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const index = await tables.getIndex({
      databaseId: config.databaseId,
      tableId,
      key: definition.key,
    });
    if (index.status === "available") {
      if (
        index.type !== definition.type ||
        JSON.stringify(index.columns) !== JSON.stringify(definition.columns)
      ) {
        throw new Error(`Appwrite index ${tableId}.${definition.key} has the wrong definition.`);
      }
      return;
    }
    if (index.status === "failed" || index.status === "stuck") {
      throw new Error(
        `Appwrite could not create index ${tableId}.${definition.key}: ${index.error}`,
      );
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for Appwrite index ${tableId}.${definition.key}.`);
}

async function ensureBucket() {
  const settings = {
    name: "demo-recordings",
    permissions: [],
    fileSecurity: false,
    enabled: true,
    maximumFileSize: 500 * 1024 * 1024,
    allowedFileExtensions: ["mp4"],
    compression: Compression.None,
    encryption: false,
    antivirus: false,
    transformations: false,
  };
  try {
    await storage.getBucket({ bucketId: config.recordingsBucketId });
    await storage.updateBucket({ bucketId: config.recordingsBucketId, ...settings });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await storage.createBucket({ bucketId: config.recordingsBucketId, ...settings });
  }
}

async function ensureEvidenceBucket() {
  const settings = {
    name: "demo-evidence",
    permissions: [],
    fileSecurity: false,
    enabled: true,
    maximumFileSize: 20 * 1024 * 1024,
    allowedFileExtensions: ["jpg", "jpeg", "png", "webp"],
    compression: Compression.None,
    encryption: false,
    antivirus: false,
    transformations: false,
  };
  try {
    await storage.getBucket({ bucketId: config.evidenceBucketId });
    await storage.updateBucket({ bucketId: config.evidenceBucketId, ...settings });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await storage.createBucket({ bucketId: config.evidenceBucketId, ...settings });
  }
}

await ensureDatabase();
for (const schema of schemas) {
  await ensureTable(schema);
  for (const column of schema.columns) await ensureColumn(schema.id, column);
  for (const index of schema.indexes) await ensureIndex(schema.id, index);
}
await ensureBucket();
await ensureEvidenceBucket();

console.info("WiseDemo Appwrite resources are ready. Revoke the temporary setup API key now.");
