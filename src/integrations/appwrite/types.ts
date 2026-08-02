import type { CompositionDesign } from "@/composition/model";
import type { SourceViewportMetadata } from "@/composition/source-viewport";
import type { RecordingLocale } from "@/lib/recording-locale";
import type {
  DemoSceneCapture,
  DemoStoryboard,
  ProductIntelligence,
  VideoQualityReview,
} from "../../lib/product-intelligence.ts";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type DemoStatus =
  "pending" | "starting" | "scanning" | "planning" | "recording" | "rendering" | "ready" | "failed";

export type ProjectRecord = {
  id: string;
  name: string;
  base_url: string;
  description: string | null;
  site_map_md: string | null;
  site_map_source: string | null;
  site_map_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectCredentialRecord = {
  project_id: string;
  kind: "none" | "password";
  login_url: string | null;
  username_hint: string | null;
  ciphertext: string | null;
  created_at: string;
  updated_at: string;
};

export type DemoRecord = {
  id: string;
  project_id: string;
  title: string;
  feature_prompt: string;
  scene_script: Json | null;
  recording_locale: RecordingLocale;
  source_viewport: SourceViewportMetadata | null;
  product_intelligence_id: string | null;
  feature_candidate_id: string | null;
  storyboard_id: string | null;
  status: DemoStatus;
  progress_pct: number;
  current_step: string | null;
  mp4_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  share_slug: string | null;
  is_public: boolean;
  steel_session_id: string | null;
  live_view_url: string | null;
  session_viewer_url: string | null;
  recording_url: string | null;
  recording_file_id: string | null;
  recording_completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  execution_attempts: number;
  execution_started_at: string | null;
  finalization_attempts: number;
  finalization_started_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DemoEventRecord = {
  id: string;
  demo_id: string;
  level: "info" | "warn" | "error";
  step: string;
  message: string | null;
  created_at: string;
};

export type CompositionRecord = {
  id: string;
  project_id: string;
  demo_id: string;
  composition_json: CompositionDesign;
  composition_version: number;
  template_id: string;
  raw_recording_file_id: string;
  created_at: string;
  updated_at: string;
};

export type CompositionRenderStatus = "queued" | "rendering" | "ready" | "failed";

export type CompositionExportRecord = {
  id: string;
  project_id: string;
  demo_id: string;
  composition_id: string;
  raw_recording_file_id: string;
  final_recording_file_id: string | null;
  render_status: CompositionRenderStatus;
  render_job_id: string;
  render_error: string | null;
  render_attempts: number;
  output_width: number;
  output_height: number;
  output_fps: number;
  output_duration: number | null;
  created_at: string;
  updated_at: string;
};

export type ProductIntelligenceRecord = {
  id: string;
  project_id: string;
  version: number;
  intelligence_json: ProductIntelligence;
  global_confidence: number;
  created_at: string;
};

export type StoryboardRecord = {
  id: string;
  project_id: string;
  demo_id: string;
  feature_candidate_id: string;
  version: number;
  storyboard_json: DemoStoryboard;
  created_at: string;
  updated_at: string;
};

export type DemoSceneRecord = {
  id: string;
  project_id: string;
  demo_id: string;
  storyboard_id: string;
  scene_key: string;
  sequence: number;
  capture_json: DemoSceneCapture;
  created_at: string;
  updated_at: string;
};

export type QualityReviewRecord = {
  id: string;
  project_id: string;
  demo_id: string;
  composition_export_id: string | null;
  review_json: VideoQualityReview;
  score: number;
  status: VideoQualityReview["status"];
  revision: number;
  created_at: string;
};

export type DirectorArtifactKind =
  | "public-intelligence"
  | "brand-style"
  | "creative-brief"
  | "capture-plan"
  | "capture-telemetry"
  | "deterministic-qa"
  | "gemini-review";

export type DirectorArtifactRecord = {
  id: string;
  project_id: string;
  demo_id: string | null;
  artifact_kind: DirectorArtifactKind;
  cache_key: string;
  status: "ready" | "unavailable" | "failed";
  payload_json: Json;
  expires_at: string | null;
  provider: string | null;
  model: string | null;
  duration_ms: number | null;
  revision: number;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectCreate = Pick<ProjectRecord, "name" | "base_url"> &
  Partial<
    Pick<ProjectRecord, "description" | "site_map_md" | "site_map_source" | "site_map_updated_at">
  >;

export type ProjectUpdate = Partial<
  Pick<ProjectRecord, "description" | "site_map_md" | "site_map_source" | "site_map_updated_at">
>;

export type DemoCreate = Pick<DemoRecord, "project_id" | "title" | "feature_prompt"> &
  Partial<
    Pick<
      DemoRecord,
      | "status"
      | "progress_pct"
      | "current_step"
      | "thumbnail_url"
      | "recording_locale"
      | "source_viewport"
      | "product_intelligence_id"
      | "feature_candidate_id"
      | "storyboard_id"
    >
  >;

export type DemoUpdate = Partial<
  Omit<DemoRecord, "id" | "project_id" | "created_at" | "updated_at">
>;

export type CompositionCreate = Omit<CompositionRecord, "id" | "created_at" | "updated_at">;

export type CompositionUpdate = Partial<
  Pick<CompositionRecord, "composition_json" | "composition_version" | "template_id">
>;

export type DirectorArtifactCreate = Omit<
  DirectorArtifactRecord,
  "id" | "created_at" | "updated_at"
>;

export type CompositionExportCreate = Omit<
  CompositionExportRecord,
  | "id"
  | "created_at"
  | "updated_at"
  | "final_recording_file_id"
  | "render_error"
  | "render_attempts"
  | "output_duration"
> &
  Partial<
    Pick<
      CompositionExportRecord,
      "final_recording_file_id" | "render_error" | "render_attempts" | "output_duration"
    >
  >;

export type CompositionExportUpdate = Partial<
  Omit<
    CompositionExportRecord,
    "id" | "project_id" | "demo_id" | "composition_id" | "created_at" | "updated_at"
  >
>;
