import { z } from "zod";

import type { GeminiClient } from "../integrations/gemini/gemini-client.server.ts";
import { getGeminiModelConfig } from "../integrations/gemini/gemini-client.server.ts";
import { requestStructuredGemini } from "../integrations/gemini/gemini-structured.server.ts";

import type { PublicProductIntelligence } from "./public-product-intelligence";
import type { ProviderRetryEvent } from "./provider-retry.server";

const text = (max: number) => z.string().trim().min(1).max(max);

export const creativeBriefSchema = z.object({
  version: z.literal(1),
  audience: text(300),
  marketingGoal: z.enum(["product-launch", "feature-ad", "social-ad"]),
  corePromise: text(500),
  selectedFeature: z.object({
    publicFeatureId: text(96),
    name: text(160),
    userProblem: text(600),
    userBenefit: text(600),
    whySelected: text(600),
    publicEvidenceUrls: z.array(z.string().url().max(2_048)).min(1).max(12),
  }),
  hook: text(220),
  proofStatement: text(360),
  callToAction: text(220),
  targetDurationSeconds: z.number().int().min(8).max(69),
  captureMode: z.enum(["desktop", "mobile"]),
  demoDataPlan: z.object({
    persona: text(240),
    fictionalIdentity: z.record(z.string().max(500)).default({}),
    requiredEntities: z
      .array(
        z.object({
          type: text(120),
          purpose: text(300),
          fields: z.record(z.union([z.string().max(500), z.number(), z.boolean()])),
        }),
      )
      .max(12),
    privacyRules: z.array(text(300)).min(1).max(12),
  }),
  captureIntent: z.object({
    featureName: text(160),
    desiredStartingState: text(500),
    desiredFinalState: text(500),
    steps: z
      .array(
        z.object({
          id: text(96),
          objective: text(500),
          expectedVisibleResult: text(500),
          importance: z.enum(["essential", "supporting"]),
          maximumDurationSeconds: z.number().int().min(2).max(20),
        }),
      )
      .min(1)
      .max(8),
    proofRequirements: z.array(text(500)).min(1).max(8),
  }),
  captions: z
    .array(z.object({ sceneId: text(96), text: text(220) }))
    .min(2)
    .max(12),
  narration: z.array(z.object({ sceneId: text(96), text: text(300) })).max(12),
});

export type CreativeBrief = z.infer<typeof creativeBriefSchema>;

export const creativeBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "audience",
    "marketingGoal",
    "corePromise",
    "selectedFeature",
    "hook",
    "proofStatement",
    "callToAction",
    "targetDurationSeconds",
    "captureMode",
    "demoDataPlan",
    "captureIntent",
    "captions",
    "narration",
  ],
  properties: {
    version: { type: "integer", enum: [1] },
    audience: { type: "string" },
    marketingGoal: { type: "string", enum: ["product-launch", "feature-ad", "social-ad"] },
    corePromise: { type: "string" },
    hook: { type: "string" },
    proofStatement: { type: "string" },
    callToAction: { type: "string" },
    targetDurationSeconds: { type: "integer", minimum: 8, maximum: 69 },
    captureMode: { type: "string", enum: ["desktop", "mobile"] },
    selectedFeature: {
      type: "object",
      additionalProperties: false,
      required: [
        "publicFeatureId",
        "name",
        "userProblem",
        "userBenefit",
        "whySelected",
        "publicEvidenceUrls",
      ],
      properties: {
        publicFeatureId: { type: "string" },
        name: { type: "string" },
        userProblem: { type: "string" },
        userBenefit: { type: "string" },
        whySelected: { type: "string" },
        publicEvidenceUrls: { type: "array", items: { type: "string" } },
      },
    },
    demoDataPlan: {
      type: "object",
      additionalProperties: false,
      required: ["persona", "fictionalIdentity", "requiredEntities", "privacyRules"],
      properties: {
        persona: { type: "string" },
        fictionalIdentity: { type: "object", additionalProperties: { type: "string" } },
        requiredEntities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "purpose", "fields"],
            properties: {
              type: { type: "string" },
              purpose: { type: "string" },
              fields: {
                type: "object",
                additionalProperties: { type: ["string", "number", "boolean"] },
              },
            },
          },
        },
        privacyRules: { type: "array", items: { type: "string" } },
      },
    },
    captureIntent: {
      type: "object",
      additionalProperties: false,
      required: [
        "featureName",
        "desiredStartingState",
        "desiredFinalState",
        "steps",
        "proofRequirements",
      ],
      properties: {
        featureName: { type: "string" },
        desiredStartingState: { type: "string" },
        desiredFinalState: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "objective",
              "expectedVisibleResult",
              "importance",
              "maximumDurationSeconds",
            ],
            properties: {
              id: { type: "string" },
              objective: { type: "string" },
              expectedVisibleResult: { type: "string" },
              importance: { type: "string", enum: ["essential", "supporting"] },
              maximumDurationSeconds: { type: "integer", minimum: 2, maximum: 20 },
            },
          },
        },
        proofRequirements: { type: "array", items: { type: "string" } },
      },
    },
    captions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sceneId", "text"],
        properties: { sceneId: { type: "string" }, text: { type: "string" } },
      },
    },
    narration: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sceneId", "text"],
        properties: { sceneId: { type: "string" }, text: { type: "string" } },
      },
    },
  },
} as const;

