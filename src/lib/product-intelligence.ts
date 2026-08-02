import { z } from "zod";

const idSchema = z.string().min(1).max(96);
const urlSchema = z.string().url().max(2048);

export const featureEvidenceSchema = z.object({
  type: z.enum(["screenshot", "dom", "url", "text", "network", "state-diff", "successful-action"]),
  value: z.string().min(1).max(4096),
  timestamp: z.number().int().positive().optional(),
  sensitive: z.boolean().optional(),
});

export const plannedBrowserActionSchema = z.object({
  id: idSchema,
  type: z.enum(["goto", "click", "type", "scroll", "wait"]),
  label: z.string().min(1).max(180),
  url: urlSchema.optional(),
  selector: z.string().min(1).max(500).optional(),
  text: z.string().max(300).optional(),
  deltaY: z.number().min(-10_000).max(10_000).optional(),
  waitMs: z.number().int().min(0).max(30_000).optional(),
  expectedResult: z.string().max(400).optional(),
  expectedSelector: z.string().max(500).optional(),
  expectedUrlIncludes: z.string().max(300).optional(),
  zoomTarget: z
    .object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().min(0),
      height: z.number().min(0),
    })
    .optional(),
});

export const discoveredActionSchema = plannedBrowserActionSchema.extend({
  status: z.enum(["successful", "no-change", "failed", "unsafe", "unverified"]),
  requiredState: z.string().max(400),
  beforeStateId: idSchema.optional(),
  afterStateId: idSchema.optional(),
  visualChangeScore: z.number().min(0).max(1),
  semanticChangeScore: z.number().min(0).max(1),
  reliabilityScore: z.number().min(0).max(1),
  evidence: z.array(featureEvidenceSchema).max(16),
});

export const productPageSchema = z.object({
  id: idSchema,
  url: urlSchema,
  title: z.string().max(180),
  headings: z.array(z.string().max(180)).max(30),
  navigationLabels: z.array(z.string().max(120)).max(40),
  buttonLabels: z.array(z.string().max(160)).max(40),
  inputs: z.array(z.string().max(160)).max(30),
  visibleSummary: z.string().max(4000),
  stateId: idSchema,
  sensitiveContentDetected: z.boolean(),
  evidence: z.array(featureEvidenceSchema).max(24),
});

export const productWorkflowSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(180),
  description: z.string().min(1).max(600),
  entryUrl: urlSchema,
  actionIds: z.array(idSchema).min(1).max(16),
  expectedResult: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  evidence: z.array(featureEvidenceSchema).max(24),
});

export const featureCandidateSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(180),
  description: z.string().min(1).max(600),
  userProblem: z.string().min(1).max(500),
  userBenefit: z.string().min(1).max(500),
  requiredState: z.string().min(1).max(400),
  entryUrl: urlSchema,
  actions: z.array(discoveredActionSchema).min(1).max(16),
  expectedResult: z.string().min(1).max(500),
  visualChangeScore: z.number().min(0).max(1),
  marketingValueScore: z.number().min(0).max(1),
  reliabilityScore: z.number().min(0).max(1),
  confidenceScore: z.number().min(0).max(1),
  estimatedDurationSeconds: z.number().min(3).max(60),
  requiredPreparation: z.array(z.string().max(240)).max(12),
  evidence: z.array(featureEvidenceSchema).min(1).max(40),
});

export const productIntelligenceSchema = z.object({
  version: z.literal(2),
  productName: z.string().min(1).max(180),
  productCategory: z.string().min(1).max(160),
  probableAudience: z.array(z.string().min(1).max(160)).min(1).max(12),
  valuePropositions: z
    .array(
      z.object({
        statement: z.string().min(1).max(360),
        evidence: z.array(featureEvidenceSchema).max(12),
      }),
    )
    .max(12),
  pages: z.array(productPageSchema).min(1).max(40),
  workflows: z.array(productWorkflowSchema).max(32),
  featureCandidates: z.array(featureCandidateSchema).max(32),
  globalConfidence: z.number().min(0).max(1),
  generatedAt: z.string().datetime(),
});

