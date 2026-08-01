import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { cloneComposition, compositionSchema, type CompositionDesign } from "@/composition/model";
import { compositionFromTemplate } from "@/composition/templates";
import { serverEnv } from "@/lib/server-env.server";

const idsSchema = z.object({ projectId: z.string().uuid(), demoId: z.string().uuid() });

export const getCompositionWorkspace = createServerFn({ method: "GET" })
  .inputValidator((data) => idsSchema.parse(data))
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const repository = appwriteWorkspace();
    const [project, demo, compositions] = await Promise.all([
      repository.getProject(data.projectId),
      repository.getDemo(data.demoId),
      repository.listCompositions(data.demoId),
    ]);
    if (!project || !demo || demo.project_id !== project.id) {
      throw new Error("Composition source recording was not found.");
    }
    if (demo.status !== "ready" || !demo.recording_file_id || !demo.duration_seconds) {
      throw new Error("Finish the raw recording before opening the composition editor.");
    }
    const exports = (
      await Promise.all(
        compositions.map((composition) => repository.listCompositionExports(composition.id)),
      )
    )
      .flat()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const defaultDesign = compositionFromTemplate("premium-laptop");
    defaultDesign.intro.title = `${project.name} walkthrough`;
    defaultDesign.frame.addressText = new URL(project.base_url).hostname;
    defaultDesign.recording.locale = demo.recording_locale;
    if (demo.source_viewport) {
      defaultDesign.recording.sourceViewport = demo.source_viewport.sourceViewport;
    }
    return {
      project,
      demo,
      compositions,
      exports,
      defaultDesign,
      rawVideoUrl: `/api/public/demo-recordings/${demo.id}`,
      rawDurationSeconds: demo.duration_seconds,
    };
  });

export const saveCompositionDraft = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    idsSchema
      .extend({ compositionId: z.string().uuid().nullable(), composition: compositionSchema })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const repository = appwriteWorkspace();
    const demo = await repository.getDemo(data.demoId);
    if (
      !demo ||
      demo.project_id !== data.projectId ||
      demo.status !== "ready" ||
      !demo.recording_file_id
    ) {
      throw new Error("A ready raw recording is required before saving a composition.");
    }

    if (data.compositionId) {
      const existing = await repository.getComposition(data.compositionId);
      if (!existing || existing.demo_id !== demo.id || existing.project_id !== demo.project_id) {
        throw new Error("Composition was not found in this project.");
      }
      return repository.updateComposition(existing.id, {
        composition_json: data.composition,
        composition_version: existing.composition_version + 1,
        template_id: data.composition.templateId,
      });
    }

    return repository.createComposition({
      project_id: demo.project_id,
      demo_id: demo.id,
      composition_json: data.composition,
      composition_version: 1,
      template_id: data.composition.templateId,
      raw_recording_file_id: demo.recording_file_id,
    });
  });

export const suggestCompositionStyle = createServerFn({ method: "POST" })
  .inputValidator((data) => idsSchema.extend({ composition: compositionSchema }).parse(data))
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const repository = appwriteWorkspace();
    const [project, demo] = await Promise.all([
      repository.getProject(data.projectId),
      repository.getDemo(data.demoId),
    ]);
    if (!project || !demo || demo.project_id !== project.id) {
      throw new Error("Composition project was not found.");
    }
    const palette = await detectBrandPalette(project.base_url);
    const fallback = heuristicCompositionStyle(
      data.composition,
      palette,
      project.name,
      demo.feature_prompt,
      demo.duration_seconds ?? 30,
    );
    const apiKey = serverEnv("LOVABLE_API_KEY");
    if (!apiKey) return { composition: fallback, source: "heuristic" as const, palette };

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a restrained SaaS video art director. Return one complete composition JSON object matching the supplied schema shape. Preserve every field and valid type. Use generic frames only. Keep the product readable, preserve visible canvas margin, use no copyrighted assets, add at most three purposeful zoom events, and place short captions in safe areas.",
            },
            {
              role: "user",
              content: JSON.stringify({
                product: project.name,
                feature: demo.feature_prompt,
                detectedBrandColors: palette,
                rawDurationSeconds: demo.duration_seconds,
                currentComposition: fallback,
              }),
            },
          ],
        }),
      });
      if (!response.ok) return { composition: fallback, source: "heuristic" as const, palette };
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = payload.choices?.[0]?.message?.content ?? "";
      const suggested = compositionSchema.parse(JSON.parse(raw.replace(/^```json\s*|```$/g, "")));
      return { composition: suggested, source: "ai" as const, palette };
    } catch {
      return { composition: fallback, source: "heuristic" as const, palette };
    }
  });

