import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/integrations/supabase/types";

import {
  decryptProjectCredentials,
  encryptProjectCredentials,
  isSameOriginUrl,
  maskCredentialIdentifier,
} from "./credential-crypto.server";
import { normalizePublicUrl, scanWebsite } from "./studio-scanner.server";
import {
  recordingObjectPath,
  storeRecordingArtifact,
  type RecordingStorageClient,
} from "./recording-storage.server";
import {
  createSteelSession,
  fetchSessionMp4,
  getSteelSession,
  releaseSteelSession,
  runScenesOverCdp,
  SteelRecordingError,
  type CdpAction,
  type DecryptedCredentials,
} from "./steel-recorder.server";
import { outlineToMarkdown, reconSite, type ReconResult } from "./steel-recon.server";
import { planDemoScenes } from "./scene-planner.server";
import { stableRecordingUrl } from "./demo-state";

type SupabaseCtx = { supabase: SupabaseClient<Database>; userId: string };

// Authentication was removed for the experimental stage: every visitor works in
// one shared workspace, and all database access goes through the service-role
// client inside server functions (the tables stay unreachable from the browser).
export const SHARED_WORKSPACE_OWNER = "00000000-0000-0000-0000-000000000001";

async function workspaceContext(): Promise<SupabaseCtx> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { supabase: supabaseAdmin, userId: SHARED_WORKSPACE_OWNER };
}

