import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { WiseDemoRepository } from "@/integrations/appwrite/repository.server";
import type { Json } from "@/integrations/appwrite/types";
import {
  detectSourceViewport,
  readMp4Dimensions,
  rescaleSourceViewport,
  type SourceViewportMetadata,
} from "@/composition/source-viewport";

import {
  decryptProjectCredentials,
  encryptProjectCredentials,
  isSameOriginUrl,
  maskCredentialIdentifier,
} from "./credential-crypto.server";
import { normalizePublicUrl, scanWebsite } from "./studio-scanner.server";
import { assertProfessionalRecordingDuration, executeRecordingPass } from "./recording-pass.server";
import { recordingFileId, storeRecordingArtifact } from "./recording-storage.server";
import {
  createSteelSession,
  fetchSessionMp4,
  releaseSteelSession,
  runScenesOverCdp,
  SteelRecordingError,
  type CdpAction,
  type DecryptedCredentials,
} from "./steel-recorder.server";
import {
  authenticateSite,
  outlineToMarkdown,
  reconSite,
  type ReconResult,
} from "./steel-recon.server";
import { planDemoScenes } from "./scene-planner.server";
import { stableRecordingUrl } from "./demo-state";
import { recordingLocaleSchema, type RecordingLocale } from "./recording-locale";
import { buildProductIntelligence, replaceScreenshotEvidence } from "./product-intelligence.server";
import { createLaunchStoryboard } from "./story-director.server";
import type {
  DemoSceneCapture,
  DemoStoryboard,
  FeatureCandidate,
  PlannedBrowserAction,
} from "./product-intelligence";
import { serverEnv } from "./server-env.server";
import {
  normalizePublicProductIntelligence,
  publicProductIntelligenceSchema,
  type PublicProductIntelligence,
} from "./public-product-intelligence";
import {
  creativeBriefSchema,
  GeminiCreativeDirector,
  type CreativeBrief,
} from "./creative-director.server";
import {
  auditWiseResumeFixtureIsolationAccount,
  prepareWiseResumeFixtureSmartTailoring,
  verifyWiseResumeSmartTailoringTransformation,
  type WiseResumeFixtureSmartTailoringPlan,
} from "./product-adapters/wiseresume.server";
import {
  LiveAccountSafetyError,
  assertLiveAccountMutationAllowed,
  classifyAuthenticatedMap,
  preSessionSafetyState,
  serializeLiveAccountSafetyAudit,
  type LiveAccountSafetyAudit,
} from "./live-account-safety.server.ts";
import { runSingleSessionDirectedCapture } from "./single-session-director.server";
import {
  assertPrivacyShieldActive,
  installWiseDemoPrivacyShield,
  removeWiseDemoPrivacyShield,
  withProductLocaleAdapterContext,
  type PrivacyShieldCheckpointResult,
  type PrivacyShieldRegistration,
} from "./steel-recon.server";
import { canRemovePrivacyShield } from "./steel-privacy-shield.server";
import { createDirectedFailureDiagnosticPersister } from "./directed-failure-diagnostics.server";
import {
  parseWiseResumeFixtureReference,
  serializeWiseResumeFixtureReference,
  wiseResumeAccountFingerprint,
} from "./wiseresume-fixture-isolation.server";

type WorkspaceContext = { repository: WiseDemoRepository };
type DirectedPreflight = {
  candidate: FeatureCandidate;
  storyboard: DemoStoryboard;
  actions: CdpAction[];
  adapterPlan: WiseResumeFixtureSmartTailoringPlan;
};

// Authentication was removed for the experimental stage: every visitor works in
// one shared workspace, and all database access goes through the Appwrite Server
// SDK inside server functions (the tables and bucket stay unreachable from browsers).

async function workspaceContext(): Promise<WorkspaceContext> {
  const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
  return { repository: appwriteWorkspace() };
}

async function loadCredentials(
  context: WorkspaceContext,
  projectId: string,
): Promise<{ credentials: DecryptedCredentials; loginUrl: string | null }> {
  const row = await context.repository.getCredential(projectId);

  const credentials =
    row?.kind === "password" && row.ciphertext ? decryptProjectCredentials(row.ciphertext) : null;
  return { credentials, loginUrl: row?.login_url ?? null };
}

function directorCacheKey(projectUrl: string, suffix: string): string {
  return `${suffix}:${new URL(projectUrl).hostname.toLowerCase()}`;
}

function expiresAt(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

function directorFeatureEnabled(): boolean {
  return serverEnv("WISEDEMO_SINGLE_SESSION_DIRECTOR")?.toLowerCase() !== "false";
}

async function resolvePublicProductIntelligence(
  context: WorkspaceContext,
  project: {
    id: string;
    name: string;
    base_url: string;
    description: string | null;
    site_map_md: string | null;
  },
  forceRefresh: boolean,
): Promise<{ intelligence: PublicProductIntelligence; source: "context" | "legacy-fallback" }> {
  const cacheKey = directorCacheKey(project.base_url, "public-intelligence");
  if (!forceRefresh) {
    const cached = await context.repository
      .getCachedDirectorArtifact({
        projectId: project.id,
        artifactKind: "public-intelligence",
        cacheKey,
      })
      .catch(() => null);
    if (cached?.status === "ready") {
      const parsed = publicProductIntelligenceSchema.safeParse(cached.payload_json);
      if (parsed.success) return { intelligence: parsed.data, source: "context" };
    }
  }

  try {
    const { createContextClient } = await import("@/integrations/context/context-client.server");
    const { ContextProductIntelligenceProvider } =
      await import("@/integrations/context/context-product-intelligence.server");
    const provider = new ContextProductIntelligenceProvider({ client: createContextClient() });
    const intelligence = await provider.analyzePublicProduct({
      url: project.base_url,
      forceRefresh,
    });
    await context.repository.createDirectorArtifact({
      project_id: project.id,
      demo_id: null,
      artifact_kind: "public-intelligence",
      cache_key: cacheKey,
      status: "ready",
      payload_json: intelligence as unknown as Json,
      expires_at: expiresAt(604_800_000),
      provider: "context.dev",
      model: null,
      duration_ms: null,
      revision: 0,
      failure_reason: null,
    });
    await context.repository.createDirectorArtifact({
      project_id: project.id,
      demo_id: null,
      artifact_kind: "brand-style",
      cache_key: directorCacheKey(project.base_url, "brand-style"),
      status: "ready",
      payload_json: {
        brand: intelligence.brand,
        visualIdentity: intelligence.visualIdentity,
      } as Json,
      expires_at: expiresAt(2_592_000_000),
      provider: "context.dev",
      model: null,
      duration_ms: null,
      revision: 0,
      failure_reason: null,
    });
    return { intelligence, source: "context" };
  } catch (error) {
    const fallback = normalizePublicProductIntelligence({
      sourceUrl: project.base_url,
      extract: {
        data: {
          name: project.name,
          description: project.description,
          audience: [],
          valuePropositions: [],
          features: [],
          useCases: [],
          callsToAction: [],
        },
        urls_analyzed: [project.base_url],
      },
      warnings: [
        "Context.dev is unavailable. Legacy public metadata is available, but contains no verified feature plan.",
      ],
    });
    await context.repository
      .createDirectorArtifact({
        project_id: project.id,
        demo_id: null,
        artifact_kind: "public-intelligence",
        cache_key: cacheKey,
        status: "unavailable",
        payload_json: fallback as unknown as Json,
        expires_at: null,
        provider: "context.dev",
        model: null,
        duration_ms: null,
        revision: 0,
        failure_reason:
          error instanceof Error ? error.message.slice(0, 300) : "Context.dev request failed.",
      })
      .catch(() => undefined);
    return { intelligence: fallback, source: "legacy-fallback" };
  }
}

async function createDirectorBrief(
  context: WorkspaceContext,
  project: {
    id: string;
    name: string;
    base_url: string;
    description: string | null;
    site_map_md: string | null;
  },
  input: { featureBrief?: string | null; recordingLocale: RecordingLocale; demoId?: string | null },
): Promise<{ brief: CreativeBrief; intelligence: PublicProductIntelligence }> {
  if (!directorFeatureEnabled())
    throw new Error(
      "The one-session director path is disabled by WISEDEMO_SINGLE_SESSION_DIRECTOR.",
    );
  const { intelligence, source } = await resolvePublicProductIntelligence(context, project, false);
  if (source !== "context" || !intelligence.features.length) {
    throw new Error(
      "Public product intelligence is unavailable or incomplete. A directed capture will not fall back to generic browsing.",
    );
  }
  const { credentials } = await loadCredentials(context, project.id);
  const requestedFeatureBrief = input.featureBrief?.trim().toLocaleLowerCase();
  const cachedBrief = requestedFeatureBrief
    ? (await context.repository.listDirectorArtifacts(project.id))
        .filter(
          (artifact) => artifact.artifact_kind === "creative-brief" && artifact.status === "ready",
        )
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map((artifact) => ({
          artifact,
          parsed: creativeBriefSchema.safeParse(artifact.payload_json),
        }))
        .find(
          ({ parsed }) =>
            parsed.success &&
            requestedFeatureBrief.includes(parsed.data.selectedFeature.name.toLocaleLowerCase()),
        )
    : undefined;
  if (cachedBrief && cachedBrief.parsed.success) {
    const brief = cachedBrief.parsed.data;
    await context.repository.createDirectorArtifact({
      project_id: project.id,
      demo_id: input.demoId ?? null,
      artifact_kind: "creative-brief",
      cache_key: cachedBrief.artifact.cache_key,
      status: "ready",
      payload_json: brief as unknown as Json,
      expires_at: cachedBrief.artifact.expires_at,
      provider: cachedBrief.artifact.provider,
      model: cachedBrief.artifact.model,
      duration_ms: cachedBrief.artifact.duration_ms,
      revision: cachedBrief.artifact.revision + 1,
      failure_reason: null,
    });
    return { brief, intelligence };
  }
  const { createGeminiClient } = await import("@/integrations/gemini/gemini-client.server");
  const director = new GeminiCreativeDirector(createGeminiClient());
  const brief = await director.createBrief({
    intelligence,
    featureBrief: input.featureBrief,
    projectName: project.name,
    requestedLanguage: input.recordingLocale === "arabic" ? "arabic" : "english",
    credentialsAvailable: Boolean(credentials),
  });
  await context.repository.createDirectorArtifact({
    project_id: project.id,
    demo_id: input.demoId ?? null,
    artifact_kind: "creative-brief",
    cache_key: `${directorCacheKey(project.base_url, "creative-brief")}:${brief.selectedFeature.publicFeatureId}`,
    status: "ready",
    payload_json: brief as unknown as Json,
    expires_at: expiresAt(604_800_000),
    provider: "gemini",
    model: serverEnv("GEMINI_PLANNING_MODEL") ?? "gemini-3.6-flash",
    duration_ms: null,
    revision: 0,
    failure_reason: null,
  });
  return { brief, intelligence };
}

function boundedArtifactCacheKey(base: string, suffix: string): string {
  const safeSuffix = suffix.slice(-127);
  return `${base.slice(0, Math.max(0, 127 - safeSuffix.length))}:${safeSuffix}`;
}

export const createProject = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        name: z.string().trim().min(2).max(80),
        baseUrl: z.string().trim().min(3).max(300),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    let baseUrl: string;
    try {
      baseUrl = normalizePublicUrl(data.baseUrl);
    } catch {
      throw new Error("Enter a valid website URL.");
    }

    const scan = await scanWebsite(baseUrl, data.name);

    return context.repository.createProject({
      name: data.name,
      base_url: baseUrl,
      description: scan.description,
      site_map_md: scan.siteMapMd,
      site_map_source: "manual",
      site_map_updated_at: new Date().toISOString(),
    });
  });