export const renderCompositionExport = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ compositionId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const repository = appwriteWorkspace();
    const composition = await repository.getComposition(data.compositionId);
    if (!composition) throw new Error("Composition was not found.");
    const demo = await repository.getDemo(composition.demo_id);
    if (
      !demo ||
      demo.status !== "ready" ||
      !demo.recording_file_id ||
      !demo.duration_seconds ||
      demo.recording_file_id !== composition.raw_recording_file_id
    ) {
      throw new Error("The immutable raw recording is not available for this composition.");
    }

    const design = composition.composition_json;
    const exportRecord = await repository.createCompositionExport({
      project_id: composition.project_id,
      demo_id: composition.demo_id,
      composition_id: composition.id,
      raw_recording_file_id: composition.raw_recording_file_id,
      render_status: "queued",
      render_job_id: crypto.randomUUID(),
      output_width: design.canvas.width,
      output_height: design.canvas.height,
      output_fps: design.canvas.fps,
    });
    return executeCompositionExport(exportRecord.id);
  });

export const retryCompositionExport = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ exportId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const existing = await appwriteWorkspace().getCompositionExport(data.exportId);
    if (!existing) throw new Error("Composition export was not found.");
    const stillActive =
      existing.render_status === "rendering" &&
      Date.now() - new Date(existing.updated_at).getTime() < 2 * 60_000;
    return stillActive ? existing : executeCompositionExport(data.exportId);
  });

export const getCompositionExportStatus = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ exportId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const record = await appwriteWorkspace().getCompositionExport(data.exportId);
    if (!record) throw new Error("Composition export was not found.");
    return record;
  });

async function executeCompositionExport(exportId: string) {
  const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
  const repository = appwriteWorkspace();
  const record = await repository.getCompositionExport(exportId);
  if (!record) throw new Error("Composition export was not found.");
  const [composition, demo] = await Promise.all([
    repository.getComposition(record.composition_id),
    repository.getDemo(record.demo_id),
  ]);
  if (!composition || !demo?.duration_seconds) {
    return repository.updateCompositionExport(record.id, {
      render_status: "failed",
      render_error: "Composition source metadata is unavailable.",
    });
  }

  await repository.updateCompositionExport(record.id, {
    render_status: "rendering",
    render_error: null,
    render_attempts: record.render_attempts + 1,
  });
  try {
    const [{ clearCompositionRenderCache, renderCompositionToMp4 }, { appwriteRecordingStorage }] =
      await Promise.all([
        import("@/lib/composition-renderer.server"),
        import("@/integrations/appwrite/storage.server"),
      ]);
    const rendered = await renderCompositionToMp4({
      exportId: record.id,
      rawRecordingFileId: record.raw_recording_file_id,
      rawDurationSeconds: demo.duration_seconds,
      composition: composition.composition_json,
    });
    await appwriteRecordingStorage().upsertRecording(record.id, rendered.bytes);
    const ready = await repository.updateCompositionExport(record.id, {
      render_status: "ready",
      final_recording_file_id: record.id,
      render_error: null,
      output_duration: rendered.outputDuration,
    });
    await clearCompositionRenderCache(record.id).catch(() => undefined);
    return ready;
  } catch (error) {
    console.error("[WiseDemo] composition render failed", {
      exportId: record.id,
      code: error instanceof Error ? error.name : "COMPOSITION_RENDER_FAILED",
    });
    return repository.updateCompositionExport(record.id, {
      render_status: "failed",
      render_error: safeRenderError(error),
    });
  }
}

