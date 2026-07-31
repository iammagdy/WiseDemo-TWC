import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";

import { normalizePublicUrl, scanWebsite } from "./studio-scanner.server";
import {
  createSteelSession,
  fetchSessionMp4,
  releaseSteelSession,
  runScenesOverCdp,
  type DecryptedCredentials,
} from "./steel-recorder.server";
import { outlineToMarkdown, reconSite, type ReconResult } from "./steel-recon.server";
import { planDemoScenes } from "./scene-planner.server";

function deriveCredsKey(): Buffer {
  const keySecret = process.env.DEMOFORGE_CREDS_KEY;
  if (!keySecret || keySecret.length < 32) {
    throw new Error("Credential encryption is not configured yet.");
  }
  return /^[\da-f]{64}$/i.test(keySecret)
    ? Buffer.from(keySecret, "hex")
    : createHash("sha256").update(keySecret, "utf8").digest();
}

function decryptCredentials(ciphertext: string): DecryptedCredentials {
  try {
    const [ivB64, tagB64, dataB64] = ciphertext.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const key = deriveCredsKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as DecryptedCredentials;
    return parsed;
  } catch {
    return null;
  }
}

type SupabaseCtx = { supabase: { from: (table: string) => any }; userId: string };

// Authentication was removed for the experimental stage: every visitor works in
// one shared workspace, and all database access goes through the service-role
// client inside server functions (the tables stay unreachable from the browser).
export const SHARED_WORKSPACE_OWNER = "00000000-0000-0000-0000-000000000001";

