import { Query, type Models, type TablesDB } from "node-appwrite";

import { parseComposition } from "../../composition/model.ts";
import type { SourceViewportMetadata } from "../../composition/source-viewport.ts";

import {
  appwriteRetryDelayMs,
  appwriteServer,
  isRetryableAppwriteTransportError,
  MAX_APPWRITE_TRANSPORT_ATTEMPTS,
} from "./client.server.ts";
import type { AppwriteConfig } from "./config.server.ts";
import type {
  CompositionCreate,
  CompositionExportCreate,
  CompositionExportRecord,
  CompositionExportUpdate,
  CompositionRecord,
  CompositionRenderStatus,
  CompositionUpdate,
  DirectorArtifactCreate,
  DirectorArtifactKind,
  DirectorArtifactRecord,
  DemoCreate,
  DemoEventRecord,
  DemoRecord,
  DemoStatus,
  DemoUpdate,
  DemoSceneRecord,
  Json,
  ProjectCreate,
  ProjectCredentialRecord,
  ProjectRecord,
  ProjectUpdate,
  ProductIntelligenceRecord,
  QualityReviewRecord,
  StoryboardRecord,
} from "./types.ts";
import {
  parseDemoSceneCapture,
  parseDemoStoryboard,
  parseProductIntelligence,
  parseVideoQualityReview,
  type DemoSceneCapture,
  type DemoStoryboard,
  type ProductIntelligence,
  type VideoQualityReview,
} from "../../lib/product-intelligence.ts";

export const SHARED_WORKSPACE_ID = "shared-public-workspace";

type AppwriteFailure = {
  code?: number;
  type?: string;
  message?: string;
};

type ProjectRow = Models.Row & {
  workspace_id: string;
  name: string;
  base_url: string;
  description?: string | null;
  site_map_md?: string | null;
  site_map_source?: string | null;
  site_map_updated_at?: string | null;
};

type CredentialRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  kind: "none" | "password";
  login_url?: string | null;
  username_hint?: string | null;
  ciphertext?: string | null;
};

type DemoRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  title: string;
  feature_prompt: string;
  scene_script?: string | null;
  recording_locale?: "english" | "arabic" | "auto" | null;
  source_viewport_json?: string | null;
  product_intelligence_id?: string | null;
  feature_candidate_id?: string | null;
  storyboard_id?: string | null;
  status: DemoStatus;
  progress_pct: number;
  current_step?: string | null;
  mp4_url?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  share_slug?: string | null;
  is_public: boolean;
  steel_session_id?: string | null;
  live_view_url?: string | null;
  session_viewer_url?: string | null;
  recording_url?: string | null;
  recording_file_id?: string | null;
  recording_completed_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  execution_attempts: number;
  execution_started_at?: string | null;
  finalization_attempts: number;
  finalization_started_at?: string | null;
};

type EventRow = Models.Row & {
  workspace_id: string;
  demo_id: string;
  level: "info" | "warn" | "error";
  step: string;
  message?: string | null;
};

type CompositionRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  demo_id: string;
  composition_json: string;
  composition_version: number;
  template_id: string;
  raw_recording_file_id: string;
};

type CompositionExportRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  demo_id: string;
  composition_id: string;
  raw_recording_file_id: string;
  final_recording_file_id?: string | null;
  render_status: CompositionRenderStatus;
  render_job_id: string;
  render_error?: string | null;
  render_attempts: number;
  output_width: number;
  output_height: number;
  output_fps: number;
  output_duration?: number | null;
};

type ProductIntelligenceRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  version: number;
  intelligence_json: string;
  global_confidence: number;
};
type StoryboardRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  demo_id: string;
  feature_candidate_id: string;
  version: number;
  storyboard_json: string;
};
type DemoSceneRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  demo_id: string;
  storyboard_id: string;
  scene_key: string;
  sequence: number;
  capture_json: string;
};
type QualityReviewRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  demo_id: string;
  composition_export_id?: string | null;
  review_json: string;
  score: number;
  status: "pass" | "pass-with-warnings" | "fail";
  revision: number;
};
type DirectorArtifactRow = Models.Row & {
  workspace_id: string;
  project_id: string;
  demo_id?: string | null;
  artifact_kind: DirectorArtifactKind;
  cache_key: string;
  status: "ready" | "unavailable" | "failed";
  payload_json: string;
  expires_at?: string | null;
  provider?: string | null;
  model?: string | null;
  duration_ms?: number | null;
  revision: number;
  failure_reason?: string | null;
};