async function loadCredentials(
  context: SupabaseCtx,
  projectId: string,
  userId: string,
): Promise<{ credentials: DecryptedCredentials; loginUrl: string | null }> {
  const { data: row } = await context.supabase
    .from("project_credentials")
    .select("kind, login_url, ciphertext")
    .eq("project_id", projectId)
    .eq("owner_id", userId)
    .maybeSingle();

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

    const { data: project, error } = await context.supabase
      .from("projects")
      .insert({
        owner_id: context.userId,
        name: data.name,
        base_url: baseUrl,
        description: scan.description,
        site_map_md: scan.siteMapMd,
        site_map_source: "manual",
        site_map_updated_at: new Date().toISOString(),
      })
      .select("id, name, base_url, description, site_map_md, site_map_updated_at, created_at")
      .single();

    if (error) throw new Error(error.message);
    return project as {
      id: string;
      name: string;
      base_url: string;
      description: string | null;
      site_map_md: string | null;
      site_map_updated_at: string | null;
      created_at: string;
    };
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
  recording_object_path: string | null;
  recording_completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

const DEMO_SELECT =
  "id, title, feature_prompt, scene_script, status, progress_pct, current_step, mp4_url, thumbnail_url, duration_seconds, steel_session_id, live_view_url, session_viewer_url, recording_url, recording_object_path, recording_completed_at, error_code, error_message, created_at";

function withDurableRecordingUrl<T extends { id: string; status: string }>(
  demo: T,
): T & { mp4_url?: string; recording_url?: string } {
  const objectPath = (demo as T & { recording_object_path?: string | null }).recording_object_path;
  if (demo.status !== "ready" || !objectPath) return demo;
  const url = stableRecordingUrl(demo.id);
  return { ...demo, mp4_url: url, recording_url: url };
}

async function appendDemoEvent(
  context: SupabaseCtx,
  demoId: string,
  level: "info" | "warn" | "error",
  step: string,
  message: string,
): Promise<void> {
  const safeMessage = message.slice(0, 1_000);
  const { error } = await context.supabase.from("demo_events").insert({
    demo_id: demoId,
    owner_id: context.userId,
    level,
    step,
    message: safeMessage,
  });
  if (error) {
    console.error("[WiseDemo] demo event insert failed", {
      demoId,
      step,
      code: error.code,
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
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, name, base_url, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectListItem[];
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
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select(
        "id, name, base_url, description, site_map_md, site_map_source, site_map_updated_at, created_at",
      )
      .eq("id", data.projectId)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error("Project not found.");

    const { data: demos, error: demosError } = await context.supabase
      .from("demos")
      .select(DEMO_SELECT)
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });

    if (demosError) throw new Error(demosError.message);

    let credentials: {
      kind: "none" | "cookie" | "password";
      login_url: string | null;
      username_hint: string | null;
      updated_at: string | null;
    } | null = null;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: credentialMeta } = await supabaseAdmin
        .from("project_credentials")
        .select("kind, login_url, username_hint, updated_at")
        .eq("project_id", data.projectId)
        .eq("owner_id", context.userId)
        .maybeSingle();
      credentials = credentialMeta
        ? {
            ...credentialMeta,
            username_hint: maskCredentialIdentifier(credentialMeta.username_hint),
          }
        : null;
    } catch {
      credentials = null;
    }

    return {
      project: project as ProjectRecord,
      demos: (demos ?? []).map((demo: DemoRecord) => withDurableRecordingUrl(demo)),
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
    const { data: existing, error: existingError } = await context.supabase
      .from("projects")
      .select("id, name, base_url")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Project not found.");

    const { credentials, loginUrl } = await loadCredentials(
      context,
      data.projectId,
      context.userId,
    );

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

    const { data: project, error } = await context.supabase
      .from("projects")
      .update({
        description,
        site_map_md: siteMapMd,
        site_map_source: "manual",
        site_map_updated_at: new Date().toISOString(),
      })
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .select(
        "id, name, base_url, description, site_map_md, site_map_source, site_map_updated_at, created_at",
      )
      .single();

    if (error) throw new Error(error.message);
    return project;
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
    const { data: project, error } = await context.supabase
      .from("projects")
      .update({
        description: data.description && data.description.length > 0 ? data.description : null,
        site_map_md: data.siteMapMd,
        site_map_source: "manual",
        site_map_updated_at: new Date().toISOString(),
      })
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .select(
        "id, name, base_url, description, site_map_md, site_map_source, site_map_updated_at, created_at",
      )
      .single();

    if (error) throw new Error(error.message);
    return project;
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
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id, base_url")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error("Project not found.");

    if (data.kind === "none") {
      const { error } = await context.supabase
        .from("project_credentials")
        .delete()
        .eq("project_id", data.projectId)
        .eq("owner_id", context.userId);
      if (error) throw new Error(error.message);
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

    const { error } = await context.supabase.from("project_credentials").upsert(
      {
        project_id: data.projectId,
        owner_id: context.userId,
        kind: "password",
        login_url: loginUrl.toString(),
        username_hint: data.username,
        ciphertext,
      },
      { onConflict: "project_id" },
    );

    if (error) throw new Error(error.message);

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
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const projectResult = await context.supabase
      .from("projects")
      .select("id, name, base_url, description, site_map_md")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    let project = projectResult.data;
    const projectError = projectResult.error;

    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error("Project not found.");

    if (!project.site_map_md) {
      const scan = await scanWebsite(project.base_url, project.name);
      const { data: scannedProject, error: scanUpdateError } = await context.supabase
        .from("projects")
        .update({
          description: scan.description,
          site_map_md: scan.siteMapMd,
          site_map_source: "manual",
          site_map_updated_at: new Date().toISOString(),
        })
        .eq("id", data.projectId)
        .eq("owner_id", context.userId)
        .select("id, name, base_url, description, site_map_md")
        .single();

      if (scanUpdateError) throw new Error(scanUpdateError.message);
      project = scannedProject;
    }

    // Queue the durable database record before allocating external resources.
    const { data: demo, error: insertError } = await context.supabase
      .from("demos")
      .insert({
        project_id: data.projectId,
        owner_id: context.userId,
        title: data.title,
        feature_prompt: data.featurePrompt,
        status: "pending",
        progress_pct: 5,
        current_step: "Queued for a real cloud-browser recording\u2026",
        thumbnail_url: `/api/public/screenshot?url=${encodeURIComponent(project.base_url)}&width=1280`,
      })
      .select(DEMO_SELECT)
      .single();

    if (insertError) throw new Error(insertError.message);
    await appendDemoEvent(
      context,
      demo.id,
      "info",
      "DEMO_QUEUED",
      "Demo job created in the shared recording queue.",
    );

    // Create the Steel session synchronously so the studio can expose its live
    // viewer while the resumable execution request begins.
    try {
      const session = await createSteelSession(project.base_url);

      const { error: sessionUpdateError } = await context.supabase
        .from("demos")
        .update({
          status: "scanning",
          progress_pct: 15,
          current_step: "Real browser session live \u2014 scouting the product\u2026",
          steel_session_id: session.id,
          live_view_url: session.liveViewUrl ?? session.debugUrl ?? null,
          session_viewer_url: session.sessionViewerUrl ?? null,
        })
        .eq("id", demo.id);

      if (sessionUpdateError) {
        await releaseSteelSession(session.id).catch(() => undefined);
        throw new Error(sessionUpdateError.message);
      }
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "STEEL_SESSION_CREATED",
        "Steel browser session created with recording enabled.",
      );

      return withDurableRecordingUrl({
        ...demo,
        status: "scanning" as const,
        progress_pct: 15,
        current_step: "Real browser session live \u2014 scouting the product\u2026",
        steel_session_id: session.id,
        live_view_url: session.liveViewUrl ?? session.debugUrl ?? null,
        session_viewer_url: session.sessionViewerUrl ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start Steel session.";
      await context.supabase
        .from("demos")
        .update({
          status: "failed",
          progress_pct: 0,
          current_step: "Could not start the cloud browser.",
          error_code: "STEEL_SESSION_CREATE_FAILED",
          error_message: message,
        })
        .eq("id", demo.id);
      await appendDemoEvent(
        context,
        demo.id,
        "error",
        "STEEL_SESSION_CREATE_FAILED",
        "Steel browser session could not be created.",
      );
      throw new Error(message);
    }
  });

// Recon the product with the live browser, let the AI write the shot list,
// drive it for real, then release the session so Steel finalizes the video.
export const runDemoScenes = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const { data: demo, error } = await context.supabase
      .from("demos")
      .select(
        "id, status, steel_session_id, session_viewer_url, feature_prompt, project_id, execution_attempts, execution_started_at, recording_object_path, mp4_url, recording_url",
      )
      .eq("id", data.demoId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!demo) throw new Error("Demo not found.");
    if (["rendering", "ready", "failed"].includes(demo.status)) {
      return withDurableRecordingUrl(demo);
    }
    if (!demo.steel_session_id) {
      const message = "No active Steel session exists for this demo.";
      await context.supabase
        .from("demos")
        .update({
          status: "failed",
          progress_pct: 0,
          current_step: message,
          error_code: "MISSING_STEEL_SESSION",
          error_message: message,
        })
        .eq("id", demo.id);
      await appendDemoEvent(context, demo.id, "error", "MISSING_STEEL_SESSION", message);
      throw new Error(message);
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - 2 * 60_000).toISOString();
    const { data: claimed, error: claimError } = await context.supabase
      .from("demos")
      .update({
        status: "scanning",
        progress_pct: 20,
        current_step: "Agent scouting the product\u2026",
        execution_started_at: now.toISOString(),
        execution_attempts: (demo.execution_attempts ?? 0) + 1,
        error_code: null,
        error_message: null,
      })
      .eq("id", demo.id)
      .in("status", ["pending", "starting", "scanning", "planning", "recording"])
      .or(`execution_started_at.is.null,execution_started_at.lt.${staleBefore}`)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) return withDurableRecordingUrl(demo);

    await appendDemoEvent(
      context,
      demo.id,
      "info",
      "RECON_STARTED",
      "Product recon started in the Steel browser.",
    );

    const { data: project } = await context.supabase
      .from("projects")
      .select("id, name, base_url, site_map_md")
      .eq("id", demo.project_id)
      .maybeSingle();
    if (!project) throw new Error("Project not found.");

    const { credentials, loginUrl } = await loadCredentials(
      context,
      demo.project_id,
      context.userId,
    );
    let releaseAttempted = false;
    try {
      const session = await getSteelSession(demo.steel_session_id);
      const websocketUrl =
        session && typeof session.websocketUrl === "string" ? session.websocketUrl : null;
      if (!websocketUrl) {
        throw Object.assign(new Error("Cloud browser session is no longer available."), {
          code: "MISSING_STEEL_SESSION",
        });
      }

      const recon: ReconResult = await reconSite({
        websocketUrl,
        baseUrl: project.base_url,
        loginUrl,
        credentials,
        maxPages: 3,
      });
      if (recon.pages.length) {
        await context.supabase
          .from("projects")
          .update({
            site_map_md: outlineToMarkdown(project.name, project.base_url, recon),
            site_map_source: "manual",
            site_map_updated_at: new Date().toISOString(),
          })
          .eq("id", project.id)
          .eq("owner_id", context.userId);
      }

      await context.supabase
        .from("demos")
        .update({
          status: "planning",
          progress_pct: 40,
          current_step: "AI writing a verifiable shot list\u2026",
        })
        .eq("id", demo.id);
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "PLANNING_STARTED",
        "Scene planning started from real recon data.",
      );

      const plan = await planDemoScenes({
        productName: project.name,
        baseUrl: project.base_url,
        featurePrompt: demo.feature_prompt,
        siteMapMd: project.site_map_md,
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
      await context.supabase
        .from("demos")
        .update({
          status: "recording",
          progress_pct: 55,
          current_step: "Recording the real product walkthrough\u2026",
          scene_script: sceneScript,
        })
        .eq("id", demo.id);
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "RECORDING_STARTED",
        `${plan.scenes.length} planned browser actions are ready to execute.`,
      );

      const result = await runScenesOverCdp(
        websocketUrl,
        plan.scenes.map((scene) => scene.action),
        90_000,
      );
      for (const diagnostic of result.diagnostics) {
        await appendDemoEvent(
          context,
          demo.id,
          diagnostic.success ? "info" : "error",
          diagnostic.code,
          `Action ${diagnostic.index + 1} (${diagnostic.type}): ${diagnostic.message}`,
        );
      }
      if (!result.completed) {
        throw Object.assign(
          new Error(result.error ?? "Not every planned browser action completed."),
          { code: "CDP_ACTION_FAILED" },
        );
      }

      releaseAttempted = true;
      const released = await releaseSteelSession(demo.steel_session_id);
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "STEEL_SESSION_RELEASED",
        "Steel browser session released; recording finalization can begin.",
      );

      const { data: updated, error: updateError } = await context.supabase
        .from("demos")
        .update({
          status: "rendering",
          progress_pct: 80,
          current_step: "Waiting for Steel to finalize the video stream\u2026",
          session_viewer_url: released.sessionViewerUrl ?? demo.session_viewer_url ?? null,
          live_view_url: null,
          execution_started_at: null,
          error_code: null,
          error_message: null,
        })
        .eq("id", demo.id)
        .select(DEMO_SELECT)
        .single();
      if (updateError) throw new Error(updateError.message);
      return withDurableRecordingUrl(updated);
    } catch (runError) {
      if (!releaseAttempted) {
        releaseAttempted = true;
        await releaseSteelSession(demo.steel_session_id).catch(() => undefined);
      }
      const code =
        runError && typeof runError === "object" && "code" in runError
          ? String(runError.code)
          : credentials
            ? "LOGIN_OR_RECON_FAILED"
            : "RECORDING_EXECUTION_FAILED";
      const message = runError instanceof Error ? runError.message : "Recording execution failed.";
      const { data: failed, error: failedError } = await context.supabase
        .from("demos")
        .update({
          status: "failed",
          progress_pct: 0,
          current_step: "Recording failed before media finalization.",
          live_view_url: null,
          execution_started_at: null,
          error_code: code,
          error_message: message,
        })
        .eq("id", demo.id)
        .select(DEMO_SELECT)
        .single();
      if (failedError) throw new Error(failedError.message);
      await appendDemoEvent(context, demo.id, "error", code, message);
      return withDurableRecordingUrl(failed);
    }
  });