export const storySceneSchema = z.object({
  id: idSchema,
  purpose: z.enum(["hook", "problem", "setup", "action", "transformation", "proof", "cta"]),
  headline: z.string().min(1).max(180),
  narration: z.string().max(480),
  caption: z.string().min(1).max(220),
  visualObjective: z.string().min(1).max(500),
  startingState: z.string().min(1).max(400),
  actions: z.array(plannedBrowserActionSchema).max(12),
  expectedResult: z.string().min(1).max(500),
  maxDurationSeconds: z.number().min(1).max(20),
  zoomTarget: z.object({ x: z.number().min(0), y: z.number().min(0) }).optional(),
  transition: z.string().max(80).optional(),
});

export const demoStoryboardSchema = z.object({
  version: z.literal(2),
  title: z.string().min(1).max(180),
  targetAudience: z.string().min(1).max(240),
  corePromise: z.string().min(1).max(500),
  format: z.enum(["launch", "feature", "teaser", "before-after", "tutorial"]),
  targetDurationSeconds: z.number().min(30).max(60),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  featureCandidateId: idSchema,
  scenes: z.array(storySceneSchema).min(4).max(12),
  revision: z.number().int().min(1).max(10),
  generatedAt: z.string().datetime(),
});

export const demoSceneCaptureSchema = z.object({
  sceneId: idSchema,
  sequence: z.number().int().min(0).max(100),
  status: z.enum(["planned", "captured", "failed", "skipped"]),
  sourceStartSeconds: z.number().min(0).max(86_400).nullable(),
  sourceDurationSeconds: z.number().min(0).max(60).nullable(),
  retryCount: z.number().int().min(0).max(5),
  actionLog: z
    .array(
      z.object({
        actionId: idSchema,
        status: z.enum(["successful", "failed", "skipped"]),
        startedAt: z.number().int().positive().optional(),
        completedAt: z.number().int().positive().optional(),
        cursor: z.object({ x: z.number(), y: z.number() }).optional(),
        message: z.string().max(500),
      }),
    )
    .max(32),
  evidence: z.array(featureEvidenceSchema).max(24),
  failureReason: z.string().max(1000).nullable(),
});

export const videoQualityReviewSchema = z.object({
  score: z.number().min(0).max(100),
  status: z.enum(["pass", "pass-with-warnings", "fail"]),
  analysisMethod: z.enum(["storyboard-and-capture-metadata", "key-frame-evidence"]),
  issues: z
    .array(
      z.object({
        code: z.string().min(1).max(96),
        severity: z.enum(["info", "warning", "error"]),
        message: z.string().min(1).max(600),
        sceneId: idSchema.optional(),
      }),
    )
    .max(64),
  recommendedChanges: z
    .array(
      z.object({
        action: z.string().min(1).max(160),
        reason: z.string().min(1).max(600),
        sceneId: idSchema.optional(),
      }),
    )
    .max(32),
  reviewedAt: z.string().datetime(),
});

export type FeatureEvidence = z.infer<typeof featureEvidenceSchema>;
export type PlannedBrowserAction = z.infer<typeof plannedBrowserActionSchema>;
export type DiscoveredAction = z.infer<typeof discoveredActionSchema>;
export type ProductPage = z.infer<typeof productPageSchema>;
export type ProductWorkflow = z.infer<typeof productWorkflowSchema>;
export type FeatureCandidate = z.infer<typeof featureCandidateSchema>;
export type ProductIntelligence = z.infer<typeof productIntelligenceSchema>;
export type StoryScene = z.infer<typeof storySceneSchema>;
export type DemoStoryboard = z.infer<typeof demoStoryboardSchema>;
export type DemoSceneCapture = z.infer<typeof demoSceneCaptureSchema>;
export type VideoQualityReview = z.infer<typeof videoQualityReviewSchema>;

