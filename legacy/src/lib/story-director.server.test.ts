import assert from "node:assert/strict";
import test from "node:test";

import { createLaunchStoryboard } from "./story-director.server.ts";

test("launch story contains hook, transformation, proof, and CTA", () => {
  const story = createLaunchStoryboard({
    productName: "WiseResume",
    candidate: {
      id: "candidate",
      name: "Tailor resume",
      description: "Verified",
      userProblem: "A generic resume misses the role.",
      userBenefit: "Match your resume to any job in seconds.",
      requiredState: "Resume editor",
      entryUrl: "https://wiseresume.app/editor",
      actions: [
        {
          id: "action",
          type: "click",
          label: "Tailor Resume",
          selector: "button[data-testid=tailor]",
          status: "successful",
          requiredState: "Resume editor",
          visualChangeScore: 0.9,
          semanticChangeScore: 0.8,
          reliabilityScore: 0.9,
          evidence: [],
        },
      ],
      expectedResult: "Tailored resume",
      visualChangeScore: 0.9,
      marketingValueScore: 0.9,
      reliabilityScore: 0.9,
      confidenceScore: 0.9,
      estimatedDurationSeconds: 12,
      requiredPreparation: [],
      evidence: [],
    },
  });
  assert.ok(story.targetDurationSeconds >= 30 && story.targetDurationSeconds <= 60);
  for (const purpose of ["hook", "transformation", "proof", "cta"])
    assert.ok(story.scenes.some((scene) => scene.purpose === purpose));
  assert.match(
    story.scenes.find((scene) => scene.purpose === "action")?.caption ?? "",
    /match your resume/i,
  );
});