// Poll Steel's authenticated HLS recording, validate the complete fragmented
// MP4, upload it once at a deterministic path, and publish only a stable app URL.
export const finalizeDemoRecording = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const { data: demo, error } = await context.supabase
      .from("demos")
      .select(
        "id, status, steel_session_id, recording_object_path, finalization_attempts, finalization_started_at, mp4_url, recording_url",
      )
      .eq("id", data.demoId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!demo) throw new Error("Demo not found.");
    if (demo.status === "ready" && demo.recording_object_path) {
      return withDurableRecordingUrl(demo);
    }
    if (demo.status !== "rendering") return withDurableRecordingUrl(demo);
    if (!demo.steel_session_id) {
      const message = "The recording cannot be finalized because its Steel session is missing.";
      const { data: failed, error: failedError } = await context.supabase
        .from("demos")
        .update({
          status: "failed",
          progress_pct: 0,
          current_step: message,
          error_code: "MISSING_STEEL_SESSION",
          error_message: message,
          finalization_started_at: null,
        })
        .eq("id", demo.id)
        .select(DEMO_SELECT)
        .single();
      if (failedError) throw new Error(failedError.message);
      await appendDemoEvent(context, demo.id, "error", "MISSING_STEEL_SESSION", message);
      return withDurableRecordingUrl(failed);
    }

    const now = new Date();
    const attemptNumber = (demo.finalization_attempts ?? 0) + 1;
    const staleBefore = new Date(now.getTime() - 90_000).toISOString();
    const { data: claimed, error: claimError } = await context.supabase
      .from("demos")
      .update({
        finalization_started_at: now.toISOString(),
        finalization_attempts: attemptNumber,
        current_step: "Checking Steel for a finalized recording\u2026",
        error_code: null,
        error_message: null,
      })
      .eq("id", demo.id)
      .eq("status", "rendering")
      .or(`finalization_started_at.is.null,finalization_started_at.lt.${staleBefore}`)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) return withDurableRecordingUrl(demo);

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
        const { data: pending, error: pendingError } = await context.supabase
          .from("demos")
          .update({
            current_step: "Steel is still finalizing the recording; WiseDemo will retry\u2026",
            finalization_started_at: null,
            error_code: null,
            error_message: null,
          })
          .eq("id", demo.id)
          .eq("status", "rendering")
          .select(DEMO_SELECT)
          .single();
        if (pendingError) throw new Error(pendingError.message);
        await appendDemoEvent(
          context,
          demo.id,
          "info",
          "STEEL_RECORDING_NOT_READY",
          "Steel has not published a finalized HLS playlist yet; retry remains safe.",
        );
        return withDurableRecordingUrl(pending);
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const path = recordingObjectPath(context.userId, demo.id);
      await storeRecordingArtifact({
        storage: supabaseAdmin.storage as unknown as RecordingStorageClient,
        path,
        bytes: recording.bytes,
      });

      const url = stableRecordingUrl(demo.id);
      const completedAt = new Date().toISOString();
      const { data: updated, error: updateError } = await context.supabase
        .from("demos")
        .update({
          status: "ready",
          progress_pct: 100,
          current_step: "Demo ready \u2014 playable recording stored successfully.",
          mp4_url: url,
          recording_url: url,
          recording_object_path: path,
          recording_completed_at: completedAt,
          duration_seconds: recording.durationSeconds,
          finalization_started_at: null,
          error_code: null,
          error_message: null,
        })
        .eq("id", demo.id)
        .eq("status", "rendering")
        .select(DEMO_SELECT)
        .single();
      if (updateError) throw new Error(updateError.message);
      await appendDemoEvent(
        context,
        demo.id,
        "info",
        "RECORDING_READY",
        "Validated MP4 uploaded and its signed playback URL verified.",
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
      const { data: updated, error: failureUpdateError } = await context.supabase
        .from("demos")
        .update({
          status,
          progress_pct: status === "rendering" ? 80 : 0,
          current_step:
            status === "rendering"
              ? "Video finalization hit a temporary error; WiseDemo will retry."
              : "Video finalization failed and needs attention.",
          finalization_started_at: null,
          error_code: exhausted ? `${code}_RETRY_LIMIT` : code,
          error_message: message,
        })
        .eq("id", demo.id)
        .select(DEMO_SELECT)
        .single();
      if (failureUpdateError) throw new Error(failureUpdateError.message);
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
    const { data: demo, error } = await context.supabase
      .from("demos")
      .select("id, status, steel_session_id, recording_object_path, error_code")
      .eq("id", data.demoId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!demo) throw new Error("Demo not found.");
    if (demo.status === "ready" && demo.recording_object_path) {
      return withDurableRecordingUrl(demo);
    }
    const retryableCode = Boolean(
      demo.error_code &&
      /(FINAL|HLS|MP4|SEGMENT|UPLOAD|SIGNED_URL|PLAYBACK|RECORDING_UNAVAILABLE)/i.test(
        demo.error_code,
      ),
    );
    if (demo.status !== "failed" || !demo.steel_session_id || !retryableCode) {
      throw new Error("This demo does not have a retryable recording finalization.");
    }
    const { data: rendering, error: updateError } = await context.supabase
      .from("demos")
      .update({
        status: "rendering",
        progress_pct: 80,
        current_step: "Retrying video finalization\u2026",
        finalization_attempts: 0,
        finalization_started_at: null,
        error_code: null,
        error_message: null,
      })
      .eq("id", demo.id)
      .select(DEMO_SELECT)
      .single();
    if (updateError) throw new Error(updateError.message);
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
    const { data: demo, error } = await context.supabase
      .from("demos")
      .select(DEMO_SELECT)
      .eq("id", data.demoId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!demo) throw new Error("Demo not found.");
    return withDurableRecordingUrl(demo);
  });