export function defaultCaptureMode(intelligence: PublicProductIntelligence): "desktop" | "mobile" {
  const complexity = intelligence.features.reduce(
    (score, feature) =>
      score + feature.visualDemoPotential + (feature.likelyAuthenticated ? 20 : 0),
    0,
  );
  const publicNarrowEvidence = Boolean(intelligence.screenshots.narrowViewportUrl);
  return publicNarrowEvidence &&
    complexity < 90 &&
    /mobile|phone|on.the.go/i.test(
      `${intelligence.brand.description ?? ""} ${intelligence.valuePropositions.map((value) => value.claim).join(" ")}`,
    )
    ? "mobile"
    : "desktop";
}

function assertBriefEvidence(
  brief: CreativeBrief,
  intelligence: PublicProductIntelligence,
): CreativeBrief {
  const feature = intelligence.features.find(
    (candidate) => candidate.id === brief.selectedFeature.publicFeatureId,
  );
  if (!feature)
    throw new Error("Gemini selected a feature not supported by public product intelligence.");
  const supportedUrls = new Set(feature.publicEvidenceUrls);
  if (
    !brief.selectedFeature.publicEvidenceUrls.every((evidenceUrl) => supportedUrls.has(evidenceUrl))
  ) {
    throw new Error("Gemini selected unsupported feature evidence.");
  }
  const modelText = JSON.stringify(brief);
  if (
    /(selector|queryselector|\[data-|document\.|javascript:|password|credential)/i.test(modelText)
  ) {
    throw new Error("Gemini creative output contained prohibited execution data.");
  }
  const creativeCopy = [
    brief.hook,
    brief.corePromise,
    brief.proofStatement,
    brief.callToAction,
    ...brief.captions.map((caption) => caption.text),
    ...brief.narration.map((line) => line.text),
  ].join("\n");
  if (
    /\b(?:\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|%|percent)|(?:boost|increase|improve|raise|double|triple)\s+(?:your\s+)?(?:ats\s+)?(?:score|rate|chances?|results?|conversion)|guarantee(?:d)?|instant(?:ly)?)\b/i.test(
      creativeCopy,
    )
  ) {
    throw new Error("Gemini creative output contained an unsupported performance claim.");
  }
  return brief;
}

export interface CreativeDirectorProvider {
  createBrief(input: {
    intelligence: PublicProductIntelligence;
    featureBrief?: string | null;
    projectName: string;
    requestedLanguage: "english" | "arabic";
    credentialsAvailable: boolean;
  }): Promise<CreativeBrief>;
}

export class GeminiCreativeDirector implements CreativeDirectorProvider {
  private readonly client: GeminiClient;
  private readonly options: {
    model?: string;
    onProviderEvent?: (event: ProviderRetryEvent) => void;
  };

  constructor(
    client: GeminiClient,
    options: { model?: string; onProviderEvent?: (event: ProviderRetryEvent) => void } = {},
  ) {
    this.client = client;
    this.options = options;
  }

  async createBrief(input: {
    intelligence: PublicProductIntelligence;
    featureBrief?: string | null;
    projectName: string;
    requestedLanguage: "english" | "arabic";
    credentialsAvailable: boolean;
  }): Promise<CreativeBrief> {
    const deterministicMode = defaultCaptureMode(input.intelligence);
    const result = await requestStructuredGemini({
      client: this.client,
      model: this.options.model ?? getGeminiModelConfig().planningModel,
      schema: creativeBriefSchema,
      jsonSchema: creativeBriefJsonSchema,
      systemInstruction:
        "You are WiseDemo's creative director. Select one evidence-supported public feature, write a concise SaaS advertisement plan, keep capture steps semantic, and use fictional data only. In the hook, core promise, proof statement, call to action, captions, and narration, do not use performance metrics, time savings, time estimates, scores, rates, percentages, guarantees, or instant-result claims. Never emit selectors, credentials, code, arbitrary URLs, or destructive operations.",
      task: `Create a ${input.requestedLanguage} SaaS advertisement brief for ${input.projectName}. Credentials available: ${input.credentialsAvailable ? "yes" : "no"}. User feature brief: ${input.featureBrief?.slice(0, 600) || "none"}. Default capture mode is ${deterministicMode}; choose mobile only with strong public mobile evidence.`,
      untrustedProductData: input.intelligence,
      onProviderEvent: this.options.onProviderEvent,
    });
    return assertBriefEvidence(result, input.intelligence);
  }
}
