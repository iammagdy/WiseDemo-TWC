import assert from "node:assert/strict";
import test from "node:test";

import { compositionFromTemplate } from "../composition/templates.ts";

import { createLaunchStoryboard } from "./story-director.server.ts";
import { reviewLaunchVideo } from "./video-quality-review.server.ts";

test("quality review fails an untrimmed launch cut with no scene evidence", () => {
  const candidate = {
    id: "candidate",
    name: "Tailor resume",
    description: "Verified",
    userProblem: "Problem",
    userBenefit: "Benefit",
    requiredState: "Editor",
    entryUrl: "https://wiseresume.app/editor",
    actions: [
      {
        id: "action",
        type: "click" as const,
        label: "Tailor Resume",
        selector: "button",
        status: "successful" as const,
        requiredState: "Editor",
        visualChangeScore: 0.9,
        semanticChangeScore: 0.8,
        reliabilityScore: 0.9,
        evidence: [],
      },
    ],
    expectedResult: "Result",
    visualChangeScore: 0.9,
    marketingValueScore: 0.9,
    reliabilityScore: 0.9,
    confidenceScore: 0.9,
    estimatedDurationSeconds: 10,
    requiredPreparation: [],
    evidence: [],
  };
  const review = reviewLaunchVideo({
    storyboard: createLaunchStoryboard({ productName: "WiseResume", candidate }),
    scenes: [],
    composition: compositionFromTemplate("minimal-browser"),
    outputDurationSeconds: 65,
  });
  assert.equal(review.status, "fail");
  assert.ok(review.issues.some((issue) => issue.code === "DURATION_OUT_OF_RANGE"));
});
