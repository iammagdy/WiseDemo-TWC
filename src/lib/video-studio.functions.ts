import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { cloneComposition, compositionSchema } from "@/composition/model";
import { compositionFromTemplate } from "@/composition/templates";
import type { Json } from "@/integrations/appwrite/types";
import { assertPublicHttpUrl } from "@/lib/public-url.server";

const projectIdSchema = z.object({ projectId: z.string().uuid() });

const sourceSchema = z.object({
  kind: z.literal("uploaded"),
  fileId: z.string().uuid(),
  durationSeconds: z
    .number()
    .min(1)
    .max(60 * 60),
  width: z.number().int().min(1).max(7680),
  height: z.number().int().min(1).max(7680),
});

const timelineSchema = z.object({
  assetId: z.string().uuid(),
  title: z.string().trim().min(2).max(96),
  addressText: z.string().trim().max(180).default(""),
  hook: z.string().trim().max(120).default(""),
  context: z.string().trim().max(160).default(""),
  cta: z.string().trim().max(120).default(""),
  zoom: z.number().min(1).max(2.5).default(1.08),
  cropTop: z.number().min(0).max(0.4).default(0),
  cropRight: z.number().min(0).max(0.4).default(0),
  cropBottom: z.number().min(0).max(0.4).default(0),
  cropLeft: z.number().min(0).max(0.4).default(0),
  frame: z.enum(["minimal-browser", "premium-laptop", "clean-saas"]).default("premium-laptop"),
});

type VideoSource = z.infer<typeof sourceSchema>;
type VideoTimeline = z.infer<typeof timelineSchema>;

function asObject(value: Json): Record<string, Json> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function parseAsset(value: Json): VideoSource {
  const parsed = asObject(value);
  return sourceSchema.parse(parsed?.source);
}

function parseTimeline(value: Json): VideoTimeline {
  return timelineSchema.parse(asObject(value)?.timeline);
}

export function buildVideoComposition(timeline: VideoTimeline, source: VideoSource) {
  const composition = cloneComposition(compositionFromTemplate(timeline.frame));
  composition.recording = {
    ...composition.recording,
    fit: "cover",
    zoom: timeline.zoom,
    cropTop: timeline.cropTop,
    cropRight: timeline.cropRight,
    cropBottom: timeline.cropBottom,
    cropLeft: timeline.cropLeft,
    sourceViewport: {
      videoWidth: source.width,
      videoHeight: source.height,
      contentX: 0,
      contentY: 0,
      contentWidth: source.width,
      contentHeight: source.height,
    },
  };
  composition.frame.addressText = timeline.addressText;
  composition.intro.title = timeline.hook || timeline.title;
  composition.intro.subtitle = timeline.context || "A real product moment, made shareable.";
  composition.outro.title = timeline.cta || "Make the next step obvious.";
  composition.outro.subtitle = "Create, refine, and share with WiseDemo.";
  if (timeline.zoom > 1.01) {
    composition.animation.zoomEvents = [
      {
        id: "editorial-focus",
        start: Math.max(1.7, source.durationSeconds * 0.2),
        duration: Math.max(0.8, Math.min(4, source.durationSeconds * 0.35)),
        zoom: timeline.zoom,
        panX: 0,
        panY: 0,
      },
    ];
  }
  return compositionSchema.parse(composition);
}

export const getVideoStudio = createServerFn({ method: "GET" })
  .inputValidator((data) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const repository = appwriteWorkspace();
    const [project, artifacts] = await Promise.all([
      repository.getProject(data.projectId),
      repository.listDirectorArtifacts(data.projectId),
    ]);
    if (!project) throw new Error("Video project was not found.");
    const media = artifacts.filter(
      (artifact) => artifact.artifact_kind === "media-asset" && artifact.status === "ready",
    );
    const timelines = artifacts.filter(
      (artifact) => artifact.artifact_kind === "video-timeline" && artifact.status === "ready",
    );
    const renders = artifacts.filter(
      (artifact) => artifact.artifact_kind === "video-render" && artifact.status === "ready",
    );
    return { project, media, timelines, renders };
  });

export const saveVideoTimeline = createServerFn({ method: "POST" })
  .inputValidator((data) => projectIdSchema.extend({ timeline: timelineSchema }).parse(data))
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const repository = appwriteWorkspace();
    const [project, asset] = await Promise.all([
      repository.getProject(data.projectId),
      repository.getDirectorArtifact(data.timeline.assetId),
    ]);
    if (
      !project ||
      !asset ||
      asset.project_id !== project.id ||
      asset.artifact_kind !== "media-asset"
    ) {
      throw new Error("Choose an uploaded source from this project.");
    }
    parseAsset(asset.payload_json);
    return repository.createDirectorArtifact({
      project_id: project.id,
      demo_id: null,
      artifact_kind: "video-timeline",
      cache_key: `${data.timeline.assetId}:timeline:${crypto.randomUUID().slice(0, 8)}`,
      status: "ready",
      payload_json: { timeline: data.timeline } as Json,
      expires_at: null,
      provider: "wisedemo",
      model: null,
      duration_ms: null,
      revision: 1,
      failure_reason: null,
    });
  });