export type WiseDemoRepositoryServices = {
  tables: TablesDB;
  config: Pick<
    AppwriteConfig,
    | "databaseId"
    | "projectsTableId"
    | "credentialsTableId"
    | "demosTableId"
    | "demoEventsTableId"
    | "compositionsTableId"
    | "compositionExportsTableId"
    | "productIntelligenceTableId"
    | "storyboardsTableId"
    | "demoScenesTableId"
    | "qualityReviewsTableId"
    | "directorArtifactsTableId"
  >;
};

function isAppwriteCode(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && (error as AppwriteFailure).code === code;
}

function safeAppwriteError(error: unknown): Error {
  const failure = (typeof error === "object" && error !== null ? error : {}) as AppwriteFailure;
  const code = typeof failure.code === "number" ? ` (${failure.code})` : "";
  const type = failure.type ? ` ${failure.type}` : "";
  return new Error(`Appwrite request failed${code}${type}.`);
}

function parseJson(value: string | null | undefined): Json | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Json;
  } catch {
    throw new Error("Stored demo scene data is invalid JSON.");
  }
}

function projectFromRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.$id,
    name: row.name,
    base_url: row.base_url,
    description: row.description ?? null,
    site_map_md: row.site_map_md ?? null,
    site_map_source: row.site_map_source ?? null,
    site_map_updated_at: row.site_map_updated_at ?? null,
    created_at: row.$createdAt,
    updated_at: row.$updatedAt,
  };
}

function credentialFromRow(row: CredentialRow): ProjectCredentialRecord {
  return {
    project_id: row.project_id,
    kind: row.kind,
    login_url: row.login_url ?? null,
    username_hint: row.username_hint ?? null,
    ciphertext: row.ciphertext ?? null,
    created_at: row.$createdAt,
    updated_at: row.$updatedAt,
  };
}

function demoFromRow(row: DemoRow): DemoRecord {
  let sourceViewport: SourceViewportMetadata | null = null;
  if (row.source_viewport_json) {
    try {
      sourceViewport = JSON.parse(row.source_viewport_json) as SourceViewportMetadata;
    } catch {
      sourceViewport = null;
    }
  }
  return {
    id: row.$id,
    project_id: row.project_id,
    title: row.title,
    feature_prompt: row.feature_prompt,
    scene_script: parseJson(row.scene_script),
    recording_locale: row.recording_locale ?? "english",
    source_viewport: sourceViewport,
    product_intelligence_id: row.product_intelligence_id ?? null,
    feature_candidate_id: row.feature_candidate_id ?? null,
    storyboard_id: row.storyboard_id ?? null,
    status: row.status,
    progress_pct: row.progress_pct,
    current_step: row.current_step ?? null,
    mp4_url: row.mp4_url ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    duration_seconds: row.duration_seconds ?? null,
    share_slug: row.share_slug ?? null,
    is_public: row.is_public,
    steel_session_id: row.steel_session_id ?? null,
    live_view_url: row.live_view_url ?? null,
    session_viewer_url: row.session_viewer_url ?? null,
    recording_url: row.recording_url ?? null,
    recording_file_id: row.recording_file_id ?? null,
    recording_completed_at: row.recording_completed_at ?? null,
    error_code: row.error_code ?? null,
    error_message: row.error_message ?? null,
    execution_attempts: row.execution_attempts,
    execution_started_at: row.execution_started_at ?? null,
    finalization_attempts: row.finalization_attempts,
    finalization_started_at: row.finalization_started_at ?? null,
    created_at: row.$createdAt,
    updated_at: row.$updatedAt,
  };
}