async function workspaceContext(): Promise<SupabaseCtx> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { supabase: supabaseAdmin as unknown as SupabaseCtx["supabase"], userId: SHARED_WORKSPACE_OWNER };
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
    row?.kind === "password" && row.ciphertext ? decryptCredentials(row.ciphertext) : null;
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
  error_message: string | null;
  created_at: string;
};

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
      .select("id, name, base_url, description, site_map_md, site_map_source, site_map_updated_at, created_at")
      .eq("id", data.projectId)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error("Project not found.");

    const { data: demos, error: demosError } = await context.supabase
      .from("demos")
      .select("id, title, feature_prompt, scene_script, status, progress_pct, current_step, mp4_url, thumbnail_url, duration_seconds, steel_session_id, live_view_url, session_viewer_url, recording_url, error_message, created_at")
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
      credentials = credentialMeta ?? null;
    } catch {
      credentials = null;
    }

    return {
      project: project as ProjectRecord,
      demos: (demos ?? []) as DemoRecord[],
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

    const { credentials, loginUrl } = await loadCredentials(context, data.projectId, context.userId);

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
    } catch {
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
      .select("id, name, base_url, description, site_map_md, site_map_source, site_map_updated_at, created_at")
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
      .select("id, name, base_url, description, site_map_md, site_map_source, site_map_updated_at, created_at")
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
      .select("id")
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

    const candidate = /^https?:\/\//i.test(data.loginUrl) ? data.loginUrl : `https://${data.loginUrl}`;
    let loginUrl: URL;

    try {
      loginUrl = new URL(candidate);
    } catch {
      throw new Error("Enter a valid login URL.");
    }

    const key = deriveCredsKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({ loginUrl: loginUrl.toString(), username: data.username, secret: data.secret }),
        "utf8",
      ),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const ciphertext = [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");

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
      username_hint: data.username,
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
    let { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id, name, base_url, description, site_map_md")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();

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

    // Insert demo row in "starting" state; the agent plans the shot list once
    // the real browser has scouted the product.
    const { data: demo, error: insertError } = await context.supabase
      .from("demos")
      .insert({
        project_id: data.projectId,
        owner_id: context.userId,
        title: data.title,
        feature_prompt: data.featurePrompt,
        status: "starting",
        progress_pct: 5,
        current_step: "Booting real cloud browser on Steel.dev\u2026",
        thumbnail_url: `/api/public/screenshot?url=${encodeURIComponent(project.base_url)}&width=1280`,
      })
      .select("id, title, feature_prompt, scene_script, status, progress_pct, current_step, mp4_url, thumbnail_url, duration_seconds, steel_session_id, live_view_url, session_viewer_url, recording_url, error_message, created_at")
      .single();

    if (insertError) throw new Error(insertError.message);

    // Create Steel session synchronously so we can return the live URL fast
    try {
      const session = await createSteelSession(project.base_url);

      await context.supabase
        .from("demos")
        .update({
          status: "recording",
          progress_pct: 25,
          current_step: "Real browser session live \u2014 driving the site\u2026",
          steel_session_id: session.id,
          live_view_url: session.liveViewUrl ?? session.debugUrl ?? null,
          session_viewer_url: session.sessionViewerUrl ?? null,
        })
        .eq("id", demo.id);

      return {
        ...demo,
        status: "recording" as const,
        progress_pct: 25,
        current_step: "Real browser session live \u2014 driving the site\u2026",
        steel_session_id: session.id,
        live_view_url: session.liveViewUrl ?? session.debugUrl ?? null,
        session_viewer_url: session.sessionViewerUrl ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start Steel session.";
      await context.supabase
        .from("demos")
        .update({ status: "failed", progress_pct: 0, current_step: message, error_message: message })
        .eq("id", demo.id);
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
      .select("id, steel_session_id, feature_prompt, project_id")
      .eq("id", data.demoId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!demo || !demo.steel_session_id) throw new Error("No active Steel session for this demo.");

    const { data: project } = await context.supabase
      .from("projects")
      .select("id, name, base_url, site_map_md")
      .eq("id", demo.project_id)
      .maybeSingle();
    if (!project) throw new Error("Project not found.");

    const { credentials, loginUrl } = await loadCredentials(context, demo.project_id, context.userId);

    const session = await (
      await import("./steel-recorder.server")
    ).getSteelSession(demo.steel_session_id);
    const websocketUrl =
      session && typeof session.websocketUrl === "string" ? session.websocketUrl : null;
    if (!websocketUrl) throw new Error("Cloud browser session is no longer available.");

    await context.supabase
      .from("demos")
      .update({ progress_pct: 20, current_step: "Agent scouting the product\u2026" })
      .eq("id", demo.id);

    let recon: ReconResult | null = null;
    try {
      recon = await reconSite({
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
    } catch {
      recon = null;
    }

    await context.supabase
      .from("demos")
      .update({ progress_pct: 40, current_step: "AI writing the shot list\u2026" })
      .eq("id", demo.id);

    const plan = await planDemoScenes({
      productName: project.name,
      baseUrl: project.base_url,
      featurePrompt: demo.feature_prompt,
      siteMapMd: project.site_map_md,
      recon,
      loginUrl,
      credentials: credentials ? { username: credentials.username, secret: credentials.secret } : null,
    });

    const sceneScript = plan.scenes.map((scene, index) => ({
      seconds: `${index * 5}-${(index + 1) * 5}`,
      shot: scene.narration || `Action: ${scene.action.type}`,
      action: scene.action,
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

    let result: { executed: number; error?: string };
    try {
      result = await runScenesOverCdp(
        websocketUrl,
        plan.scenes.map((scene) => scene.action),
        55000,
      );
    } catch (err) {
      result = { executed: 0, error: err instanceof Error ? err.message : String(err) };
    }

    // Release session; grab replay URL
    const released = await releaseSteelSession(demo.steel_session_id);

    const { data: updated } = await context.supabase
      .from("demos")
      .update({
        status: result.executed === 0 ? "failed" : "rendering",
        progress_pct: result.executed === 0 ? 0 : 80,
        current_step:
          result.executed === 0
            ? `Recording failed: ${result.error ?? "no actions ran"}`
            : "Encoding the MP4\u2026",
        session_viewer_url: released?.sessionViewerUrl ?? null,
        live_view_url: null,
        error_message: result.executed === 0 ? (result.error ?? "No actions ran.") : null,
      })
      .eq("id", demo.id)
      .select("id, status, progress_pct, current_step, session_viewer_url, live_view_url, mp4_url, recording_url, error_message")
      .single();

    return updated;
  });

// Pull the finalized MP4 out of Steel, store it in Cloud storage, and expose a
// long-lived signed URL the browser can play and download.
export const finalizeDemoRecording = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const { data: demo, error } = await context.supabase
      .from("demos")
      .select("id, steel_session_id, project_id")
      .eq("id", data.demoId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!demo?.steel_session_id) throw new Error("This demo has no recording session.");

    const recording = await fetchSessionMp4(demo.steel_session_id, { attempts: 5, waitMs: 4000 });

    if (!recording) {
      const { data: pending } = await context.supabase
        .from("demos")
        .update({ current_step: "Waiting for the recording to finish encoding\u2026" })
        .eq("id", demo.id)
        .select("id, status, progress_pct, current_step, mp4_url, recording_url, error_message")
        .single();
      return pending;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${context.userId}/${demo.id}.mp4`;
    const upload = await supabaseAdmin.storage
      .from("demo-recordings")
      .upload(path, recording.bytes, { contentType: "video/mp4", upsert: true });
    if (upload.error) throw new Error(upload.error.message);

    const signed = await supabaseAdmin.storage
      .from("demo-recordings")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    const url = signed.data?.signedUrl ?? null;

    const { data: updated } = await context.supabase
      .from("demos")
      .update({
        status: "ready",
        progress_pct: 100,
        current_step: "Demo ready \u2014 real recording of your product.",
        mp4_url: url,
        recording_url: url,
        duration_seconds: recording.durationSeconds,
        error_message: null,
      })
      .eq("id", demo.id)
      .select("id, status, progress_pct, current_step, mp4_url, recording_url, duration_seconds, error_message")
      .single();

    return updated;
  });

export const getDemoStatus = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ demoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const context = await workspaceContext();
    const { data: demo, error } = await context.supabase
      .from("demos")
      .select("id, status, progress_pct, current_step, steel_session_id, live_view_url, session_viewer_url, mp4_url, recording_url, duration_seconds, error_message")
      .eq("id", data.demoId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!demo) throw new Error("Demo not found.");
    return demo;
  });