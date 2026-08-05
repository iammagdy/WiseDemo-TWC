import { cloneComposition, type CompositionDesign } from "../composition/model.ts";

import type {
  DemoSceneCapture,
  DemoStoryboard,
  FeatureCandidate,
  PlannedBrowserAction,
} from "./product-intelligence";

function toPlannedAction(action: FeatureCandidate["actions"][number]): PlannedBrowserAction {
  return {
    id: action.id,
    type: action.type,
    label: action.label,
    url: action.url,
    selector: action.selector,
    text: action.text,
    deltaY: action.deltaY,
    waitMs: action.waitMs,
    expectedResult: action.expectedResult,
    expectedSelector: action.expectedSelector,
    expectedUrlIncludes: action.expectedUrlIncludes,
    zoomTarget: action.zoomTarget,
  };
}

export function createLaunchStoryboard(input: {
  productName: string;
  candidate: FeatureCandidate;
  revision?: number;
}): DemoStoryboard {
  const action = toPlannedAction(input.candidate.actions[0]);
  const zoomTarget = action.zoomTarget
    ? {
        x: action.zoomTarget.x + action.zoomTarget.width / 2,
        y: action.zoomTarget.y + action.zoomTarget.height / 2,
      }
    : undefined;
  const scenes = [
    {
      id: crypto.randomUUID(),
      purpose: "hook" as const,
      headline: "Stop leaving your most important work to chance.",
      narration: `Meet ${input.productName}: a faster path to a result you can trust.`,
      caption: "Turn high-stakes work into a confident next step.",
      visualObjective: "Establish the product and the starting state without dashboard wandering.",
      startingState: input.candidate.requiredState,
      actions: [],
      expectedResult: "The product context is immediately clear.",
      maxDurationSeconds: 4,
      transition: "cut",
    },
    {
      id: crypto.randomUUID(),
      purpose: "problem" as const,
      headline: input.candidate.userProblem,
      narration: input.candidate.userProblem,
      caption: "The hard part is getting from effort to a result that fits the moment.",
      visualObjective: "Show the meaningful starting state before the product does its work.",
      startingState: input.candidate.requiredState,
      actions: [],
      expectedResult: "The viewer understands what needs to change.",
      maxDurationSeconds: 5,
      transition: "dissolve",
    },
    {
      id: crypto.randomUUID(),
      purpose: "action" as const,
      headline: input.candidate.name,
      narration: `With one focused step, ${input.productName} moves the workflow forward.`,
      caption: input.candidate.userBenefit,
      visualObjective: "Make the primary interaction unmistakable and readable.",
      startingState: input.candidate.requiredState,
      actions: [action],
      expectedResult: input.candidate.expectedResult,
      maxDurationSeconds: 10,
      zoomTarget,
      transition: "match-cut",
    },
    {
      id: crypto.randomUUID(),
      purpose: "transformation" as const,
      headline: "See the change, not just the click.",
      narration: `The payoff is visible: ${input.candidate.expectedResult}.`,
      caption: "A visible result, not another busywork step.",
      visualObjective: "Hold on the strongest before-and-after transformation.",
      startingState: "Action complete",
      actions: [],
      expectedResult: input.candidate.expectedResult,
      maxDurationSeconds: 8,
      zoomTarget,
      transition: "hold",
    },
    {
      id: crypto.randomUUID(),
      purpose: "proof" as const,
      headline: "Built around the result that matters.",
      narration: input.candidate.userBenefit,
      caption: input.candidate.userBenefit,
      visualObjective: "Frame the outcome so the viewer can verify the value at a glance.",
      startingState: "Verified result",
      actions: [],
      expectedResult: "The value is visually proven.",
      maxDurationSeconds: 7,
      transition: "dissolve",
    },
    {
      id: crypto.randomUUID(),
      purpose: "cta" as const,
      headline: `Make your next ${input.productName} workflow count.`,
      narration: `Start with ${input.candidate.name}, and finish with a result worth sharing.`,
      caption: "From first step to a result worth sharing.",
      visualObjective: "Close on the completed state and a concise outcome-focused call to action.",
      startingState: "Completed workflow",
      actions: [],
      expectedResult: "A clear product-launch close.",
      maxDurationSeconds: 4,
      transition: "fade",
    },
  ];
  return {
    version: 2,
    title: `${input.productName}: ${input.candidate.name}`,
    targetAudience: "People who need a fast, confident outcome from a focused workflow.",
    corePromise: input.candidate.userBenefit,
    format: "launch",
    targetDurationSeconds: 38,
    aspectRatio: "16:9",
    featureCandidateId: input.candidate.id,
    scenes,
    revision: input.revision ?? 1,
    generatedAt: new Date().toISOString(),
  };
}

export function compositionFromStoryboard(
  base: CompositionDesign,
  storyboard: DemoStoryboard,
  captures: DemoSceneCapture[],
): CompositionDesign {
  const design = cloneComposition(base);
  design.templateId = "story-directed-launch";
  design.frame.id = "minimal-browser";
  design.frame.chromeVisible = false;
  design.intro = {
    enabled: true,
    duration: 2.2,
    title: storyboard.scenes[0]?.headline ?? storyboard.title,
    subtitle: storyboard.corePromise,
  };
  design.outro = {
    enabled: true,
    duration: 2.5,
    title: storyboard.scenes.at(-1)?.headline ?? "Ready for the next step?",
    subtitle: storyboard.corePromise,
  };
  design.captions.enabled = true;
  design.captions.position = "lower-third";
  design.captions.items = [];
  design.recording.editorialCuts = [];
  let timeline = 0;
  storyboard.scenes.forEach((scene, index) => {
    const capture = captures.find(
      (entry) => entry.sceneId === scene.id && entry.status === "captured",
    );
    const duration = capture?.sourceDurationSeconds ?? Math.min(scene.maxDurationSeconds, 5);
    if (
      capture?.sourceStartSeconds !== null &&
      capture?.sourceStartSeconds !== undefined &&
      duration > 0
    ) {
      design.recording.editorialCuts.push({
        id: scene.id,
        sceneId: scene.id,
        sourceStartSeconds: capture.sourceStartSeconds,
        sourceDurationSeconds: Math.min(duration, scene.maxDurationSeconds),
        freezeSeconds: scene.purpose === "transformation" || scene.purpose === "proof" ? 0.8 : 0,
      });
    }
    design.captions.items.push({
      id: scene.id,
      start: timeline,
      duration: Math.max(1.5, Math.min(duration, scene.maxDurationSeconds)),
      text: scene.caption,
    });
    if (scene.zoomTarget && ["action", "transformation", "proof"].includes(scene.purpose)) {
      design.animation.zoomEvents.push({
        id: `zoom-${scene.id}`,
        start: timeline + 0.4,
        duration: Math.max(1.5, Math.min(duration - 0.4, 4)),
        zoom: scene.purpose === "action" ? 1.32 : 1.18,
        panX: 0,
        panY: 0,
        focusX: scene.zoomTarget.x,
        focusY: scene.zoomTarget.y,
      });
    }
    timeline += Math.max(1.5, Math.min(duration, scene.maxDurationSeconds));
  });
  return design;
}
