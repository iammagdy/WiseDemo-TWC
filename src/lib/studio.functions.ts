import { createCipheriv, randomBytes } from "crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const candidate = /^https?:\/\//i.test(data.baseUrl) ? data.baseUrl : `https://${data.baseUrl}`;
    let baseUrl: URL;

    try {
      baseUrl = new URL(candidate);
    } catch {
      throw new Error("Enter a valid website URL.");
    }

    const { data: project, error } = await context.supabase
      .from("projects")
      .insert({
        owner_id: context.userId,
        name: data.name,
        base_url: baseUrl.origin,
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
      .select("id, title, feature_prompt, status, progress_pct, current_step, mp4_url, thumbnail_url, duration_seconds, created_at")
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

    const keyHex = process.env.DEMOFORGE_CREDS_KEY;
    if (!keyHex || !/^[\da-f]{64}$/i.test(keyHex)) {
      throw new Error("Credential encryption is not configured yet.");
    }

    const key = Buffer.from(keyHex, "hex");
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
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id, name, base_url, site_map_md")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error("Project not found.");

    const sceneScript = [
      { seconds: "0-5", shot: "Open the product and establish the core promise." },
      { seconds: "5-25", shot: "Walk through the requested feature with real clicks." },
      { seconds: "25-50", shot: "Show the result state and the product value clearly." },
      { seconds: "50-69", shot: "Close on the shareable outcome and brand moment." },
    ];

    const { data: demo, error } = await context.supabase
      .from("demos")
      .insert({
        project_id: data.projectId,
        owner_id: context.userId,
        title: data.title,
        feature_prompt: data.featurePrompt,
        scene_script: sceneScript,
        status: "pending",
        progress_pct: project.site_map_md ? 20 : 10,
        current_step: project.site_map_md ? "Ready for real-browser recording" : "Waiting for product map",
      })
      .select("id, title, feature_prompt, status, progress_pct, current_step, mp4_url, thumbnail_url, duration_seconds, created_at")
      .single();

    if (error) throw new Error(error.message);
    return demo;
  });