export type ProjectListItem = {
  id: string;
  name: string;
  base_url: string;
  created_at: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  base_url: string;
  description: string | null;
  site_map_md: string | null;
  site_map_source: string | null;
  site_map_updated_at: string | null;
  created_at: string;
};

export type DemoRecord = {
  id: string;
  title: string;
  feature_prompt: string;
  scene_script: Json | null;
  recording_locale: RecordingLocale;
  source_viewport: SourceViewportMetadata | null;
  product_intelligence_id: string | null;
  feature_candidate_id: string | null;
  storyboard_id: string | null;
  status: string;
  progress_pct: number;
  current_step: string | null;
  mp4_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  steel_session_id: string | null;
  live_view_url: string | null;
  session_viewer_url: string | null;
  recording_url: string | null;
  recording_file_id: string | null;
  recording_completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

function withDurableRecordingUrl<T extends { id: string; status: string }>(
  demo: T,
): T & { mp4_url?: string; recording_url?: string } {
  const fileId = (demo as T & { recording_file_id?: string | null }).recording_file_id;
  if (demo.status !== "ready" || !fileId) return demo;
  const url = stableRecordingUrl(demo.id);
  return { ...demo, mp4_url: url, recording_url: url };
}

async function appendDemoEvent(
  context: WorkspaceContext,
  demoId: string,
  level: "info" | "warn" | "error",
  step: string,
  message: string,
): Promise<void> {
  const safeMessage = message.slice(0, 1_000);
  try {
    await context.repository.appendDemoEvent({
      demo_id: demoId,
      level,
      step,
      message: safeMessage,
    });
  } catch (error) {
    console.error("[WiseDemo] demo event insert failed", {
      demoId,
      step,
      code: error instanceof Error ? error.message : "APPWRITE_EVENT_WRITE_FAILED",
    });
  }
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger("[WiseDemo] demo event", { demoId, level, step, message: safeMessage });
}

function publicSceneAction(action: CdpAction): Json {
  if (action.type === "type") {
    return { ...action, text: "[redacted input]" } as Json;
  }
  if (action.type === "eval") {
    return { type: "eval", expression: "[redacted expression]" } as Json;
  }
  return action as unknown as Json;
}

export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  const context = await workspaceContext();
  return (await context.repository.listProjects()) as ProjectListItem[];
});

export const getProjectWorkspace = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const project = await context.repository.getProject(data.projectId);
    if (!project) throw new Error("Project not found.");

    const demos = await context.repository.listDemos(data.projectId);
    const [intelligence, storyboards, scenes, qualityReviews, directorArtifacts] =
      await Promise.all([
        context.repository.getLatestProductIntelligence(data.projectId).catch(() => null),
        Promise.all(demos.map((demo) => context.repository.listStoryboards(demo.id)))
          .then((items) => items.flat())
          .catch(() => []),
        Promise.all(demos.map((demo) => context.repository.listDemoScenes(demo.id)))
          .then((items) => items.flat())
          .catch(() => []),
        Promise.all(demos.map((demo) => context.repository.listQualityReviews(demo.id)))
          .then((items) => items.flat())
          .catch(() => []),
        context.repository.listDirectorArtifacts(data.projectId).catch(() => []),
      ]);

    let credentials: {
      kind: "none" | "cookie" | "password";
      login_url: string | null;
      username_hint: string | null;
      updated_at: string | null;
    } | null = null;

    try {
      const credentialMeta = await context.repository.getCredential(data.projectId);
      credentials = credentialMeta
        ? {
            kind: credentialMeta.kind,
            login_url: credentialMeta.login_url,
            username_hint: maskCredentialIdentifier(credentialMeta.username_hint),
            updated_at: credentialMeta.updated_at,
          }
        : null;
    } catch {
      credentials = null;
    }

    return {
      project: project as ProjectRecord,
      demos: demos.map((demo) => withDurableRecordingUrl(demo)) as DemoRecord[],
      credentials,
      intelligence,
      storyboards,
      scenes,
      qualityReviews,
      directorArtifacts,
    };
  });

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function storyboardActionToCdp(action: PlannedBrowserAction): CdpAction {
  const expected = { selector: action.expectedSelector, urlIncludes: action.expectedUrlIncludes };
  if (action.type === "goto" && action.url)
    return { type: "goto", url: action.url, waitMs: action.waitMs, expected };
  if (action.type === "click" && action.selector)
    return { type: "click", selector: action.selector, expected };
  if (action.type === "type" && action.selector)
    return { type: "type", selector: action.selector, text: action.text ?? "", expected };
  if (action.type === "scroll") return { type: "scroll", deltaY: action.deltaY ?? 500, expected };
  return { type: "wait", ms: action.waitMs ?? 1_000, expected };
}

