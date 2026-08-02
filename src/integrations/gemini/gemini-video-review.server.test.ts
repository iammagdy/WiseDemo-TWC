import assert from "node:assert/strict";
import test from "node:test";

import { GeminiVideoReviewProvider } from "./gemini-video-review.server.ts";
import type { CreativeBrief } from "../../lib/creative-director.server.ts";

const brief: CreativeBrief = {
  version: 1,
  audience: "Teams",
  marketingGoal: "feature-ad",
  corePromise: "Move faster",
  selectedFeature: {
    publicFeatureId: "public-feature",
    name: "Feature",
    userProblem: "Problem",
    userBenefit: "Benefit",
    whySelected: "Visual",
    publicEvidenceUrls: ["https://product.example.test/features"],
  },
  hook: "Hook",
  proofStatement: "Proof",
  callToAction: "Try it",
  targetDurationSeconds: 45,
  captureMode: "desktop",
  demoDataPlan: {
    persona: "Demo",
    fictionalIdentity: {},
    requiredEntities: [],
    privacyRules: ["Fictional only"],
  },
  captureIntent: {
    featureName: "Feature",
    desiredStartingState: "Start",
    desiredFinalState: "Result",
    steps: [
      {
        id: "one",
        objective: "Open",
        expectedVisibleResult: "Result",
        importance: "essential",
        maximumDurationSeconds: 5,
      },
    ],
    proofRequirements: ["Result"],
  },
  captions: [
    { sceneId: "one", text: "Benefit" },
    { sceneId: "two", text: "CTA" },
  ],
  narration: [],
};

test("Gemini video review deletes uploaded files in finally", async () => {
  let deleted = 0;
  const provider = new GeminiVideoReviewProvider(
    {
      files: {
        upload: async () => ({
          name: "files/demo",
          state: "ACTIVE",
          uri: "gemini://demo",
          mimeType: "video/mp4",
        }),
        get: async () => ({
          name: "files/demo",
          state: "ACTIVE",
          uri: "gemini://demo",
          mimeType: "video/mp4",
        }),
        delete: async () => {
          deleted += 1;
        },
      },
      interactions: {
        create: async () => ({
          output_text: JSON.stringify({
            version: 1,
            score: 90,
            status: "pass",
            summary: "Clear",
            criteria: {
              hookClarity: 90,
              featureClarity: 90,
              visualProof: 90,
              pacing: 90,
              captionQuality: 90,
              branding: 90,
              callToAction: 90,
              professionalReadiness: 90,
            },
            issues: [],
          }),
        }),
      },
    } as never,
    { model: "test-model" },
  );
  const review = await provider.review({
    localVideoPath: "C:/tmp/demo.mp4",
    storyboard: brief,
    telemetry: [],
    expectedDurationSeconds: 45,
  });
  assert.equal(review.status, "pass");
  assert.equal(deleted, 1);
});
