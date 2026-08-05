import assert from "node:assert/strict";
import test from "node:test";

import { GeminiCreativeDirector } from "./creative-director.server.ts";
import { publicProductIntelligenceSchema } from "./public-product-intelligence.ts";

const intelligence = publicProductIntelligenceSchema.parse({
  version: 1,
  sourceUrl: "https://product.example.test",
  canonicalDomain: "product.example.test",
  analyzedAt: "2026-08-02T00:00:00.000Z",
  brand: {
    name: "Acme",
    description: "A desktop sales workspace",
    slogan: null,
    logoUrl: null,
    primaryLanguage: "en",
    colors: [],
  },
  audience: [],
  valuePropositions: [],
  features: [
    {
      id: "public-sequences",
      name: "Smart sequences",
      description: "Automated outreach",
      userBenefit: "Save time",
      userProblem: "Manual follow-up",
      publicEvidenceUrls: ["https://product.example.test/features"],
      visualDemoPotential: 90,
      marketingPriority: 90,
      likelyAuthenticated: true,
    },
  ],
  useCases: [],
  publicCallsToAction: [],
  visualIdentity: {
    mode: "light",
    accentColors: [],
    backgroundColors: [],
    textColors: [],
    headingFont: null,
    bodyFont: null,
    spacing: {},
    shadows: {},
  },
  screenshots: { desktopUrl: null, narrowViewportUrl: null },
  sourceEvidence: [{ url: "https://product.example.test/features", type: "extract" }],
  warnings: [],
});

const validBrief = {
  version: 1,
  audience: "Sales teams",
  marketingGoal: "feature-ad",
  corePromise: "Turn follow-up into pipeline",
  selectedFeature: {
    publicFeatureId: "public-sequences",
    name: "Smart sequences",
    userProblem: "Manual follow-up",
    userBenefit: "Save time",
    whySelected: "It is visual",
    publicEvidenceUrls: ["https://product.example.test/features"],
  },
  hook: "Follow up without the busywork",
  proofStatement: "Build a sequence from the workspace",
  callToAction: "Start your sequence",
  targetDurationSeconds: 45,
  captureMode: "desktop",
  demoDataPlan: {
    persona: "Fictional seller",
    fictionalIdentity: { name: "Alex Demo" },
    requiredEntities: [],
    privacyRules: ["Use fictional data"],
  },
  captureIntent: {
    featureName: "Smart sequences",
    desiredStartingState: "Dashboard",
    desiredFinalState: "Sequence visible",
    steps: [
      {
        id: "open",
        objective: "Open sequences",
        expectedVisibleResult: "Sequence workspace",
        importance: "essential",
        maximumDurationSeconds: 8,
      },
    ],
    proofRequirements: ["Sequence result visible"],
  },
  captions: [
    { sceneId: "hook", text: "Follow up faster" },
    { sceneId: "proof", text: "Automate the next step" },
  ],
  narration: [],
};

test("creative director accepts only evidence-backed feature plans", async () => {
  const director = new GeminiCreativeDirector(
    {
      interactions: {
        create: async () => ({
          output_text: JSON.stringify(validBrief),
        }),
      },
    } as never,
    { model: "test-model" },
  );
  const brief = await director.createBrief({
    intelligence,
    projectName: "Acme",
    requestedLanguage: "english",
    credentialsAvailable: true,
  });
  assert.equal(brief.selectedFeature.publicFeatureId, "public-sequences");
  assert.equal(brief.captureMode, "desktop");
});

test("creative director rejects unsupported performance claims", async () => {
  const director = new GeminiCreativeDirector(
    {
      interactions: {
        create: async () => ({
          output_text: JSON.stringify({
            ...validBrief,
            corePromise: "Boost your ATS score by 50% in 30 seconds.",
          }),
        }),
      },
    } as never,
    { model: "test-model" },
  );

  await assert.rejects(
    director.createBrief({
      intelligence,
      projectName: "Acme",
      requestedLanguage: "english",
      credentialsAvailable: true,
    }),
    /unsupported performance claim/,
  );
});