export const analyzeProductIntelligence = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
        recordingLocale: recordingLocaleSchema.default("english"),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const project = await context.repository.getProject(data.projectId);
    if (!project) throw new Error("Project not found.");
    const { credentials, loginUrl } = await loadCredentials(context, data.projectId);
    let sessionId: string | null = null;
    try {
      const session = await createSteelSession(project.base_url, data.recordingLocale);
      sessionId = session.id;
      if (!session.websocketUrl)
        throw new Error("The product intelligence session has no browser connection.");
      const recon = await reconSite({
        websocketUrl: session.websocketUrl,
        baseUrl: project.base_url,
        loginUrl,
        credentials,
        maxPages: 3,
        recordingLocale: data.recordingLocale,
      });
      const rawIntelligence = buildProductIntelligence({
        productName: project.name,
        baseUrl: project.base_url,
        recon,
      });
      const screenshotUrls = new Map<string, string>();
      const { storeEvidenceScreenshot } =
        await import("@/integrations/appwrite/evidence-storage.server");
      for (const observation of recon.observations) {
        if (!observation.screenshotBase64 || observation.sensitive) continue;
        await storeEvidenceScreenshot(
          observation.screenshotId,
          decodeBase64(observation.screenshotBase64),
        );
        screenshotUrls.set(
          observation.screenshotId,
          `/api/public/evidence/${observation.screenshotId}`,
        );
      }
      const intelligence = replaceScreenshotEvidence(rawIntelligence, screenshotUrls);
      const previous = await context.repository.getLatestProductIntelligence(project.id);
      const stored = await context.repository.createProductIntelligence({
        project_id: project.id,
        intelligence,
        version: (previous?.version ?? 0) + 1,
      });
      await context.repository.updateProject(project.id, {
        description: intelligence.valuePropositions[0]?.statement ?? project.description,
        site_map_md: outlineToMarkdown(project.name, project.base_url, recon),
        site_map_source: "agent",
        site_map_updated_at: new Date().toISOString(),
      });
      return stored;
    } finally {
      if (sessionId) await releaseSteelSession(sessionId).catch(() => undefined);
    }
  });

export const analyzePublicProduct = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
        forceRefresh: z.boolean().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const project = await context.repository.getProject(data.projectId);
    if (!project) throw new Error("Project not found.");
    return resolvePublicProductIntelligence(context, project, data.forceRefresh);
  });

export const createDirectedDemo = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().trim().min(2).max(100),
        featureBrief: z.string().trim().max(1_000).optional(),
        recordingLocale: recordingLocaleSchema.default("english"),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const project = await context.repository.getProject(data.projectId);
    if (!project) throw new Error("Project not found.");
    let demo = await context.repository.createDemo({
      project_id: project.id,
      title: data.title,
      feature_prompt:
        data.featureBrief ?? "Create an evidence-backed product advertisement automatically.",
      recording_locale: data.recordingLocale,
      status: "planning",
      progress_pct: 18,
      current_step: "Analyzing public product and creating advertisement story...",
      thumbnail_url: `/api/public/screenshot?url=${encodeURIComponent(project.base_url)}&width=1280`,
    });
    try {
      const { brief } = await createDirectorBrief(context, project, {
        featureBrief: data.featureBrief,
        recordingLocale: data.recordingLocale,
        demoId: demo.id,
      });
      demo = await context.repository.updateDemo(demo.id, {
        status: "pending",
        progress_pct: 30,
        current_step: `Ready for one-session capture: ${brief.selectedFeature.name}.`,
      });
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "DIRECTOR_BRIEF_READY",
        `Creative brief selected ${brief.selectedFeature.name} from public evidence.`,
      );
      return { demo: withDurableRecordingUrl(demo), brief };
    } catch (error) {
      demo = await context.repository.updateDemo(demo.id, {
        status: "failed",
        progress_pct: 0,
        current_step: "Creative planning unavailable; generic capture was not started.",
        error_message:
          error instanceof Error ? error.message.slice(0, 500) : "Creative planning failed.",
      });
      await appendDemoEvent(
        context,
        demo.id,
        "error",
        "DIRECTOR_BRIEF_FAILED",
        "Creative planning failed before any Steel session was created.",
      );
      throw error;
    }
  });

