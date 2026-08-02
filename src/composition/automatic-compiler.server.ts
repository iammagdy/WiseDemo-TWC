import type { CreativeBrief } from "@/lib/creative-director.server";
import type { PublicProductIntelligence } from "@/lib/public-product-intelligence";
import type { CaptureEvent, TakeMarkers } from "@/lib/single-session-director.server";

import type { CompositionDesign } from "./model";

function safeCaptionFont(intelligence: PublicProductIntelligence): "inter" | "serif" | "mono" {
  return /serif/i.test(intelligence.visualIdentity.headingFont ?? "") ? "serif" : "inter";
}

function takeCuts(markers: TakeMarkers): CompositionDesign["recording"]["editorialCuts"] {
  let sourceStartSeconds = Math.max(
    0,
    (markers.takeStartedAtMs - markers.sessionStartedAtMs) / 1_000,
  );
  let remaining = Math.max(1, (markers.takeEndedAtMs - markers.takeStartedAtMs) / 1_000);
  const cuts: CompositionDesign["recording"]["editorialCuts"] = [];
  let index = 1;
  while (remaining > 0) {
    const duration = Math.min(55, remaining);
    cuts.push({
      id: `directed-take-${index}`,
      sceneId: `take-${index}`,
      sourceStartSeconds,
      sourceDurationSeconds: duration,
      freezeSeconds: index === 1 ? 0.8 : 0,
    });
    sourceStartSeconds += duration;
    remaining -= duration;
    index += 1;
  }
  return cuts;
}

export function compileAutomaticComposition(input: {
  base: CompositionDesign;
  brief: CreativeBrief;
  intelligence: PublicProductIntelligence;
  takeMarkers: TakeMarkers;
  telemetry: CaptureEvent[];
}): CompositionDesign {
  const cuts = takeCuts(input.takeMarkers);
  const contentDuration = cuts.reduce(
    (total, cut) => total + cut.sourceDurationSeconds + cut.freezeSeconds,
    0,
  );
  const introDuration = Math.min(3, Math.max(1.8, input.base.intro.duration));
  const captionSpacing = Math.max(2.5, contentDuration / Math.max(1, input.brief.captions.length));
  const accent =
    input.intelligence.visualIdentity.accentColors[0] ??
    input.intelligence.brand.colors[0]?.hex ??
    input.base.background.colors[0];
  const zoomEvents = input.telemetry
    .filter((event) => event.type === "click" && event.boundingBox)
    .slice(0, 10)
    .map((event, index) => ({
      id: `telemetry-click-${index + 1}`,
      start: Math.max(
        introDuration,
        (event.timestampMs - input.takeMarkers.takeStartedAtMs) / 1_000 + introDuration - 0.25,
      ),
      duration: 1.6,
      zoom: 1.22,
      panX: 0,
      panY: 0,
      focusX:
        (event.boundingBox as { x: number; width: number }).x +
        (event.boundingBox as { width: number }).width / 2,
      focusY:
        (event.boundingBox as { y: number; height: number }).y +
        (event.boundingBox as { height: number }).height / 2,
    }));
  return {
    ...input.base,
    background: {
      ...input.base.background,
      colors: [accent, ...input.base.background.colors.filter((color) => color !== accent)].slice(
        0,
        6,
      ),
    },
    recording: { ...input.base.recording, editorialCuts: cuts },
    animation: { ...input.base.animation, zoomEvents },
    captions: {
      ...input.base.captions,
      enabled: true,
      fontFamily: safeCaptionFont(input.intelligence),
      items: input.brief.captions.map((caption, index) => ({
        id: `director-caption-${index + 1}`,
        text: caption.text,
        start: introDuration + index * captionSpacing,
        duration: Math.min(5, captionSpacing - 0.3),
      })),
    },
    branding: {
      ...input.base.branding,
      logoUrl: input.intelligence.brand.logoUrl ?? input.base.branding.logoUrl,
    },
    intro: {
      ...input.base.intro,
      enabled: true,
      duration: introDuration,
      title: input.brief.hook,
      subtitle: input.brief.corePromise,
    },
    outro: { ...input.base.outro, enabled: true, title: input.brief.callToAction },
  };
}

type SafeReviewIssue = {
  recommendedFix:
    | "rewrite-caption"
    | "move-caption"
    | "increase-zoom"
    | "decrease-zoom"
    | "trim-range"
    | "speed-range"
    | "extend-result-hold"
    | "change-intro"
    | "change-outro"
    | "re-record"
    | "manual-review";
  severity: "low" | "medium" | "high";
};

export function applySafeAutomaticRevision(
  composition: CompositionDesign,
  issues: SafeReviewIssue[],
  revision: number,
): { composition: CompositionDesign; revision: number; requiresRecapture: boolean } {
  if (revision >= 2)
    return {
      composition,
      revision,
      requiresRecapture: issues.some((issue) => issue.recommendedFix === "re-record"),
    };
  const fixes = new Set(issues.map((issue) => issue.recommendedFix));
  if (fixes.has("re-record")) return { composition, revision, requiresRecapture: true };
  const revised = {
    ...composition,
    animation: {
      ...composition.animation,
      zoomEvents: composition.animation.zoomEvents.map((event) => ({
        ...event,
        zoom: fixes.has("increase-zoom")
          ? Math.min(1.5, event.zoom + 0.12)
          : fixes.has("decrease-zoom")
            ? Math.max(1, event.zoom - 0.12)
            : event.zoom,
      })),
    },
    intro: fixes.has("change-intro")
      ? { ...composition.intro, duration: Math.min(4, composition.intro.duration + 0.4) }
      : composition.intro,
    outro: fixes.has("change-outro")
      ? { ...composition.outro, duration: Math.min(4, composition.outro.duration + 0.5) }
      : composition.outro,
    audio: fixes.has("speed-range")
      ? { ...composition.audio, volume: Math.min(0.35, composition.audio.volume) }
      : composition.audio,
  };
  return { composition: revised, revision: revision + 1, requiresRecapture: false };
}
