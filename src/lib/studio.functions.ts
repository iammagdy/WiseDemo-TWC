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

type WorkspaceContext = { repository: WiseDemoRepository };

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
    };
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

    // Queue the durable database record before allocating external resources.
    const demo = await context.repository.createDemo({
      project_id: data.projectId,
      title: data.title,
      feature_prompt: data.featurePrompt,
      recording_locale: data.recordingLocale,
      status: "pending",
      progress_pct: 5,
      current_step: "Queued for a real cloud-browser recording…",
      thumbnail_url: `/api/public/screenshot?url=${encodeURIComponent(project.base_url)}&width=1280`,
    });
    await appendDemoEvent(
      context,
      demo.id,
      "info",
      "DEMO_QUEUED",
      "Demo job created in the shared recording queue.",
    );

    return withDurableRecordingUrl(demo);
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