export const captureDirectedDemo = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const demo = await context.repository.getDemo(data.demoId);
    if (!demo) throw new Error("Demo not found.");
    if (["rendering", "ready"].includes(demo.status)) return withDurableRecordingUrl(demo);
    if (!directorFeatureEnabled()) {
      throw new Error(
        "The one-session director path is disabled by WISEDEMO_SINGLE_SESSION_DIRECTOR.",
      );
    }
    const claimed = await context.repository.claimDemoExecution(demo.id);
    if (!claimed) return withDurableRecordingUrl(demo);
    const project = await context.repository.getProject(demo.project_id);
    if (!project) throw new Error("Project not found.");
    const artifacts = await context.repository.listDirectorArtifacts(project.id);
    const briefArtifact = artifacts.find(
      (artifact) =>
        artifact.demo_id === demo.id &&
        artifact.artifact_kind === "creative-brief" &&
        artifact.status === "ready",
    );
    if (!briefArtifact) throw new Error("This directed demo has no valid creative brief.");
    const parsedBrief = creativeBriefSchema.safeParse(briefArtifact.payload_json);
    if (!parsedBrief.success) throw new Error("This directed demo has no valid creative brief.");
    const brief = parsedBrief.data;
    const { credentials, loginUrl } = await loadCredentials(context, project.id);
    if (!credentials)
      throw new Error("Directed WiseResume capture requires encrypted test credentials.");
    const credentialMeta = await context.repository.getCredential(project.id);
    const accountFingerprint = wiseResumeAccountFingerprint(credentials.username);
    const storedFixture = parseWiseResumeFixtureReference(
      artifacts.find(
        (artifact) =>
          artifact.artifact_kind === "wiseresume-fixture-reference" && artifact.status === "ready",
      )?.payload_json,
    );
    const mapState = classifyAuthenticatedMap({
      credentialSavedAt: credentialMeta?.updated_at,
      authenticatedMapUpdatedAt: project.site_map_updated_at,
    });
    const auditCacheKey = boundedArtifactCacheKey(
      briefArtifact.cache_key,
      `live-account-safety:${credentialMeta?.updated_at ?? "unknown"}`,
    );
    await context.repository.updateDemo(demo.id, {
      current_step: preSessionSafetyState(mapState),
      progress_pct: 42,
    });
    await context.repository.createDirectorArtifact({
      project_id: project.id,
      demo_id: demo.id,
      artifact_kind: "live-account-safety-audit",
      cache_key: auditCacheKey,
      status: "ready",
      payload_json: {
        status: preSessionSafetyState(mapState),
        authenticatedMapState: mapState,
      } as Json,
      expires_at: null,
      provider: "wisedemo",
      model: null,
      duration_ms: null,
      revision: 0,
      failure_reason: null,
    });
    const monotonicNow = () => performance.now();
    const privacyShieldCheckpoints: PrivacyShieldCheckpointResult[] = [];
    const failureDiagnostics = createDirectedFailureDiagnosticPersister({
      repository: context.repository,
      projectId: project.id,
      demoId: demo.id,
      auditCacheKey,
      authenticatedMapState: mapState,
    });
    try {
      const capture = await runSingleSessionDirectedCapture<
        Awaited<ReturnType<typeof createSteelSession>>,
        DirectedPreflight,
        unknown,
        LiveAccountSafetyAudit,
        PrivacyShieldRegistration
      >({
        sessionBootstrapUrl: "about:blank",
        productLoginUrl: loginUrl ?? credentials.loginUrl,
        productStartUrl: project.base_url,
        createSession: (sessionBootstrapUrl) =>
          createSteelSession(sessionBootstrapUrl, demo.recording_locale),
        releaseSession: releaseSteelSession,
        finalActions: (preflight) => preflight.actions,
        now: monotonicNow,
        publishLiveSession: async (session) => {
          await context.repository.updateDemo(demo.id, {
            status: "recording",
            progress_pct: 48,
            current_step: "Preparing fictional demo state in the directed Steel session...",
            steel_session_id: session.id,
            live_view_url: session.liveViewUrl ?? session.debugUrl ?? null,
            session_viewer_url: session.sessionViewerUrl ?? null,
          });
          await appendDemoEvent(
            context,
            demo.id,
            "info",
            "DIRECTOR_SESSION_STARTED",
            "One Steel session opened for targeted preflight and final take.",
          );
        },
        installPrivacyShield: (websocketUrl) =>
          installWiseDemoPrivacyShield({ websocketUrl, recordingLocale: demo.recording_locale }),
        assertPrivacyShield: async (websocketUrl, checkpoint) => {
          const result = await assertPrivacyShieldActive({
            websocketUrl,
            checkpoint,
            recordingLocale: demo.recording_locale,
          });
          privacyShieldCheckpoints.push(result);
          await failureDiagnostics.persistCheckpoint(result);
        },
        removePrivacyShield: async (websocketUrl, preflight, registration) => {
          if (!canRemovePrivacyShield(preflight.adapterPlan.finalVisibleSafety))
            throw new Error("WiseResume fixture viewport is not safe for the final take.");
          await removeWiseDemoPrivacyShield({
            websocketUrl,
            recordingLocale: demo.recording_locale,
            registration,
          });
        },
        authenticate: credentials
          ? async (websocketUrl, productUrls) => {
              const authenticated = await authenticateSite({
                websocketUrl,
                loginUrl: productUrls.productLoginUrl ?? loginUrl ?? credentials.loginUrl,
                credentials,
                recordingLocale: demo.recording_locale,
                privacyShielded: true,
                onPrivacyShieldCheckpoint: (result) => {
                  privacyShieldCheckpoints.push(result);
                  return failureDiagnostics.persistCheckpoint(result);
                },
              });
              await context.repository.updateDemo(demo.id, {
                source_viewport: detectSourceViewport(authenticated.browserMetrics, {
                  width: authenticated.browserMetrics.outerWidth,
                  height: authenticated.browserMetrics.outerHeight,
                }),
              });
            }
          : undefined,
        liveAccountSafetyAudit: async (websocketUrl) => {
          const audit = await withProductLocaleAdapterContext({
            websocketUrl,
            recordingLocale: demo.recording_locale,
            execute: (adapterContext) =>
              auditWiseResumeFixtureIsolationAccount(adapterContext, {
                expectedAccountFingerprint: accountFingerprint,
                accountFingerprint,
                storedFixture,
                onIdentityAttempt: failureDiagnostics.persistIdentityAttempt,
              }),
          });
          await failureDiagnostics.persistAudit(audit);
          return audit;
        },
        assertMutationAllowed: (audit) =>
          assertLiveAccountMutationAllowed(audit as LiveAccountSafetyAudit | undefined),
        preflight: async (
          websocketUrl,
          _maxWallMs,
          liveAccountSafetyAudit,
        ): Promise<DirectedPreflight> => {
          if (brief.selectedFeature.name !== "Smart Tailoring") {
            throw new Error(
              "WiseResume directed capture currently supports the validated Smart Tailoring brief only.",
            );
          }
          const adapterPlan = await withProductLocaleAdapterContext({
            websocketUrl,
            recordingLocale: demo.recording_locale,
            execute: (adapterContext) =>
              prepareWiseResumeFixtureSmartTailoring(adapterContext, {
                liveAccountSafetyAudit: liveAccountSafetyAudit as
                  LiveAccountSafetyAudit | undefined,
                storedFixture,
                accountFingerprint,
                assertPrivacyShield: async (checkpoint) => {
                  privacyShieldCheckpoints.push(
                    await assertPrivacyShieldActive({
                      websocketUrl,
                      checkpoint,
                      recordingLocale: demo.recording_locale,
                    }),
                  );
                  await failureDiagnostics.persistCheckpoint(privacyShieldCheckpoints.at(-1)!);
                },
              }),
          });
          const candidate = {
            id: crypto.randomUUID(),
            name: brief.selectedFeature.name,
            description: brief.selectedFeature.whySelected,
            userProblem: brief.selectedFeature.userProblem,
            userBenefit: brief.selectedFeature.userBenefit,
            requiredState: "A fictional resume and job posting are prepared in WiseResume.",
            entryUrl: adapterPlan.tailoringUrl,
            actions: [
              {
                id: crypto.randomUUID(),
                type: "click",
                label: "Apply Smart Tailoring",
                selector: adapterPlan.tailoringActionSelector,
                status: "successful",
                requiredState: "The fictional job posting is ready for tailoring.",
                visualChangeScore: 0.9,
                semanticChangeScore: 0.9,
                reliabilityScore: 0.9,
                evidence: [],
              },
            ],
            expectedResult: "Visible tailored resume content with target-role alignment.",
            visualChangeScore: 0.9,
            marketingValueScore: 0.9,
            reliabilityScore: 0.9,
            confidenceScore: 0.9,
            estimatedDurationSeconds: brief.targetDurationSeconds,
            requiredPreparation: ["fictional resume", "fictional job posting"],
            evidence: [],
          } as FeatureCandidate;
          const baseStoryboard = createLaunchStoryboard({ productName: project.name, candidate });
          const copy = [
            brief.hook,
            ...brief.captions.map((caption) => caption.text),
            brief.proofStatement,
            brief.callToAction,
          ];
          const storyboard: DemoStoryboard = {
            ...baseStoryboard,
            title: `${project.name}: ${brief.selectedFeature.name}`,
            targetAudience: brief.audience,
            corePromise: brief.corePromise,
            scenes: baseStoryboard.scenes.map((scene, index) => ({
              ...scene,
              headline: copy[Math.min(index, copy.length - 1)],
              narration: brief.narration[index]?.text ?? "",
              caption: copy[Math.min(index, copy.length - 1)],
              expectedResult: candidate.expectedResult,
            })),
          };
          const actions = adapterPlan.finalActions;
          if (!actions.length)
            throw new Error("Targeted preflight did not produce verified final-take actions.");
          return { candidate, storyboard, actions, adapterPlan };
        },
        executeFinalTake: (websocketUrl, maxWallMs, preflight) =>
          runScenesOverCdp(websocketUrl, preflight.actions, maxWallMs, demo.recording_locale, {
            now: monotonicNow,
          }),
        verifyFinalTake: (websocketUrl, preflight) =>
          withProductLocaleAdapterContext({
            websocketUrl,
            recordingLocale: demo.recording_locale,
            execute: (adapterContext) =>
              verifyWiseResumeSmartTailoringTransformation(adapterContext, preflight.adapterPlan),
          }),
      });
      const preflight = capture.preflight;
      await context.repository.createDirectorArtifact({
        project_id: project.id,
        demo_id: demo.id,
        artifact_kind: "privacy-shield-checkpoints",
        cache_key: boundedArtifactCacheKey(briefArtifact.cache_key, "privacy-shield-checkpoints"),
        status: "ready",
        payload_json: privacyShieldCheckpoints.map(
          ({ checkpoint, active, repaired, timestampMs }) => ({
            checkpoint,
            active,
            repaired,
            timestampMs,
          }),
        ) as Json,
        expires_at: null,
        provider: "wisedemo",
        model: null,
        duration_ms: null,
        revision: 0,
        failure_reason: null,
      });
      await context.repository.createDirectorArtifact({
        project_id: project.id,
        demo_id: demo.id,
        artifact_kind: "wiseresume-fixture-reference",
        cache_key: boundedArtifactCacheKey(briefArtifact.cache_key, "wiseresume-fixture"),
        status: "ready",
        payload_json: serializeWiseResumeFixtureReference(preflight.adapterPlan.fixture) as Json,
        expires_at: null,
        provider: "wisedemo",
        model: null,
        duration_ms: null,
        revision: 0,
        failure_reason: null,
      });
      await context.repository.createDirectorArtifact({
        project_id: project.id,
        demo_id: demo.id,
        artifact_kind: "live-account-safety-audit",
        cache_key: auditCacheKey,
        status: "ready",
        payload_json: {
          authenticatedMapState: mapState,
          audit: serializeLiveAccountSafetyAudit(
            capture.liveAccountSafetyAudit as LiveAccountSafetyAudit,
          ),
        } as Json,
        expires_at: null,
        provider: "steel.dev",
        model: null,
        duration_ms: null,
        revision: 1,
        failure_reason: null,
      });
      const storedStoryboard = await context.repository.createStoryboard({
        project_id: project.id,
        demo_id: demo.id,
        feature_candidate_id: preflight.candidate.id,
        storyboard: preflight.storyboard,
      });
      for (const [sequence, scene] of preflight.storyboard.scenes.entries()) {
        await context.repository.upsertDemoScene({
          project_id: project.id,
          demo_id: demo.id,
          storyboard_id: storedStoryboard.id,
          scene_key: scene.id,
          sequence,
          capture: {
            sceneId: scene.id,
            sequence,
            status: "captured",
            sourceStartSeconds: Math.max(
              0,
              (capture.markers.takeStartedAtMs - capture.markers.sessionStartedAtMs) / 1_000,
            ),
            sourceDurationSeconds: Math.min(
              60,
              (capture.markers.takeEndedAtMs - capture.markers.takeStartedAtMs) / 1_000,
            ),
            retryCount: 0,
            actionLog: capture.telemetry.map((event) => ({
              actionId: event.id,
              status: event.type === "error" ? ("failed" as const) : ("successful" as const),
              startedAt: event.timestampMs,
              completedAt: event.timestampMs,
              cursor: event.cursor ?? undefined,
              message: event.expectedResult ?? event.type,
            })),
            evidence: [],
            failureReason: null,
          },
        });
      }
      await context.repository.createDirectorArtifact({
        project_id: project.id,
        demo_id: demo.id,
        artifact_kind: "capture-plan",
        cache_key: boundedArtifactCacheKey(briefArtifact.cache_key, "capture-plan"),
        status: "ready",
        payload_json: {
          captureIntent: brief.captureIntent,
          takeMarkers: capture.markers,
          transformationEvidence: capture.verification,
        } as unknown as Json,
        expires_at: null,
        provider: "steel.dev",
        model: null,
        duration_ms: Math.round(capture.markers.takeEndedAtMs - capture.markers.takeStartedAtMs),
        revision: 0,
        failure_reason: null,
      });
      await context.repository.createDirectorArtifact({
        project_id: project.id,
        demo_id: demo.id,
        artifact_kind: "capture-telemetry",
        cache_key: boundedArtifactCacheKey(briefArtifact.cache_key, "telemetry"),
        status: "ready",
        payload_json: capture.telemetry as unknown as Json,
        expires_at: null,
        provider: "steel.dev",
        model: null,
        duration_ms: Math.round(capture.markers.takeEndedAtMs - capture.markers.takeStartedAtMs),
        revision: 0,
        failure_reason: null,
      });
      const rendering = await context.repository.updateDemo(demo.id, {
        status: "rendering",
        progress_pct: 80,
        current_step: "Steel final take complete; finalizing the immutable raw recording...",
        steel_session_id: capture.session.id,
        storyboard_id: storedStoryboard.id,
        feature_candidate_id: preflight.candidate.id,
        live_view_url: null,
        execution_started_at: null,
      });
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "DIRECTOR_TAKE_COMPLETE",
        "One-session preflight and verified feature take completed; only render-time revisions remain.",
      );
      return withDurableRecordingUrl(rendering);
    } catch (error) {
      if (privacyShieldCheckpoints.length) {
        await context.repository
          .createDirectorArtifact({
            project_id: project.id,
            demo_id: demo.id,
            artifact_kind: "privacy-shield-checkpoints",
            cache_key: boundedArtifactCacheKey(
              briefArtifact.cache_key,
              "privacy-shield-checkpoints",
            ),
            status: "ready",
            payload_json: privacyShieldCheckpoints.map(
              ({ checkpoint, active, repaired, timestampMs }) => ({
                checkpoint,
                active,
                repaired,
                timestampMs,
              }),
            ) as Json,
            expires_at: null,
            provider: "wisedemo",
            model: null,
            duration_ms: null,
            revision: 1,
            failure_reason: null,
          })
          .catch(() => undefined);
      }
      if (error instanceof LiveAccountSafetyError) {
        await context.repository
          .createDirectorArtifact({
            project_id: project.id,
            demo_id: demo.id,
            artifact_kind: "live-account-safety-audit",
            cache_key: auditCacheKey,
            status: error.audit.status === "unsafe" ? "failed" : "unavailable",
            payload_json: {
              authenticatedMapState: mapState,
              audit: serializeLiveAccountSafetyAudit(error.audit),
            } as Json,
            expires_at: null,
            provider: "steel.dev",
            model: null,
            duration_ms: null,
            revision: 1,
            failure_reason: error.audit.reasons.join(" ").slice(0, 300),
          })
          .catch(() => undefined);
      }
      const message =
        error instanceof Error ? error.message : "Directed one-session capture failed.";
      const failed = await context.repository.updateDemo(demo.id, {
        status: "failed",
        progress_pct: 0,
        current_step: "Directed capture failed before media finalization.",
        error_code: "DIRECTOR_CAPTURE_FAILED",
        error_message: message,
        execution_started_at: null,
      });
      await appendDemoEvent(context, demo.id, "error", "DIRECTOR_CAPTURE_FAILED", message);
      return withDurableRecordingUrl(failed);
    }
  });