function intelligenceFromRow(row: ProductIntelligenceRow): ProductIntelligenceRecord {
  return {
    id: row.$id,
    project_id: row.project_id,
    version: row.version,
    intelligence_json: parseProductIntelligence(JSON.parse(row.intelligence_json)),
    global_confidence: row.global_confidence,
    created_at: row.$createdAt,
  };
}

function storyboardFromRow(row: StoryboardRow): StoryboardRecord {
  return {
    id: row.$id,
    project_id: row.project_id,
    demo_id: row.demo_id,
    feature_candidate_id: row.feature_candidate_id,
    version: row.version,
    storyboard_json: parseDemoStoryboard(JSON.parse(row.storyboard_json)),
    created_at: row.$createdAt,
    updated_at: row.$updatedAt,
  };
}

function demoSceneFromRow(row: DemoSceneRow): DemoSceneRecord {
  return {
    id: row.$id,
    project_id: row.project_id,
    demo_id: row.demo_id,
    storyboard_id: row.storyboard_id,
    scene_key: row.scene_key,
    sequence: row.sequence,
    capture_json: parseDemoSceneCapture(JSON.parse(row.capture_json)),
    created_at: row.$createdAt,
    updated_at: row.$updatedAt,
  };
}

function qualityReviewFromRow(row: QualityReviewRow): QualityReviewRecord {
  return {
    id: row.$id,
    project_id: row.project_id,
    demo_id: row.demo_id,
    composition_export_id: row.composition_export_id ?? null,
    review_json: parseVideoQualityReview(JSON.parse(row.review_json)),
    score: row.score,
    status: row.status,
    revision: row.revision,
    created_at: row.$createdAt,
  };
}

function directorArtifactFromRow(row: DirectorArtifactRow): DirectorArtifactRecord {
  const payload = parseJson(row.payload_json);
  if (payload === null) throw new Error("Stored director artifact is missing JSON data.");
  return {
    id: row.$id,
    project_id: row.project_id,
    demo_id: row.demo_id ?? null,
    artifact_kind: row.artifact_kind,
    cache_key: row.cache_key,
    status: row.status,
    payload_json: payload,
    expires_at: row.expires_at ?? null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    duration_ms: row.duration_ms ?? null,
    revision: row.revision,
    failure_reason: row.failure_reason ?? null,
    created_at: row.$createdAt,
    updated_at: row.$updatedAt,
  };
}

function eventFromRow(row: EventRow): DemoEventRecord {
  return {
    id: row.$id,
    demo_id: row.demo_id,
    level: row.level,
    step: row.step,
    message: row.message ?? null,
    created_at: row.$createdAt,
  };
}

function compositionFromRow(row: CompositionRow): CompositionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.composition_json);
  } catch {
    throw new Error("Stored composition data is invalid JSON.");
  }
  return {
    id: row.$id,
    project_id: row.project_id,
    demo_id: row.demo_id,
    composition_json: parseComposition(parsed),
    composition_version: row.composition_version,
    template_id: row.template_id,
    raw_recording_file_id: row.raw_recording_file_id,
    created_at: row.$createdAt,
    updated_at: row.$updatedAt,
  };
}

function compositionExportFromRow(row: CompositionExportRow): CompositionExportRecord {
  return {
    id: row.$id,
    project_id: row.project_id,
    demo_id: row.demo_id,
    composition_id: row.composition_id,
    raw_recording_file_id: row.raw_recording_file_id,
    final_recording_file_id: row.final_recording_file_id ?? null,
    render_status: row.render_status,
    render_job_id: row.render_job_id,
    render_error: row.render_error ?? null,
    render_attempts: row.render_attempts,
    output_width: row.output_width,
    output_height: row.output_height,
    output_fps: row.output_fps,
    output_duration: row.output_duration ?? null,
    created_at: row.$createdAt,
    updated_at: row.$updatedAt,
  };
}

function demoUpdateData(update: DemoUpdate): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (key === "scene_script") data.scene_script = value === null ? null : JSON.stringify(value);
    else if (key === "source_viewport") {
      data.source_viewport_json = value === null ? null : JSON.stringify(value);
    } else data[key] = value;
  }
  return data;
}