export function detectSensitiveContent(value: string): boolean {
  return /(?:\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b|\b(?:\d[ -]*?){13,16}\b|\b(?:password|api[_ -]?key|secret|access token)\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i.test(
    value,
  );
}

export function summarizeDomState(input: {
  url: string;
  title: string;
  headings: string[];
  buttonLabels: string[];
  visibleText: string;
}): string {
  return [input.url, input.title, ...input.headings, ...input.buttonLabels, input.visibleText]
    .join(" | ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export function scoreMeaningfulStateChange(
  before: { url: string; title: string; summary: string; screenshotFingerprint?: string | null },
  after: { url: string; title: string; summary: string; screenshotFingerprint?: string | null },
) {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const beforeWords = new Set(
    normalize(before.summary)
      .split(/[^a-z0-9]+/i)
      .filter((word) => word.length > 2),
  );
  const afterWords = new Set(
    normalize(after.summary)
      .split(/[^a-z0-9]+/i)
      .filter((word) => word.length > 2),
  );
  const union = new Set([...beforeWords, ...afterWords]);
  const overlap = [...beforeWords].filter((word) => afterWords.has(word)).length;
  const semantic = union.size ? Math.max(0, Math.min(1, 1 - overlap / union.size)) : 0;
  const routeChanged = before.url !== after.url ? 1 : 0;
  const titleChanged = before.title !== after.title ? 0.45 : 0;
  const screenshotChanged =
    before.screenshotFingerprint &&
    after.screenshotFingerprint &&
    before.screenshotFingerprint !== after.screenshotFingerprint
      ? 0.65
      : 0;
  const visualChangeScore = Math.max(routeChanged, titleChanged, screenshotChanged, semantic * 0.8);
  return {
    semanticChangeScore: Number(semantic.toFixed(3)),
    visualChangeScore: Number(Math.min(1, visualChangeScore).toFixed(3)),
    meaningful: routeChanged === 1 || visualChangeScore >= 0.22 || semantic >= 0.18,
  };
}

export function scoreFeatureCandidate(input: {
  action: Pick<
    DiscoveredAction,
    "visualChangeScore" | "semanticChangeScore" | "reliabilityScore" | "label"
  >;
  requiredPreparationCount: number;
  hasProof: boolean;
  sensitive: boolean;
}) {
  const marketingSignal =
    /tailor|match|improve|generate|create|export|publish|analy[sz]e|automate|optimi[sz]e|share|transform/i.test(
      input.action.label,
    )
      ? 0.92
      : 0.56;
  const proof = input.hasProof ? 0.16 : -0.18;
  const setupPenalty = Math.min(0.22, input.requiredPreparationCount * 0.045);
  const sensitivePenalty = input.sensitive ? 0.42 : 0;
  const score =
    input.action.visualChangeScore * 0.3 +
    input.action.semanticChangeScore * 0.18 +
    input.action.reliabilityScore * 0.26 +
    marketingSignal * 0.26 +
    proof -
    setupPenalty -
    sensitivePenalty;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

export function rankFeatureCandidates(candidates: FeatureCandidate[]): FeatureCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftScore =
      left.confidenceScore * 0.45 + left.marketingValueScore * 0.35 + left.visualChangeScore * 0.2;
    const rightScore =
      right.confidenceScore * 0.45 +
      right.marketingValueScore * 0.35 +
      right.visualChangeScore * 0.2;
    return rightScore - leftScore;
  });
}

export function parseProductIntelligence(value: unknown): ProductIntelligence {
  return productIntelligenceSchema.parse(value);
}

export function parseDemoStoryboard(value: unknown): DemoStoryboard {
  return demoStoryboardSchema.parse(value);
}

export function parseDemoSceneCapture(value: unknown): DemoSceneCapture {
  return demoSceneCaptureSchema.parse(value);
}

export function parseVideoQualityReview(value: unknown): VideoQualityReview {
  return videoQualityReviewSchema.parse(value);
}