export const scanProjectSite = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const existing = await context.repository.getProject(data.projectId);
    if (!existing) throw new Error("Project not found.");

    const { credentials, loginUrl } = await loadCredentials(context, data.projectId);

    // Agentic pass first: a real browser opens the product (signing in when
    // credentials exist) and reads the actual DOM.
    let siteMapMd: string | null = null;
    let description: string | null = null;
    let sessionId: string | null = null;
    try {
      const session = await createSteelSession(existing.base_url);
      sessionId = session.id;
      if (session.websocketUrl) {
        const recon = await reconSite({
          websocketUrl: session.websocketUrl,
          baseUrl: existing.base_url,
          loginUrl,
          credentials,
          maxPages: 4,
        });
        if (recon.pages.length) {
          siteMapMd = outlineToMarkdown(existing.name, existing.base_url, recon);
          description = recon.pages[0]?.headings[0] ?? null;
        }
      }
    } catch (scanError) {
      if (credentials) {
        throw new Error(
          scanError instanceof Error && scanError.message.includes("credential")
            ? scanError.message
            : "Authenticated product scan failed. Check the stored access and login URL.",
        );
      }
      siteMapMd = null;
    } finally {
      if (sessionId) await releaseSteelSession(sessionId).catch(() => null);
    }

    if (!siteMapMd) {
      const scan = await scanWebsite(existing.base_url, existing.name);
      siteMapMd = scan.siteMapMd;
      description = scan.description;
    }

    return context.repository.updateProject(data.projectId, {
      description,
      site_map_md: siteMapMd,
      site_map_source: "manual",
      site_map_updated_at: new Date().toISOString(),
    });
  });

export const saveProjectMap = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
        description: z.string().trim().max(800).optional(),
        siteMapMd: z.string().trim().min(10).max(20000),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    return context.repository.updateProject(data.projectId, {
      description: data.description && data.description.length > 0 ? data.description : null,
      site_map_md: data.siteMapMd,
      site_map_source: "manual",
      site_map_updated_at: new Date().toISOString(),
    });
  });

export const saveProjectCredential = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
        kind: z.enum(["none", "password"]),
        loginUrl: z.string().trim().max(300).optional(),
        username: z.string().trim().max(160).optional(),
        secret: z.string().max(2000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const project = await context.repository.getProject(data.projectId);
    if (!project) throw new Error("Project not found.");

    if (data.kind === "none") {
      await context.repository.deleteCredential(data.projectId);
      return { kind: "none" as const, login_url: null, username_hint: null, updated_at: null };
    }

    if (!data.loginUrl || !data.username || !data.secret) {
      throw new Error("Login URL, username, and secret are required.");
    }

    const candidate = /^https?:\/\//i.test(data.loginUrl)
      ? data.loginUrl
      : `https://${data.loginUrl}`;
    let loginUrl: URL;

    try {
      loginUrl = new URL(candidate);
    } catch {
      throw new Error("Enter a valid login URL.");
    }
    if (
      !["http:", "https:"].includes(loginUrl.protocol) ||
      !isSameOriginUrl(loginUrl, project.base_url)
    ) {
      throw new Error("The login URL must use the same HTTP(S) origin as the project.");
    }

    const ciphertext = encryptProjectCredentials({
      loginUrl: loginUrl.toString(),
      username: data.username,
      secret: data.secret,
    });

    await context.repository.upsertCredential({
      project_id: data.projectId,
      kind: "password",
      login_url: loginUrl.toString(),
      username_hint: data.username,
      ciphertext,
    });

    return {
      kind: "password" as const,
      login_url: loginUrl.toString(),
      username_hint: maskCredentialIdentifier(data.username),
      updated_at: new Date().toISOString(),
    };
  });

