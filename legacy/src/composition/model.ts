import { z } from "zod";

export const COMPOSITION_VERSION = 1;

const colorSchema = z.string().min(1).max(64);
const sourceViewportSchema = z.object({
  videoWidth: z.number().int().min(1).max(16_384),
  videoHeight: z.number().int().min(1).max(16_384),
  contentX: z.number().int().min(0).max(16_384),
  contentY: z.number().int().min(0).max(16_384),
  contentWidth: z.number().int().min(1).max(16_384),
  contentHeight: z.number().int().min(1).max(16_384),
});

export const canvasFormatSchema = z.enum([
  "landscape",
  "square",
  "portrait-feed",
  "vertical",
  "custom",
]);

export const compositionSchema = z.object({
  version: z.literal(COMPOSITION_VERSION),
  templateId: z.string().min(1).max(64),
  canvas: z.object({
    width: z.number().int().min(320).max(4096),
    height: z.number().int().min(320).max(4096),
    fps: z.number().int().min(15).max(60),
    format: canvasFormatSchema,
  }),
  background: z.object({
    type: z.enum([
      "solid",
      "linear-gradient",
      "radial-gradient",
      "mesh-gradient",
      "brand-blur",
      "image",
      "video",
      "texture",
    ]),
    colors: z.array(colorSchema).min(1).max(6),
    angle: z.number().min(-360).max(360),
    imageUrl: z.string().max(2048).nullable(),
    videoUrl: z.string().max(2048).nullable(),
    blur: z.number().min(0).max(120),
    textureOpacity: z.number().min(0).max(1),
  }),
  frame: z.object({
    id: z.string().min(1).max(64),
    variant: z.enum(["dark", "light"]),
    x: z.number().min(-4096).max(8192),
    y: z.number().min(-4096).max(8192),
    width: z.number().min(120).max(8192),
    rotation: z.number().min(-45).max(45),
    radius: z.number().min(0).max(160),
    borderWidth: z.number().min(0).max(40),
    borderColor: colorSchema,
    shadowBlur: z.number().min(0).max(240),
    shadowOpacity: z.number().min(0).max(1),
    shadowOffsetX: z.number().min(-240).max(240),
    shadowOffsetY: z.number().min(-240).max(240),
    chromeVisible: z.boolean(),
    addressText: z.string().max(180),
  }),
  recording: z.object({
    locale: z.enum(["english", "arabic", "auto"]).default("english"),
    fit: z.enum(["contain", "cover", "fill"]),
    zoom: z.number().min(0.5).max(5),
    offsetX: z.number().min(-2000).max(2000),
    offsetY: z.number().min(-2000).max(2000),
    cropTop: z.number().min(0).max(0.45),
    cropRight: z.number().min(0).max(0.45),
    cropBottom: z.number().min(0).max(0.45),
    cropLeft: z.number().min(0).max(0.45),
    sourceViewport: sourceViewportSchema.default({
      videoWidth: 1280,
      videoHeight: 720,
      contentX: 0,
      contentY: 0,
      contentWidth: 1280,
      contentHeight: 720,
    }),
    sourceCropTop: z.number().int().min(0).max(4000).default(0),
    sourceCropRight: z.number().int().min(0).max(4000).default(0),
    sourceCropBottom: z.number().int().min(0).max(4000).default(0),
    sourceCropLeft: z.number().int().min(0).max(4000).default(0),
    editorialCuts: z
      .array(
        z.object({
          id: z.string().min(1).max(96),
          sceneId: z.string().min(1).max(96).optional(),
          sourceStartSeconds: z.number().min(0).max(86_400),
          sourceDurationSeconds: z.number().min(0.2).max(60),
          freezeSeconds: z.number().min(0).max(5),
        }),
      )
      .max(32)
      .default([]),
  }),
  animation: z.object({
    preset: z.enum([
      "none",
      "subtle",
      "minimal-premium",
      "cinematic",
      "founder-launch",
      "fast-social",
    ]),
    entrance: z.enum(["none", "fade", "scale", "slide-up", "slide-left"]),
    floatingMotion: z.number().min(0).max(1),
    zoomEvents: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          start: z.number().min(0).max(86_400),
          duration: z.number().min(0.2).max(60),
          zoom: z.number().min(1).max(5),
          panX: z.number().min(-2000).max(2000),
          panY: z.number().min(-2000).max(2000),
          focusX: z.number().min(0).max(16_384).optional(),
          focusY: z.number().min(0).max(16_384).optional(),
        }),
      )
      .max(50),
    spotlights: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          start: z.number().min(0).max(86_400),
          duration: z.number().min(0.1).max(12),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        }),
      )
      .max(50),
  }),
  captions: z.object({
    enabled: z.boolean(),
    position: z.enum(["top", "bottom", "lower-third"]),
    fontFamily: z.enum(["inter", "serif", "mono"]),
    fontSize: z.number().min(18).max(120),
    color: colorSchema,
    backgroundColor: colorSchema,
    maxWidth: z.number().min(180).max(3000),
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          start: z.number().min(0).max(86_400),
          duration: z.number().min(0.4).max(60),
          text: z.string().min(1).max(220),
        }),
      )
      .max(100),
  }),
  branding: z.object({
    logoUrl: z.string().max(2048).nullable(),
    logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
    logoWidth: z.number().min(24).max(500),
    opacity: z.number().min(0).max(1),
    watermarkText: z.string().max(100),
  }),
  intro: z.object({
    enabled: z.boolean(),
    duration: z.number().min(0).max(10),
    title: z.string().max(120),
    subtitle: z.string().max(220),
  }),
  outro: z.object({
    enabled: z.boolean(),
    duration: z.number().min(0).max(10),
    title: z.string().max(120),
    subtitle: z.string().max(220),
  }),
  audio: z.object({
    musicUrl: z.string().max(2048).nullable(),
    volume: z.number().min(0).max(1),
    fadeIn: z.number().min(0).max(10),
    fadeOut: z.number().min(0).max(10),
  }),
  export: z.object({
    quality: z.enum(["draft", "standard", "high", "master"]),
    codec: z.literal("h264"),
  }),
});

export type CompositionDesign = z.infer<typeof compositionSchema>;

export const compositionRenderPropsSchema = z.object({
  composition: compositionSchema,
  rawVideoUrl: z.string().min(1).max(4096),
  rawVideoIsStatic: z.boolean(),
  rawDurationSeconds: z.number().min(0.1).max(86_400),
});

export type CompositionRenderProps = z.infer<typeof compositionRenderPropsSchema>;

export function totalCompositionDuration(
  composition: CompositionDesign,
  rawDurationSeconds: number,
): number {
  const contentDuration = composition.recording.editorialCuts.length
    ? composition.recording.editorialCuts.reduce(
        (total, cut) => total + cut.sourceDurationSeconds + cut.freezeSeconds,
        0,
      )
    : rawDurationSeconds;
  return (
    contentDuration +
    (composition.intro.enabled ? composition.intro.duration : 0) +
    (composition.outro.enabled ? composition.outro.duration : 0)
  );
}

export function parseComposition(value: unknown): CompositionDesign {
  return compositionSchema.parse(value);
}

export function cloneComposition(value: CompositionDesign): CompositionDesign {
  return parseComposition(JSON.parse(JSON.stringify(value)));
}
