import type { CompositionDesign } from "../composition/model.ts";

import type { DemoSceneCapture, DemoStoryboard, VideoQualityReview } from "./product-intelligence";

export function reviewLaunchVideo(input: {
  storyboard: DemoStoryboard | null;
  scenes: DemoSceneCapture[];
  composition: CompositionDesign;
  outputDurationSeconds: number;
}): VideoQualityReview {
  const issues: VideoQualityReview["issues"] = [];
  const recommendedChanges: VideoQualityReview["recommendedChanges"] = [];
  if (!input.storyboard) {
    issues.push({
      code: "MISSING_STORYBOARD",
      severity: "error",
      message: "The export has no marketing storyboard to review against.",
    });
  } else {
    for (const purpose of ["hook", "transformation", "proof", "cta"] as const) {
      if (!input.storyboard.scenes.some((scene) => scene.purpose === purpose)) {
        issues.push({
          code: `MISSING_${purpose.toUpperCase()}`,
          severity: "error",
          message: `The launch story is missing its ${purpose} beat.`,
        });
      }
    }
  }
  const failed = input.scenes.filter((scene) => scene.status === "failed");
  if (failed.length) {
    issues.push({
      code: "FAILED_SCENES",
      severity: "error",
      message: `${failed.length} scene capture${failed.length === 1 ? "" : "s"} failed and should not be used.`,
      sceneId: failed[0]?.sceneId,
    });
    recommendedChanges.push({
      action: "Re-record the failed scene",
      reason: "The final story must not include a broken browser action.",
      sceneId: failed[0]?.sceneId,
    });
  }
  const captured = input.scenes.filter((scene) => scene.status === "captured");
  if (
    input.storyboard &&
    captured.length <
      Math.max(1, input.storyboard.scenes.filter((scene) => scene.actions.length > 0).length)
  ) {
    issues.push({
      code: "UNVERIFIED_ACTION_SCENE",
      severity: "warning",
      message: "Some planned browser actions do not yet have captured, verified source footage.",
    });
  }
  if (input.outputDurationSeconds < 30 || input.outputDurationSeconds > 60) {
    issues.push({
      code: "DURATION_OUT_OF_RANGE",
      severity: "error",
      message: `The launch export is ${input.outputDurationSeconds.toFixed(1)} seconds; the target range is 30-60 seconds.`,
    });
    recommendedChanges.push({
      action: "Adjust scene durations",
      reason: "Keep the launch cut in the promised 30-60 second range.",
    });
  }
  if (!input.composition.captions.items.length) {
    issues.push({
      code: "MISSING_BENEFIT_CAPTIONS",
      severity: "error",
      message: "No timed benefit captions are present in the final composition.",
    });
  }
  if (!input.composition.animation.zoomEvents.length) {
    issues.push({
      code: "MISSING_EVENT_ZOOMS",
      severity: "warning",
      message: "No zoom is linked to a verified workflow event.",
    });
  }
  if (input.composition.recording.editorialCuts.length === 0) {
    issues.push({
      code: "UNTRIMMED_RAW_RECORDING",
      severity: "warning",
      message:
        "The composition still uses the full raw recording rather than scene-level editorial cuts.",
    });
  }
  issues.push({
    code: "METADATA_REVIEW",
    severity: "info",
    message:
      "This review uses storyboard, action, scene, caption, and timing evidence. Key-frame vision review can be added when a vision provider is configured.",
  });
  const score = Math.max(
    0,
    Math.min(
      100,
      100 -
        issues.filter((issue) => issue.severity === "error").length * 25 -
        issues.filter((issue) => issue.severity === "warning").length * 8,
    ),
  );
  return {
    score,
    status: issues.some((issue) => issue.severity === "error")
      ? "fail"
      : issues.some((issue) => issue.severity === "warning")
        ? "pass-with-warnings"
        : "pass",
    analysisMethod: "storyboard-and-capture-metadata",
    issues,
    recommendedChanges,
    reviewedAt: new Date().toISOString(),
  };
}