export const createDemoJob = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().trim().min(2).max(100),
        featurePrompt: z.string().trim().min(10).max(4000),
        recordingLocale: recordingLocaleSchema.default("english"),
        featureCandidateId: z.string().min(1).max(96).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    let project = await context.repository.getProject(data.projectId);
    if (!project) throw new Error("Project not found.");

    if (!project.site_map_md) {
      const scan = await scanWebsite(project.base_url, project.name);
      project = await context.repository.updateProject(data.projectId, {
        description: scan.description,
        site_map_md: scan.siteMapMd,
        site_map_source: "manual",
        site_map_updated_at: new Date().toISOString(),
      });
    }

    const intelligence = data.featureCandidateId
      ? await context.repository.getLatestProductIntelligence(data.projectId)
      : null;
    const candidate = intelligence?.intelligence_json.featureCandidates.find(
      (entry) => entry.id === data.featureCandidateId,
    );
    if (data.featureCandidateId && (!intelligence || !candidate)) {
      throw new Error(
        "The selected product recommendation is no longer available. Re-run workflow analysis.",
      );
    }

    // Queue the durable database record before allocating external resources.
    const demoCreate = {
      project_id: data.projectId,
      title: data.title,
      feature_prompt: data.featurePrompt,
      recording_locale: data.recordingLocale,
      status: "pending" as const,
      progress_pct: 5,
      current_step: candidate
        ? "Storyboard ready for review and scene capture."
        : "Queued for a real cloud-browser recording…",
      thumbnail_url: `/api/public/screenshot?url=${encodeURIComponent(project.base_url)}&width=1280`,
      ...(candidate && intelligence
        ? { product_intelligence_id: intelligence.id, feature_candidate_id: candidate.id }
        : {}),
    };
    let demo = await context.repository.createDemo(demoCreate);
    if (candidate) {
      const storyboard = createLaunchStoryboard({ productName: project.name, candidate });
      const storedStoryboard = await context.repository.createStoryboard({
        project_id: project.id,
        demo_id: demo.id,
        feature_candidate_id: candidate.id,
        storyboard,
      });
      for (const [sequence, scene] of storyboard.scenes.entries()) {
        const capture: DemoSceneCapture = {
          sceneId: scene.id,
          sequence,
          status: "planned",
          sourceStartSeconds: null,
          sourceDurationSeconds: null,
          retryCount: 0,
          actionLog: [],
          evidence: [],
          failureReason: null,
        };
        await context.repository.upsertDemoScene({
          project_id: project.id,
          demo_id: demo.id,
          storyboard_id: storedStoryboard.id,
          scene_key: scene.id,
          sequence,
          capture,
        });
      }
      demo = await context.repository.updateDemo(demo.id, { storyboard_id: storedStoryboard.id });
    }
    await appendDemoEvent(
      context,
      demo.id,
      "info",
      "DEMO_QUEUED",
      "Demo job created in the shared recording queue.",
    );

    return withDurableRecordingUrl(demo);
  });

export const captureStoryboardDemo = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const demo = await context.repository.getDemo(data.demoId);
    if (!demo) throw new Error("Demo not found.");
    if (!demo.storyboard_id) throw new Error("Create a product storyboard before scene capture.");
    if (["rendering", "ready"].includes(demo.status)) return withDurableRecordingUrl(demo);
    const claimed = await context.repository.claimDemoExecution(demo.id);
    if (!claimed) return withDurableRecordingUrl(demo);
    const [project, storyboard] = await Promise.all([
      context.repository.getProject(demo.project_id),
      context.repository.getStoryboard(demo.storyboard_id),
    ]);
    if (!project || !storyboard) throw new Error("Storyboard source data is unavailable.");
    const { credentials, loginUrl } = await loadCredentials(context, demo.project_id);
    const actionMap = storyboard.storyboard_json.scenes.flatMap((scene) =>
      scene.actions.map((action) => ({ scene, action })),
    );
    if (!actionMap.length) throw new Error("The storyboard has no browser actions to capture.");

    let recordingStartedAt = Date.now();
    let authenticatedAt = recordingStartedAt;
    try {
      const recordingPass = await executeRecordingPass({
        startUrl: credentials ? (loginUrl ?? credentials.loginUrl) : project.base_url,
        createSession: (startUrl) => createSteelSession(startUrl, demo.recording_locale),
        releaseSession: releaseSteelSession,
        publishLiveSession: async (session) => {
          recordingStartedAt = Date.now();
          authenticatedAt = recordingStartedAt;
          await context.repository.updateDemo(demo.id, {
            status: "recording",
            progress_pct: 58,
            current_step: "Recording verified storyboard scenes…",
            steel_session_id: session.id,
            live_view_url: session.liveViewUrl ?? session.debugUrl ?? null,
            session_viewer_url: session.sessionViewerUrl ?? null,
          });
          await appendDemoEvent(
            context,
            demo.id,
            "info",
            "SCENE_CAPTURE_STARTED",
            `${storyboard.storyboard_json.scenes.length} editorial scenes are capturing in a fresh Steel session.`,
          );
        },
        authenticate: credentials
          ? async (websocketUrl) => {
              const authenticated = await authenticateSite({
                websocketUrl,
                loginUrl: loginUrl ?? credentials.loginUrl,
                credentials,
                recordingLocale: demo.recording_locale,
              });
              await context.repository.updateDemo(demo.id, {
                source_viewport: detectSourceViewport(authenticated.browserMetrics, {
                  width: authenticated.browserMetrics.outerWidth,
                  height: authenticated.browserMetrics.outerHeight,
                }),
              });
              authenticatedAt = Date.now();
            }
          : undefined,
        executeScenes: async (websocketUrl, maxWallMs) =>
          runScenesOverCdp(
            websocketUrl,
            actionMap.map((entry) => storyboardActionToCdp(entry.action)),
            maxWallMs,
            demo.recording_locale,
          ),
      });
      const diagnostics = recordingPass.execution.diagnostics;
      let actionOffset = 0;
      let previousEndSeconds = Math.max(0, (authenticatedAt - recordingStartedAt) / 1_000);
      for (const [sequence, scene] of storyboard.storyboard_json.scenes.entries()) {
        const sceneDiagnostics = diagnostics.slice(
          actionOffset,
          actionOffset + scene.actions.length,
        );
        actionOffset += scene.actions.length;
        const successful = sceneDiagnostics.filter((entry) => entry.success);
        const first = successful[0];
        const last = successful.at(-1);
        const firstStartedAt = first?.startedAt;
        const sourceStartSeconds = firstStartedAt
          ? Math.max(0, (firstStartedAt - recordingStartedAt) / 1_000)
          : previousEndSeconds;
        const sourceDurationSeconds =
          firstStartedAt && last?.completedAt
            ? Math.min(
                scene.maxDurationSeconds,
                Math.max(2, (last.completedAt - firstStartedAt) / 1_000 + 1.2),
              )
            : Math.min(scene.maxDurationSeconds, 5);
        previousEndSeconds = sourceStartSeconds + sourceDurationSeconds;
        const status =
          scene.actions.length === 0 || successful.length === scene.actions.length
            ? ("captured" as const)
            : ("failed" as const);
        const capture: DemoSceneCapture = {
          sceneId: scene.id,
          sequence,
          status,
          sourceStartSeconds,
          sourceDurationSeconds,
          retryCount: 0,
          actionLog: scene.actions.map((action, index) => {
            const diagnostic = sceneDiagnostics[index];
            return {
              actionId: action.id,
              status: diagnostic?.success ? ("successful" as const) : ("failed" as const),
              startedAt: diagnostic?.startedAt,
              completedAt: diagnostic?.completedAt,
              cursor: diagnostic?.cursor,
              message: diagnostic?.message ?? "No action was executed for this scene.",
            };
          }),
          evidence: [],
          failureReason:
            status === "failed"
              ? (sceneDiagnostics.find((entry) => !entry.success)?.message ??
                "A scene action failed.")
              : null,
        };
        await context.repository.upsertDemoScene({
          project_id: project.id,
          demo_id: demo.id,
          storyboard_id: storyboard.id,
          scene_key: scene.id,
          sequence,
          capture,
        });
      }
      await context.repository.updateDemo(demo.id, {
        status: "rendering",
        progress_pct: 80,
        current_step: "Steel is finalizing the scene source recording…",
        steel_session_id: recordingPass.session.id,
        live_view_url: null,
        execution_started_at: null,
      });
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "SCENE_CAPTURE_COMPLETE",
        "Verified scenes are ready for media finalization and editorial composition.",
      );
      return withDurableRecordingUrl((await context.repository.getDemo(demo.id))!);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storyboard scene capture failed.";
      const failed = await context.repository.updateDemo(demo.id, {
        status: "failed",
        progress_pct: 0,
        current_step: "Storyboard scene capture failed.",
        error_code: "STORYBOARD_SCENE_CAPTURE_FAILED",
        error_message: message,
        execution_started_at: null,
      });
      await appendDemoEvent(context, demo.id, "error", "STORYBOARD_SCENE_CAPTURE_FAILED", message);
      return withDurableRecordingUrl(failed);
    }
  });