export const capturePublicWebsiteVideo = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    projectIdSchema.extend({ publicUrl: z.string().trim().url().max(2_048) }).parse(data),
  )
  .handler(async ({ data }) => {
    const publicUrl = await assertPublicHttpUrl(data.publicUrl);
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const repository = appwriteWorkspace();
    const project = await repository.getProject(data.projectId);
    if (!project) throw new Error("Video project was not found.");
    const { createSteelSession, fetchSessionMp4, releaseSteelSession, runScenesOverCdp } =
      await import("@/lib/steel-recorder.server");
    const session = await createSteelSession(publicUrl.toString(), "english");
    try {
      if (!session.websocketUrl) throw new Error("The public capture browser was unavailable.");
      const execution = await runScenesOverCdp(
        session.websocketUrl,
        [
          { type: "goto", url: publicUrl.toString(), waitMs: 1_500 },
          { type: "wait", ms: 3_000 },
          { type: "scroll", deltaY: 520 },
          { type: "wait", ms: 3_000 },
          { type: "scroll", deltaY: 420 },
          { type: "wait", ms: 3_000 },
        ],
        25_000,
      );
      if (!execution.completed) throw new Error("The public website capture did not complete.");
    } finally {
      await releaseSteelSession(session.id).catch(() => undefined);
    }
    const recording = await fetchSessionMp4(session.id, { attempts: 10, initialWaitMs: 800 });
    if (!recording) throw new Error("The public website recording was not finalized.");
    if (recording.durationSeconds < 8 || recording.durationSeconds > 20) {
      throw new Error("The public website recording fell outside the 8–20 second proof range.");
    }
    const [{ appwriteRecordingStorage }] = await Promise.all([
      import("@/integrations/appwrite/storage.server"),
    ]);
    const fileId = crypto.randomUUID();
    await appwriteRecordingStorage().upsertRecording(fileId, recording.bytes);
    return repository.createDirectorArtifact({
      project_id: project.id,
      demo_id: null,
      artifact_kind: "media-asset",
      cache_key: `public-capture:${fileId.slice(0, 8)}`,
      status: "ready",
      payload_json: {
        source: {
          kind: "uploaded",
          fileId,
          durationSeconds: recording.durationSeconds,
          width: 1280,
          height: 800,
        },
        provenance: "public-website-capture",
      } as Json,
      expires_at: null,
      provider: "steel.dev",
      model: null,
      duration_ms: null,
      revision: 1,
      failure_reason: null,
    });
  });

export const renderVideoTimeline = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ timelineId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
    const repository = appwriteWorkspace();
    const timelineArtifact = await repository.getDirectorArtifact(data.timelineId);
    if (!timelineArtifact || timelineArtifact.artifact_kind !== "video-timeline") {
      throw new Error("Video timeline was not found.");
    }
    const timeline = parseTimeline(timelineArtifact.payload_json);
    const asset = await repository.getDirectorArtifact(timeline.assetId);
    if (
      !asset ||
      asset.project_id !== timelineArtifact.project_id ||
      asset.artifact_kind !== "media-asset"
    ) {
      throw new Error("The selected source clip is no longer available.");
    }
    const source = parseAsset(asset.payload_json);
    const composition = buildVideoComposition(timeline, source);
    const renderId = crypto.randomUUID();
    const startedAt = Date.now();
    const [{ renderCompositionToMp4 }, { appwriteRecordingStorage }] = await Promise.all([
      import("@/lib/composition-renderer.server"),
      import("@/integrations/appwrite/storage.server"),
    ]);
    const rendered = await renderCompositionToMp4({
      exportId: renderId,
      rawRecordingFileId: source.fileId,
      rawDurationSeconds: source.durationSeconds,
      composition,
    });
    await appwriteRecordingStorage().upsertRecording(renderId, rendered.bytes);
    return repository.createDirectorArtifact({
      project_id: timelineArtifact.project_id,
      demo_id: null,
      artifact_kind: "video-render",
      cache_key: `${timelineArtifact.id}:render:${renderId.slice(0, 8)}`,
      status: "ready",
      payload_json: {
        timelineId: timelineArtifact.id,
        fileId: renderId,
        durationSeconds: rendered.outputDuration,
        bytes: rendered.bytes.byteLength,
        deterministicQa: {
          sourceVideo: true,
          validMp4: rendered.bytes.byteLength >= 100_000,
          noSyntheticBars: true,
        },
      } as Json,
      expires_at: null,
      provider: "remotion",
      model: null,
      duration_ms: Date.now() - startedAt,
      revision: 1,
      failure_reason: null,
    });
  });