async function detectBrandPalette(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(6_000),
      headers: { accept: "text/html", "user-agent": "WiseDemoBrandDirector/1.0" },
    });
    if (!response.ok) throw new Error("brand source unavailable");
    const html = (await response.text()).slice(0, 500_000);
    const counts = new Map<string, number>();
    for (const match of html.matchAll(/#[0-9a-f]{6}\b/gi)) {
      const color = match[0].toLowerCase();
      if (isUsefulBrandColor(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    const colors = [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([color]) => color)
      .slice(0, 4);
    if (colors.length >= 2) return colors;
  } catch {
    // Deterministic project-name palette below.
  }
  return ["#0f172a", "#1f3b5b", "#7c3aed", "#f97316"];
}

function isUsefulBrandColor(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  const brightness = (red + green + blue) / 3;
  return spread > 24 && brightness > 24 && brightness < 238;
}

function heuristicCompositionStyle(
  current: CompositionDesign,
  palette: string[],
  productName: string,
  featurePrompt: string,
  rawDuration: number,
): CompositionDesign {
  const next = cloneComposition(current);
  next.background.type = "mesh-gradient";
  next.background.colors = ["#05070d", ...palette.slice(0, 3), "#111827"];
  next.frame.id =
    next.canvas.height > next.canvas.width * 1.35 ? "minimal-browser" : "premium-laptop";
  next.frame.variant = "dark";
  next.frame.chromeVisible = next.frame.id.includes("browser");
  next.animation.preset = next.canvas.height > next.canvas.width ? "fast-social" : "cinematic";
  next.animation.entrance = "slide-up";
  next.animation.zoomEvents = [
    {
      id: crypto.randomUUID(),
      start: Math.min(12, rawDuration * 0.22),
      duration: 4.5,
      zoom: 1.28,
      panX: 0,
      panY: 0,
      focusX: next.recording.sourceViewport.contentWidth * 0.68,
      focusY: next.recording.sourceViewport.contentHeight * 0.42,
    },
    {
      id: crypto.randomUUID(),
      start: Math.min(31, rawDuration * 0.58),
      duration: 5,
      zoom: 1.35,
      panX: 0,
      panY: 0,
      focusX: next.recording.sourceViewport.contentWidth * 0.34,
      focusY: next.recording.sourceViewport.contentHeight * 0.62,
    },
  ].filter((event) => event.start + event.duration < rawDuration - 1);
  next.captions.enabled = true;
  next.captions.items = [
    {
      id: crypto.randomUUID(),
      start: 2.4,
      duration: 3.4,
      text: `${productName}, clearly explained.`,
    },
    {
      id: crypto.randomUUID(),
      start: Math.min(18, rawDuration * 0.34),
      duration: 3.8,
      text: featurePrompt.slice(0, 72),
    },
    {
      id: crypto.randomUUID(),
      start: Math.max(4, rawDuration - 8),
      duration: 3.2,
      text: "From workflow to polished result.",
    },
  ].filter((caption) => caption.start + caption.duration < rawDuration);
  return next;
}

function safeRenderError(error: unknown) {
  const message = error instanceof Error ? error.message : "Composition rendering failed.";
  if (/browser|chrome|download/i.test(message))
    return "The server renderer could not start its video engine.";
  if (/timeout/i.test(message)) return "The server renderer timed out before completing the MP4.";
  if (/raw Appwrite|raw recording/i.test(message))
    return "The raw recording could not be loaded for rendering.";
  return "Composition rendering failed. Retry this export without rerunning Steel.";
}