export const regenerateDemoStoryboard = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const demo = await context.repository.getDemo(data.demoId);
    if (!demo?.storyboard_id || !demo.product_intelligence_id || !demo.feature_candidate_id) {
      throw new Error("This demo has no regeneratable product storyboard.");
    }
    const reviews = await context.repository.listQualityReviews(demo.id);
    if (reviews.length >= 2) {
      throw new Error(
        "Storyboard revision limit reached. Review the flagged scene before trying again.",
      );
    }
    const [intelligence, existing] = await Promise.all([
      context.repository.getLatestProductIntelligence(demo.project_id),
      context.repository.getStoryboard(demo.storyboard_id),
    ]);
    const candidate = intelligence?.intelligence_json.featureCandidates.find(
      (entry) => entry.id === demo.feature_candidate_id,
    );
    if (!intelligence || !candidate || !existing)
      throw new Error("The source recommendation is no longer available.");
    const storyboard = createLaunchStoryboard({
      productName: intelligence.intelligence_json.productName,
      candidate,
      revision: existing.version + 1,
    });
    const stored = await context.repository.createStoryboard({
      project_id: demo.project_id,
      demo_id: demo.id,
      feature_candidate_id: candidate.id,
      storyboard,
    });
    await context.repository.updateDemo(demo.id, {
      storyboard_id: stored.id,
      status: "pending",
      current_step: "Storyboard revised from quality review feedback.",
      error_code: null,
      error_message: null,
    });
    for (const [sequence, scene] of storyboard.scenes.entries()) {
      await context.repository.upsertDemoScene({
        project_id: demo.project_id,
        demo_id: demo.id,
        storyboard_id: stored.id,
        scene_key: scene.id,
        sequence,
        capture: {
          sceneId: scene.id,
          sequence,
          status: "planned",
          sourceStartSeconds: null,
          sourceDurationSeconds: null,
          retryCount: 0,
          actionLog: [],
          evidence: [],
          failureReason: null,
        },
      });
    }
    await appendDemoEvent(
      context,
      demo.id,
      "info",
      "STORYBOARD_REVISED",
      `Storyboard revision ${storyboard.revision} created after quality review.`,
    );
    return stored;
  });

// Recon and planning use a disposable Steel session. The final artifact comes
// from a second fresh session that contains only login and the curated scenes.
export const runDemoScenes = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const demo = await context.repository.getDemo(data.demoId);
    if (!demo) throw new Error("Demo not found.");
    if (["rendering", "ready", "failed"].includes(demo.status)) {
      return withDurableRecordingUrl(demo);
    }

    const claimed = await context.repository.claimDemoExecution(demo.id);
    if (!claimed) return withDurableRecordingUrl(demo);

    if (demo.steel_session_id) {
      await releaseSteelSession(demo.steel_session_id).catch(() => undefined);
      await appendDemoEvent(
        context,
        demo.id,
        "warn",
        "STALE_SESSION_RELEASED",
        "A previous in-flight session was released before execution restarted.",
      );
    }

    let activeReconSessionId: string | null = null;
    let credentials: DecryptedCredentials = null;
    let runStage = "load-project";
    try {
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "RECON_STARTED",
        "Product recon started in the Steel browser.",
      );

      const project = await context.repository.getProject(demo.project_id);
      if (!project) throw new Error("Project not found.");

      runStage = "load-credentials";
      const loadedAccess = await loadCredentials(context, demo.project_id);
      credentials = loadedAccess.credentials;
      const loginUrl = loadedAccess.loginUrl;

      runStage = "create-recon-session";
      const session = await createSteelSession(project.base_url, demo.recording_locale);
      activeReconSessionId = session.id;
      const websocketUrl = session.websocketUrl ?? null;
      if (!websocketUrl) {
        throw Object.assign(new Error("The recon session has no browser connection."), {
          code: "MISSING_RECON_WEBSOCKET",
        });
      }

      runStage = "publish-recon-session";
      await context.repository.updateDemo(demo.id, {
        status: "scanning",
        progress_pct: 20,
        current_step: "Agent scouting the product in a disposable browser…",
        steel_session_id: session.id,
        live_view_url: session.liveViewUrl ?? session.debugUrl ?? null,
        session_viewer_url: session.sessionViewerUrl ?? null,
      });

      runStage = "run-recon";
      const recon: ReconResult = await reconSite({
        websocketUrl,
        baseUrl: project.base_url,
        loginUrl,
        credentials,
        maxPages: 3,
        recordingLocale: demo.recording_locale,
      });
      const currentSiteMap = recon.pages.length
        ? outlineToMarkdown(project.name, project.base_url, recon)
        : project.site_map_md;
      if (recon.pages.length) {
        runStage = "persist-recon-map";
        await context.repository.updateProject(project.id, {
          site_map_md: currentSiteMap,
          site_map_source: "manual",
          site_map_updated_at: new Date().toISOString(),
        });
      }

      runStage = "release-recon-session";
      await releaseSteelSession(session.id);
      activeReconSessionId = null;
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "RECON_SESSION_RELEASED",
        "Disposable recon session released before final recording.",
      );

      runStage = "publish-planning-status";
      await context.repository.updateDemo(demo.id, {
        status: "planning",
        progress_pct: 40,
        current_step: "AI writing a verifiable shot list…",
        steel_session_id: null,
        live_view_url: null,
        session_viewer_url: null,
      });
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "PLANNING_STARTED",
        "Scene planning started from real recon data.",
      );

      runStage = "plan-scenes";
      const plan = await planDemoScenes({
        productName: project.name,
        baseUrl: project.base_url,
        featurePrompt: demo.feature_prompt,
        siteMapMd: currentSiteMap,
        recon,
        loginUrl,
      });
      if (!plan.scenes.length) {
        throw Object.assign(new Error("Scene planner returned no executable actions."), {
          code: "EMPTY_SCENE_PLAN",
        });
      }

      const sceneScript = plan.scenes.map((scene, index) => ({
        seconds: `${index * 5}-${(index + 1) * 5}`,
        shot: scene.narration || `Action: ${scene.action.type}`,
        action: publicSceneAction(scene.action),
      }));
      const recordingCredentials = credentials;
      const recordingStartUrl = recordingCredentials
        ? (loginUrl ?? recordingCredentials.loginUrl)
        : project.base_url;
      runStage = "record-scenes";
      const recordingPass = await executeRecordingPass({
        startUrl: recordingStartUrl,
        createSession: (startUrl) => createSteelSession(startUrl, demo.recording_locale),
        releaseSession: releaseSteelSession,
        publishLiveSession: async (recordingSession) => {
          await context.repository.updateDemo(demo.id, {
            status: "recording",
            progress_pct: 55,
            current_step: "Recording login and the curated product walkthrough…",
            scene_script: sceneScript,
            steel_session_id: recordingSession.id,
            live_view_url: recordingSession.liveViewUrl ?? recordingSession.debugUrl ?? null,
            session_viewer_url: recordingSession.sessionViewerUrl ?? null,
          });
          await appendDemoEvent(
            context,
            demo.id,
            "info",
            "RECORDING_STARTED",
            `${plan.scenes.length} verified browser actions are recording from a fresh session (${plan.source} plan).`,
          );
        },
        authenticate: recordingCredentials
          ? async (recordingWebsocketUrl) => {
              const authenticated = await authenticateSite({
                websocketUrl: recordingWebsocketUrl,
                loginUrl: recordingStartUrl,
                credentials: recordingCredentials,
                recordingLocale: demo.recording_locale,
              });
              const detectedViewport = detectSourceViewport(authenticated.browserMetrics, {
                width: authenticated.browserMetrics.outerWidth,
                height: authenticated.browserMetrics.outerHeight,
              });
              await context.repository.updateDemo(demo.id, {
                source_viewport: detectedViewport,
              });
              await appendDemoEvent(
                context,
                demo.id,
                "info",
                "RECORDING_LOGIN_VERIFIED",
                `${demo.recording_locale} application UI verified before the walkthrough; locale persistence: ${authenticated.localePersistence.join(", ") || "application selector"}.`,
              );
            }
          : undefined,
        executeScenes: async (recordingWebsocketUrl, maxWallMs) => {
          const result = await runScenesOverCdp(
            recordingWebsocketUrl,
            plan.scenes.map((scene) => scene.action),
            maxWallMs,
            demo.recording_locale,
          );
          if (result.browserMetrics) {
            await context.repository.updateDemo(demo.id, {
              source_viewport: detectSourceViewport(result.browserMetrics, {
                width: result.browserMetrics.outerWidth,
                height: result.browserMetrics.outerHeight,
              }),
            });
          }
          for (const diagnostic of result.diagnostics) {
            await appendDemoEvent(
              context,
              demo.id,
              diagnostic.success ? "info" : "error",
              diagnostic.code,
              `Action ${diagnostic.index + 1} (${diagnostic.type}): ${diagnostic.message}`,
            );
          }
          return result;
        },
      });
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "STEEL_SESSION_RELEASED",
        "Fresh recording session released after the verified walkthrough.",
      );

      runStage = "publish-rendering-status";
      const updated = await context.repository.updateDemo(demo.id, {
        status: "rendering",
        progress_pct: 80,
        current_step: "Waiting for Steel to finalize the video stream…",
        steel_session_id: recordingPass.session.id,
        session_viewer_url:
          recordingPass.releasedSession.sessionViewerUrl ??
          recordingPass.session.sessionViewerUrl ??
          null,
        live_view_url: null,
        execution_started_at: null,
        error_code: null,
        error_message: null,
      });
      return withDurableRecordingUrl(updated);
    } catch (runError) {
      console.error("[WiseDemo] recording execution failed", {
        demoId: demo.id,
        stage: runStage,
        name: runError instanceof Error ? runError.name : "UnknownError",
        message: runError instanceof Error ? runError.message : "Recording execution failed.",
        causeCode:
          runError instanceof Error &&
          runError.cause &&
          typeof runError.cause === "object" &&
          "code" in runError.cause
            ? String(runError.cause.code)
            : null,
      });
      if (activeReconSessionId) {
        await releaseSteelSession(activeReconSessionId).catch(() => undefined);
      }
      const code =
        runError && typeof runError === "object" && "code" in runError
          ? String(runError.code)
          : credentials
            ? "LOGIN_OR_RECON_FAILED"
            : "RECORDING_EXECUTION_FAILED";
      const message = runError instanceof Error ? runError.message : "Recording execution failed.";
      const failed = await context.repository.updateDemo(demo.id, {
        status: "failed",
        progress_pct: 0,
        current_step: "Recording failed before media finalization.",
        live_view_url: null,
        execution_started_at: null,
        error_code: code,
        error_message: message,
      });
      await appendDemoEvent(context, demo.id, "error", code, message);
      return withDurableRecordingUrl(failed);
    }
  });

