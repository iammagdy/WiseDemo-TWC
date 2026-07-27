import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePublicUrl, scanWebsite } from "./studio-scanner.server";
import {
  createSteelSession,
  planScenes,
  releaseSteelSession,
  runScenesOverCdp,
  type DecryptedCredentials,
} from "./steel-recorder.server";

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

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        name: z.string().trim().min(2).max(80),
        baseUrl: z.string().trim().min(3).max(300),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
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
    return project;
  });

export const getProjectWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id, name, base_url, description, site_map_md, site_map_source, site_map_updated_at, created_at")
      .eq("id", data.projectId)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error("Project not found.");

    const { data: demos, error: demosError } = await context.supabase
      .from("demos")
      .select("id, title, feature_prompt, scene_script, status, progress_pct, current_step, mp4_url, thumbnail_url, duration_seconds, created_at")
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

    return { project, demos: demos ?? [], credentials };
  });

export const scanProjectSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: existing, error: existingError } = await context.supabase
      .from("projects")
      .select("id, name, base_url")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Project not found.");

    const scan = await scanWebsite(existing.base_url, existing.name);
    const { data: project, error } = await context.supabase
      .from("projects")
      .update({
        description: scan.description,
        site_map_md: scan.siteMapMd,
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
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
        description: z.string().trim().max(800).optional(),
        siteMapMd: z.string().trim().min(10).max(20000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
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
  .middleware([requireSupabaseAuth])
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
  .handler(async ({ data, context }) => {
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

    const keySecret = process.env.DEMOFORGE_CREDS_KEY;
    if (!keySecret || keySecret.length < 32) {
      throw new Error("Credential encryption is not configured yet.");
    }
    const key = /^[\da-f]{64}$/i.test(keySecret)
      ? Buffer.from(keySecret, "hex")
      : createHash("sha256").update(keySecret, "utf8").digest();
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
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().trim().min(2).max(100),
        featurePrompt: z.string().trim().min(10).max(4000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
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

    const { data: credentialMeta } = await context.supabase
      .from("project_credentials")
      .select("kind, login_url")
      .eq("project_id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    const hasCredentials = credentialMeta?.kind === "password" && Boolean(credentialMeta.login_url);

    const sceneScript = hasCredentials
      ? [
          { seconds: "0-5", shot: `Open ${project.name} at the detected sign-in page: ${credentialMeta.login_url}.` },
          { seconds: "5-12", shot: "Sign in with the saved credentials and wait for the real product workspace to load." },
          { seconds: "12-32", shot: `Run the requested product flow: ${data.featurePrompt}` },
          { seconds: "32-45", shot: "Close on the clearest result, export, dashboard, or proof screen." },
        ]
      : [
          { seconds: "0-5", shot: `Open ${project.name} at the public landing page and establish what the product is.` },
          { seconds: "5-16", shot: "Scroll down through the landing page to show sections, calls to action, and product proof." },
          { seconds: "16-25", shot: `Spotlight the requested public demo angle: ${data.featurePrompt}` },
          { seconds: "25-34", shot: "Scroll back up and close on the main call to action without inventing private app screens." },
        ];

    const { data: demo, error } = await context.supabase
      .from("demos")
      .insert({
        project_id: data.projectId,
        owner_id: context.userId,
        title: data.title,
        feature_prompt: data.featurePrompt,
        scene_script: sceneScript,
        status: "ready",
        progress_pct: 100,
        current_step: hasCredentials
          ? "Ready — render a credential-assisted browser-capture demo."
          : "Ready — render a public landing-page scroll demo.",
        thumbnail_url: `/api/public/screenshot?url=${encodeURIComponent(project.base_url)}&width=1280`,
        duration_seconds: hasCredentials ? 45 : 34,
      })
      .select("id, title, feature_prompt, scene_script, status, progress_pct, current_step, mp4_url, thumbnail_url, duration_seconds, created_at")
      .single();

    if (error) throw new Error(error.message);
    return demo;
  });