function compositionUpdateData(update: CompositionUpdate): Record<string, unknown> {
  const data: Record<string, unknown> = { ...update };
  if (update.composition_json) data.composition_json = JSON.stringify(update.composition_json);
  return data;
}

export class WiseDemoRepository {
  readonly #tables: TablesDB;
  readonly #config: WiseDemoRepositoryServices["config"];
  readonly #workspaceId: string;

  constructor(services: WiseDemoRepositoryServices, workspaceId = SHARED_WORKSPACE_ID) {
    this.#tables = services.tables;
    this.#config = services.config;
    this.#workspaceId = workspaceId;
  }

  async createProject(input: ProjectCreate): Promise<ProjectRecord> {
    const rowId = crypto.randomUUID();
    try {
      const row = await this.#createRowIdempotently<ProjectRow>(
        this.#config.projectsTableId,
        rowId,
        { workspace_id: this.#workspaceId, ...input },
      );
      return projectFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async listProjects(): Promise<ProjectRecord[]> {
    try {
      const result = await this.#tables.listRows<ProjectRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.projectsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.orderDesc("$createdAt"),
          Query.limit(100),
        ],
        ttl: 0,
      });
      return result.rows.map(projectFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    const row = await this.#getWorkspaceRow<ProjectRow>(this.#config.projectsTableId, projectId);
    return row ? projectFromRow(row) : null;
  }

  async updateProject(projectId: string, update: ProjectUpdate): Promise<ProjectRecord> {
    await this.#requireWorkspaceRow<ProjectRow>(this.#config.projectsTableId, projectId);
    try {
      const row = await this.#tables.updateRow<ProjectRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.projectsTableId,
        rowId: projectId,
        data: update,
      });
      return projectFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async getCredential(projectId: string): Promise<ProjectCredentialRecord | null> {
    const row = await this.#getWorkspaceRow<CredentialRow>(
      this.#config.credentialsTableId,
      projectId,
    );
    return row ? credentialFromRow(row) : null;
  }