// Poll Steel's authenticated HLS recording, validate the complete fragmented
// MP4, upload it under a deterministic file ID, and publish only a stable app URL.
export const finalizeDemoRecording = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const demo = await context.repository.getDemo(data.demoId);
    if (!demo) throw new Error("Demo not found.");
    if (demo.status === "ready" && demo.recording_file_id) {
      return withDurableRecordingUrl(demo);
    }
    if (demo.status !== "rendering") return withDurableRecordingUrl(demo);
    if (!demo.steel_session_id) {
      const message = "The recording cannot be finalized because its Steel session is missing.";
      const failed = await context.repository.updateDemo(demo.id, {
        status: "failed",
        progress_pct: 0,
        current_step: message,
        error_code: "MISSING_STEEL_SESSION",
        error_message: message,
        finalization_started_at: null,
      });
      await appendDemoEvent(context, demo.id, "error", "MISSING_STEEL_SESSION", message);
      return withDurableRecordingUrl(failed);
    }

    const claimed = await context.repository.claimDemoFinalization(demo.id);
    if (!claimed) return withDurableRecordingUrl(demo);
    const attemptNumber = claimed.finalization_attempts;

    await appendDemoEvent(
      context,
      demo.id,
      "info",
      "FINALIZATION_ATTEMPT",
      `Recording finalization attempt ${attemptNumber} started.`,
    );

    try {
      const recording = await fetchSessionMp4(demo.steel_session_id, {
        attempts: 4,
        initialWaitMs: 1_000,
        maxWaitMs: 4_000,
      });

      if (!recording) {
        const pending = await context.repository.updateDemo(demo.id, {
          current_step: "Steel is still finalizing the recording; WiseDemo will retry…",
          finalization_started_at: null,
          error_code: null,
          error_message: null,
        });
        await appendDemoEvent(
          context,
          demo.id,
          "info",
          "STEEL_RECORDING_NOT_READY",
          "Steel has not published a finalized HLS playlist yet; retry remains safe.",
        );
        return withDurableRecordingUrl(pending);
      }

      assertProfessionalRecordingDuration(recording.durationSeconds);

      const videoDimensions = readMp4Dimensions(recording.bytes);
      if (!videoDimensions) {
        throw Object.assign(new Error("The finalized MP4 dimensions could not be verified."), {
          code: "MP4_DIMENSIONS_UNAVAILABLE",
        });
      }
      const sourceViewport = demo.source_viewport
        ? rescaleSourceViewport(demo.source_viewport, videoDimensions)
        : {
            version: 1 as const,
            detection: "full-frame" as const,
            sourceViewport: {
              videoWidth: videoDimensions.width,
              videoHeight: videoDimensions.height,
              contentX: 0,
              contentY: 0,
              contentWidth: videoDimensions.width,
              contentHeight: videoDimensions.height,
            },
          };

      const { appwriteRecordingStorage } = await import("@/integrations/appwrite/storage.server");
      const fileId = recordingFileId(demo.id);
      await storeRecordingArtifact({
        storage: appwriteRecordingStorage(),
        fileId,
        bytes: recording.bytes,
      });

      const url = stableRecordingUrl(demo.id);
      const completedAt = new Date().toISOString();
      const updated = await context.repository.updateDemo(demo.id, {
        status: "ready",
        progress_pct: 100,
        current_step: "Demo ready — playable recording stored successfully.",
        mp4_url: url,
        recording_url: url,
        recording_file_id: fileId,
        recording_completed_at: completedAt,
        duration_seconds: recording.durationSeconds,
        source_viewport: sourceViewport,
        finalization_started_at: null,
        error_code: null,
        error_message: null,
      });
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "RECORDING_READY",
        "Validated MP4 uploaded to Appwrite and its server-proxied playback verified.",
      );
      return withDurableRecordingUrl(updated);
    } catch (finalizeError) {
      const structured = finalizeError as {
        code?: unknown;
        retryable?: unknown;
        message?: unknown;
      };
      const code =
        finalizeError instanceof SteelRecordingError
          ? finalizeError.code
          : typeof structured.code === "string"
            ? structured.code
            : "RECORDING_FINALIZATION_FAILED";
      const retryable =
        finalizeError instanceof SteelRecordingError
          ? finalizeError.retryable
          : structured.retryable === true;
      const message =
        finalizeError instanceof Error
          ? finalizeError.message
          : "Recording finalization failed unexpectedly.";
      const exhausted = retryable && attemptNumber >= 6;
      const status = retryable && !exhausted ? "rendering" : "failed";
      const updated = await context.repository.updateDemo(demo.id, {
        status,
        progress_pct: status === "rendering" ? 80 : 0,
        current_step:
          status === "rendering"
            ? "Video finalization hit a temporary error; WiseDemo will retry."
            : "Video finalization failed and needs attention.",
        finalization_started_at: null,
        error_code: exhausted ? `${code}_RETRY_LIMIT` : code,
        error_message: message,
      });
      await appendDemoEvent(
        context,
        demo.id,
        status === "rendering" ? "warn" : "error",
        exhausted ? `${code}_RETRY_LIMIT` : code,
        message,
      );
      return withDurableRecordingUrl(updated);
    }
  });

export const retryDemoFinalization = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const demo = await context.repository.getDemo(data.demoId);
    if (!demo) throw new Error("Demo not found.");
    if (demo.status === "ready" && demo.recording_file_id) {
      return withDurableRecordingUrl(demo);
    }
    const retryableCode = Boolean(
      demo.error_code &&
      /(FINAL|HLS|MP4|SEGMENT|UPLOAD|APPWRITE|PLAYBACK|RECORDING_UNAVAILABLE)/i.test(
        demo.error_code,
      ),
    );
    if (demo.status !== "failed" || !demo.steel_session_id || !retryableCode) {
      throw new Error("This demo does not have a retryable recording finalization.");
    }
    const rendering = await context.repository.updateDemo(demo.id, {
      status: "rendering",
      progress_pct: 80,
      current_step: "Retrying video finalization…",
      finalization_attempts: 0,
      finalization_started_at: null,
      error_code: null,
      error_message: null,
    });
    await appendDemoEvent(
      context,
      demo.id,
      "info",
      "FINALIZATION_RETRY_REQUESTED",
      "A manual finalization retry was requested.",
    );
    return withDurableRecordingUrl(rendering);
  });

export const getDemoStatus = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const demo = await context.repository.getDemo(data.demoId);
    if (!demo) throw new Error("Demo not found.");
    return withDurableRecordingUrl(demo);
  });