  async createProductIntelligence(input: {
    project_id: string;
    intelligence: ProductIntelligence;
    version: number;
  }): Promise<ProductIntelligenceRecord> {
    const row = await this.#createRowIdempotently<ProductIntelligenceRow>(
      this.#config.productIntelligenceTableId,
      crypto.randomUUID(),
      {
        workspace_id: this.#workspaceId,
        project_id: input.project_id,
        version: input.version,
        intelligence_json: JSON.stringify(input.intelligence),
        global_confidence: input.intelligence.globalConfidence,
      },
    );
    return intelligenceFromRow(row);
  }

  async getLatestProductIntelligence(projectId: string): Promise<ProductIntelligenceRecord | null> {
    try {
      const result = await this.#tables.listRows<ProductIntelligenceRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.productIntelligenceTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("project_id", projectId),
          Query.orderDesc("$createdAt"),
          Query.limit(1),
        ],
        ttl: 0,
      });
      return result.rows[0] ? intelligenceFromRow(result.rows[0]) : null;
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async createStoryboard(input: {
    project_id: string;
    demo_id: string;
    feature_candidate_id: string;
    storyboard: DemoStoryboard;
  }): Promise<StoryboardRecord> {
    const row = await this.#createRowIdempotently<StoryboardRow>(
      this.#config.storyboardsTableId,
      crypto.randomUUID(),
      {
        workspace_id: this.#workspaceId,
        project_id: input.project_id,
        demo_id: input.demo_id,
        feature_candidate_id: input.feature_candidate_id,
        version: input.storyboard.revision,
        storyboard_json: JSON.stringify(input.storyboard),
      },
    );
    return storyboardFromRow(row);
  }

  async getStoryboard(storyboardId: string): Promise<StoryboardRecord | null> {
    const row = await this.#getWorkspaceRow<StoryboardRow>(
      this.#config.storyboardsTableId,
      storyboardId,
    );
    return row ? storyboardFromRow(row) : null;
  }

  async listStoryboards(demoId: string): Promise<StoryboardRecord[]> {
    try {
      const result = await this.#tables.listRows<StoryboardRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.storyboardsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("demo_id", demoId),
          Query.orderDesc("$createdAt"),
          Query.limit(20),
        ],
        ttl: 0,
      });
      return result.rows.map(storyboardFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async upsertDemoScene(input: {
    project_id: string;
    demo_id: string;
    storyboard_id: string;
    scene_key: string;
    sequence: number;
    capture: DemoSceneCapture;
  }): Promise<DemoSceneRecord> {
    const row = await this.#tables.upsertRow<DemoSceneRow>({
      databaseId: this.#config.databaseId,
      tableId: this.#config.demoScenesTableId,
      rowId: input.scene_key,
      data: {
        workspace_id: this.#workspaceId,
        project_id: input.project_id,
        demo_id: input.demo_id,
        storyboard_id: input.storyboard_id,
        scene_key: input.scene_key,
        sequence: input.sequence,
        capture_json: JSON.stringify(input.capture),
      },
      permissions: [],
    });
    return demoSceneFromRow(row);
  }

  async listDemoScenes(demoId: string): Promise<DemoSceneRecord[]> {
    try {
      const result = await this.#tables.listRows<DemoSceneRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.demoScenesTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("demo_id", demoId),
          Query.orderAsc("sequence"),
          Query.limit(100),
        ],
        ttl: 0,
      });
      return result.rows.map(demoSceneFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async createQualityReview(input: {
    project_id: string;
    demo_id: string;
    composition_export_id?: string | null;
    review: VideoQualityReview;
    revision: number;
  }): Promise<QualityReviewRecord> {
    const row = await this.#createRowIdempotently<QualityReviewRow>(
      this.#config.qualityReviewsTableId,
      crypto.randomUUID(),
      {
        workspace_id: this.#workspaceId,
        project_id: input.project_id,
        demo_id: input.demo_id,
        composition_export_id: input.composition_export_id ?? null,
        review_json: JSON.stringify(input.review),
        score: input.review.score,
        status: input.review.status,
        revision: input.revision,
      },
    );
    return qualityReviewFromRow(row);
  }

  async listQualityReviews(demoId: string): Promise<QualityReviewRecord[]> {
    try {
      const result = await this.#tables.listRows<QualityReviewRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.qualityReviewsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("demo_id", demoId),
          Query.orderDesc("$createdAt"),
          Query.limit(20),
        ],
        ttl: 0,
      });
      return result.rows.map(qualityReviewFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async createDirectorArtifact(input: DirectorArtifactCreate): Promise<DirectorArtifactRecord> {
    const row = await this.#createRowIdempotently<DirectorArtifactRow>(
      this.#config.directorArtifactsTableId,
      crypto.randomUUID(),
      {
        workspace_id: this.#workspaceId,
        ...input,
        payload_json: JSON.stringify(input.payload_json),
      },
    );
    return directorArtifactFromRow(row);
  }

  async getCachedDirectorArtifact(input: {
    projectId: string;
    artifactKind: DirectorArtifactKind;
    cacheKey: string;
    now?: Date;
  }): Promise<DirectorArtifactRecord | null> {
    try {
      const result = await this.#tables.listRows<DirectorArtifactRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.directorArtifactsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("project_id", input.projectId),
          Query.equal("artifact_kind", input.artifactKind),
          Query.equal("cache_key", input.cacheKey),
          Query.orderDesc("$createdAt"),
          Query.limit(10),
        ],
        ttl: 0,
      });
      const now = (input.now ?? new Date()).getTime();
      const fresh = result.rows
        .map(directorArtifactFromRow)
        .find(
          (artifact) =>
            artifact.status === "ready" &&
            artifact.expires_at &&
            Date.parse(artifact.expires_at) > now,
        );
      return fresh ?? null;
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async listDirectorArtifacts(projectId: string): Promise<DirectorArtifactRecord[]> {
    try {
      const result = await this.#tables.listRows<DirectorArtifactRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.directorArtifactsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("project_id", projectId),
          Query.orderDesc("$createdAt"),
          Query.limit(100),
        ],
        ttl: 0,
      });
      return result.rows.map(directorArtifactFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async listDirectorArtifactsByKind(
    projectId: string,
    artifactKind: DirectorArtifactKind,
  ): Promise<DirectorArtifactRecord[]> {
    try {
      const result = await this.#tables.listRows<DirectorArtifactRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.directorArtifactsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("project_id", projectId),
          Query.equal("artifact_kind", artifactKind),
          Query.orderDesc("$createdAt"),
          Query.limit(100),
        ],
        ttl: 0,
      });
      return result.rows.map(directorArtifactFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async getLatestDirectorArtifactForDemo(input: {
    projectId: string;
    demoId: string;
    artifactKind: DirectorArtifactKind;
  }): Promise<DirectorArtifactRecord | null> {
    try {
      const result = await this.#tables.listRows<DirectorArtifactRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.directorArtifactsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("project_id", input.projectId),
          Query.equal("demo_id", input.demoId),
          Query.equal("artifact_kind", input.artifactKind),
          Query.orderDesc("$createdAt"),
          Query.limit(10),
        ],
        ttl: 0,
      });
      return (
        result.rows.map(directorArtifactFromRow).find((artifact) => artifact.status === "ready") ??
        null
      );
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async upsertCredential(input: {
    project_id: string;
    kind: "password";
    login_url: string;
    username_hint: string;
    ciphertext: string;
  }): Promise<ProjectCredentialRecord> {
    try {
      const row = await this.#tables.upsertRow<CredentialRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.credentialsTableId,
        rowId: input.project_id,
        data: { workspace_id: this.#workspaceId, ...input },
        permissions: [],
      });
      return credentialFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async deleteCredential(projectId: string): Promise<void> {
    const existing = await this.#getWorkspaceRow<CredentialRow>(
      this.#config.credentialsTableId,
      projectId,
    );
    if (!existing) return;
    try {
      await this.#tables.deleteRow({
        databaseId: this.#config.databaseId,
        tableId: this.#config.credentialsTableId,
        rowId: projectId,
      });
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async createDemo(input: DemoCreate): Promise<DemoRecord> {
    const rowId = crypto.randomUUID();
    try {
      const row = await this.#createRowIdempotently<DemoRow>(this.#config.demosTableId, rowId, {
        workspace_id: this.#workspaceId,
        status: "pending",
        progress_pct: 0,
        is_public: true,
        recording_locale: "english",
        execution_attempts: 0,
        finalization_attempts: 0,
        ...input,
      });
      return demoFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async listDemos(projectId?: string): Promise<DemoRecord[]> {
    const queries = [
      Query.equal("workspace_id", this.#workspaceId),
      Query.orderDesc("$createdAt"),
      Query.limit(100),
    ];
    if (projectId) queries.unshift(Query.equal("project_id", projectId));
    try {
      const result = await this.#tables.listRows<DemoRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.demosTableId,
        queries,
        ttl: 0,
      });
      return result.rows.map(demoFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async getDemo(demoId: string): Promise<DemoRecord | null> {
    const row = await this.#getWorkspaceRow<DemoRow>(this.#config.demosTableId, demoId);
    return row ? demoFromRow(row) : null;
  }

  async updateDemo(demoId: string, update: DemoUpdate): Promise<DemoRecord> {
    await this.#requireWorkspaceRow<DemoRow>(this.#config.demosTableId, demoId);
    try {
      const row = await this.#tables.updateRow<DemoRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.demosTableId,
        rowId: demoId,
        data: demoUpdateData(update),
      });
      return demoFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async claimDemoExecution(demoId: string, now = new Date()): Promise<DemoRecord | null> {
    const staleBefore = new Date(now.getTime() - 8 * 60_000);
    return this.#transactionalDemoClaim(
      demoId,
      (demo) =>
        ["pending", "starting", "scanning", "planning", "recording"].includes(demo.status) &&
        (!demo.execution_started_at || new Date(demo.execution_started_at) < staleBefore),
      (demo) => ({
        status: "scanning",
        progress_pct: 20,
        current_step: "Agent scouting the product…",
        execution_started_at: now.toISOString(),
        execution_attempts: demo.execution_attempts + 1,
        error_code: null,
        error_message: null,
      }),
    );
  }

  async claimDemoFinalization(demoId: string, now = new Date()): Promise<DemoRecord | null> {
    const staleBefore = new Date(now.getTime() - 90_000);
    return this.#transactionalDemoClaim(
      demoId,
      (demo) =>
        demo.status === "rendering" &&
        (!demo.finalization_started_at || new Date(demo.finalization_started_at) < staleBefore),
      (demo) => ({
        finalization_started_at: now.toISOString(),
        finalization_attempts: demo.finalization_attempts + 1,
        current_step: "Checking Steel for a finalized recording…",
        error_code: null,
        error_message: null,
      }),
    );
  }

  async appendDemoEvent(input: {
    demo_id: string;
    level: "info" | "warn" | "error";
    step: string;
    message: string | null;
  }): Promise<DemoEventRecord> {
    const rowId = crypto.randomUUID();
    try {
      const row = await this.#createRowIdempotently<EventRow>(
        this.#config.demoEventsTableId,
        rowId,
        { workspace_id: this.#workspaceId, ...input },
      );
      return eventFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async listDemoEvents(demoId: string): Promise<DemoEventRecord[]> {
    try {
      const result = await this.#tables.listRows<EventRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.demoEventsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("demo_id", demoId),
          Query.orderAsc("$createdAt"),
          Query.limit(100),
        ],
        ttl: 0,
      });
      return result.rows.map(eventFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async createComposition(input: CompositionCreate): Promise<CompositionRecord> {
    const rowId = crypto.randomUUID();
    try {
      const row = await this.#createRowIdempotently<CompositionRow>(
        this.#config.compositionsTableId,
        rowId,
        {
          workspace_id: this.#workspaceId,
          ...input,
          composition_json: JSON.stringify(input.composition_json),
        },
      );
      return compositionFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async listCompositions(demoId: string): Promise<CompositionRecord[]> {
    try {
      const result = await this.#tables.listRows<CompositionRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.compositionsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("demo_id", demoId),
          Query.orderDesc("$updatedAt"),
          Query.limit(100),
        ],
        ttl: 0,
      });
      return result.rows.map(compositionFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async getComposition(compositionId: string): Promise<CompositionRecord | null> {
    const row = await this.#getWorkspaceRow<CompositionRow>(
      this.#config.compositionsTableId,
      compositionId,
    );
    return row ? compositionFromRow(row) : null;
  }

  async updateComposition(
    compositionId: string,
    update: CompositionUpdate,
  ): Promise<CompositionRecord> {
    await this.#requireWorkspaceRow<CompositionRow>(
      this.#config.compositionsTableId,
      compositionId,
    );
    try {
      const row = await this.#tables.updateRow<CompositionRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.compositionsTableId,
        rowId: compositionId,
        data: compositionUpdateData(update),
      });
      return compositionFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async createCompositionExport(input: CompositionExportCreate): Promise<CompositionExportRecord> {
    const rowId = crypto.randomUUID();
    try {
      const row = await this.#createRowIdempotently<CompositionExportRow>(
        this.#config.compositionExportsTableId,
        rowId,
        {
          workspace_id: this.#workspaceId,
          final_recording_file_id: null,
          render_error: null,
          render_attempts: 0,
          output_duration: null,
          ...input,
        },
      );
      return compositionExportFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async listCompositionExports(compositionId: string): Promise<CompositionExportRecord[]> {
    try {
      const result = await this.#tables.listRows<CompositionExportRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.compositionExportsTableId,
        queries: [
          Query.equal("workspace_id", this.#workspaceId),
          Query.equal("composition_id", compositionId),
          Query.orderDesc("$createdAt"),
          Query.limit(100),
        ],
        ttl: 0,
      });
      return result.rows.map(compositionExportFromRow);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async getCompositionExport(exportId: string): Promise<CompositionExportRecord | null> {
    const row = await this.#getWorkspaceRow<CompositionExportRow>(
      this.#config.compositionExportsTableId,
      exportId,
    );
    return row ? compositionExportFromRow(row) : null;
  }

  async updateCompositionExport(
    exportId: string,
    update: CompositionExportUpdate,
  ): Promise<CompositionExportRecord> {
    await this.#requireWorkspaceRow<CompositionExportRow>(
      this.#config.compositionExportsTableId,
      exportId,
    );
    try {
      const row = await this.#tables.updateRow<CompositionExportRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.compositionExportsTableId,
        rowId: exportId,
        data: update,
      });
      return compositionExportFromRow(row);
    } catch (error) {
      throw safeAppwriteError(error);
    }
  }

  async #transactionalDemoClaim(
    demoId: string,
    eligible: (demo: DemoRecord) => boolean,
    update: (demo: DemoRecord) => DemoUpdate,
  ): Promise<DemoRecord | null> {
    const transaction = await this.#tables.createTransaction({ ttl: 60 });
    let settled = false;
    try {
      const row = await this.#tables.getRow<DemoRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.demosTableId,
        rowId: demoId,
        transactionId: transaction.$id,
      });
      if (row.workspace_id !== this.#workspaceId) {
        await this.#tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
        settled = true;
        return null;
      }
      const demo = demoFromRow(row);
      if (!eligible(demo)) {
        await this.#tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
        settled = true;
        return null;
      }
      await this.#tables.updateRow<DemoRow>({
        databaseId: this.#config.databaseId,
        tableId: this.#config.demosTableId,
        rowId: demoId,
        data: demoUpdateData(update(demo)),
        transactionId: transaction.$id,
      });
      await this.#tables.updateTransaction({ transactionId: transaction.$id, commit: true });
      settled = true;
      return this.getDemo(demoId);
    } catch (error) {
      if (!settled) {
        await this.#tables
          .updateTransaction({ transactionId: transaction.$id, rollback: true })
          .catch(() => undefined);
      }
      if (isAppwriteCode(error, 404) || isAppwriteCode(error, 409)) return null;
      throw safeAppwriteError(error);
    }
  }

  async #createRowIdempotently<Row extends Models.Row>(
    tableId: string,
    rowId: string,
    data: Record<string, unknown>,
  ): Promise<Row> {
    for (let attempt = 1; attempt <= MAX_APPWRITE_TRANSPORT_ATTEMPTS; attempt += 1) {
      try {
        return await this.#tables.createRow<Row>({
          databaseId: this.#config.databaseId,
          tableId,
          rowId,
          data: data as never,
          permissions: [],
        });
      } catch (error) {
        if (isAppwriteCode(error, 409)) {
          return await this.#tables.getRow<Row>({
            databaseId: this.#config.databaseId,
            tableId,
            rowId,
          });
        }
        if (
          !isRetryableAppwriteTransportError(error) ||
          attempt >= MAX_APPWRITE_TRANSPORT_ATTEMPTS
        ) {
          throw error;
        }
        try {
          return await this.#tables.getRow<Row>({
            databaseId: this.#config.databaseId,
            tableId,
            rowId,
          });
        } catch (recoveryError) {
          if (!isAppwriteCode(recoveryError, 404)) throw recoveryError;
        }
        await new Promise((resolve) => setTimeout(resolve, appwriteRetryDelayMs(attempt)));
      }
    }
    throw new Error("Appwrite row create retry loop ended unexpectedly.");
  }

  async #getWorkspaceRow<Row extends Models.Row & { workspace_id: string }>(
    tableId: string,
    rowId: string,
  ): Promise<Row | null> {
    try {
      const row = await this.#tables.getRow<Row>({
        databaseId: this.#config.databaseId,
        tableId,
        rowId,
      });
      return row.workspace_id === this.#workspaceId ? row : null;
    } catch (error) {
      if (isAppwriteCode(error, 404)) return null;
      throw safeAppwriteError(error);
    }
  }

  async #requireWorkspaceRow<Row extends Models.Row & { workspace_id: string }>(
    tableId: string,
    rowId: string,
  ): Promise<Row> {
    const row = await this.#getWorkspaceRow<Row>(tableId, rowId);
    if (!row) throw new Error("Workspace record not found.");
    return row;
  }
}

export function appwriteWorkspace(): WiseDemoRepository {
  const { tables, config } = appwriteServer();
  return new WiseDemoRepository({ tables, config });
}
