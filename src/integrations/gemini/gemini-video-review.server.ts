import { z } from "zod";

import type { CreativeBrief } from "../../lib/creative-director.server.ts";
import type { CaptureEvent } from "../../lib/single-session-director.server.ts";
import { retryProviderCall, type ProviderRetryEvent } from "../../lib/provider-retry.server.ts";

import type { GeminiClient } from "./gemini-client.server.ts";
import { getGeminiModelConfig } from "./gemini-client.server.ts";
import { untrustedProductDataInstruction } from "./gemini-structured.server.ts";

const score = z.number().min(0).max(100);
export const geminiVideoQualityReviewSchema = z.object({
  version: z.literal(1),
  score,
  status: z.enum(["pass", "pass-with-warnings", "fail"]),
  summary: z.string().min(1).max(1_000),
  criteria: z.object({
    hookClarity: score,
    featureClarity: score,
    visualProof: score,
    pacing: score,
    captionQuality: score,
    branding: score,
    callToAction: score,
    professionalReadiness: score,
  }),
  issues: z
    .array(
      z.object({
        id: z.string().min(1).max(96),
        severity: z.enum(["low", "medium", "high"]),
        category: z.enum([
          "weak-hook",
          "unclear-feature",
          "missing-proof",
          "slow-pacing",
          "caption",
          "zoom",
          "loading",
          "visible-error",
          "privacy",
          "branding",
          "cta",
          "other",
        ]),
        sceneId: z.string().max(96).nullable(),
        approximateStartSeconds: z.number().min(0).max(600).nullable(),
        approximateEndSeconds: z.number().min(0).max(600).nullable(),
        description: z.string().min(1).max(1_000),
        recommendedFix: z.enum([
          "rewrite-caption",
          "move-caption",
          "increase-zoom",
          "decrease-zoom",
          "trim-range",
          "speed-range",
          "extend-result-hold",
          "change-intro",
          "change-outro",
          "re-record",
          "manual-review",
        ]),
      }),
    )
    .max(30),
});
export type GeminiVideoQualityReview = z.infer<typeof geminiVideoQualityReviewSchema>;

export const geminiVideoQualityReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "score", "status", "summary", "criteria", "issues"],
  properties: {
    version: { type: "integer", enum: [1] },
    score: { type: "number", minimum: 0, maximum: 100 },
    status: { type: "string", enum: ["pass", "pass-with-warnings", "fail"] },
    summary: { type: "string" },
    criteria: {
      type: "object",
      additionalProperties: false,
      required: [
        "hookClarity",
        "featureClarity",
        "visualProof",
        "pacing",
        "captionQuality",
        "branding",
        "callToAction",
        "professionalReadiness",
      ],
      properties: {
        hookClarity: { type: "number" },
        featureClarity: { type: "number" },
        visualProof: { type: "number" },
        pacing: { type: "number" },
        captionQuality: { type: "number" },
        branding: { type: "number" },
        callToAction: { type: "number" },
        professionalReadiness: { type: "number" },
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "severity",
          "category",
          "sceneId",
          "approximateStartSeconds",
          "approximateEndSeconds",
          "description",
          "recommendedFix",
        ],
        properties: {
          id: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          category: {
            type: "string",
            enum: [
              "weak-hook",
              "unclear-feature",
              "missing-proof",
              "slow-pacing",
              "caption",
              "zoom",
              "loading",
              "visible-error",
              "privacy",
              "branding",
              "cta",
              "other",
            ],
          },
          sceneId: { type: ["string", "null"] },
          approximateStartSeconds: { type: ["number", "null"] },
          approximateEndSeconds: { type: ["number", "null"] },
          description: { type: "string" },
          recommendedFix: {
            type: "string",
            enum: [
              "rewrite-caption",
              "move-caption",
              "increase-zoom",
              "decrease-zoom",
              "trim-range",
              "speed-range",
              "extend-result-hold",
              "change-intro",
              "change-outro",
              "re-record",
              "manual-review",
            ],
          },
        },
      },
    },
  },
} as const;

function stateOf(file: unknown): string {
  return file && typeof file === "object" && "state" in file
    ? String((file as { state?: unknown }).state ?? "")
    : "";
}

export interface VideoReviewProvider {
  review(input: {
    localVideoPath: string;
    storyboard: CreativeBrief;
    telemetry: CaptureEvent[];
    expectedDurationSeconds: number;
  }): Promise<GeminiVideoQualityReview>;
}

export class GeminiVideoReviewProvider implements VideoReviewProvider {
  private readonly client: GeminiClient;
  private readonly options: {
    model?: string;
    sleep?: (milliseconds: number) => Promise<unknown>;
    onWarning?: (message: string) => void;
    onProviderEvent?: (event: ProviderRetryEvent) => void;
  };

  constructor(
    client: GeminiClient,
    options: {
      model?: string;
      sleep?: (milliseconds: number) => Promise<unknown>;
      onWarning?: (message: string) => void;
      onProviderEvent?: (event: ProviderRetryEvent) => void;
    } = {},
  ) {
    this.client = client;
    this.options = options;
  }

  async review(input: {
    localVideoPath: string;
    storyboard: CreativeBrief;
    telemetry: CaptureEvent[];
    expectedDurationSeconds: number;
  }): Promise<GeminiVideoQualityReview> {
    let uploadedName: string | null = null;
    try {
      const uploaded = await retryProviderCall({
        provider: "gemini",
        stage: "video-upload",
        onEvent: this.options.onProviderEvent,
        execute: () =>
          this.client.files.upload({
            file: input.localVideoPath,
            config: { mimeType: "video/mp4" },
          } as never),
      });
      uploadedName =
        typeof (uploaded as { name?: unknown }).name === "string"
          ? (uploaded as { name: string }).name
          : null;
      if (!uploadedName) throw new Error("Gemini did not return an uploaded video name.");
      let active = uploaded;
      const sleep =
        this.options.sleep ??
        ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
      for (let attempt = 0; attempt < 24 && stateOf(active) === "PROCESSING"; attempt += 1) {
        await sleep(5_000);
        active = await this.client.files.get({ name: uploadedName } as never);
      }
      if (stateOf(active) !== "ACTIVE")
        throw new Error(
          `Gemini video processing did not become active (${stateOf(active) || "unknown"}).`,
        );
      const activeFile = active as { uri?: unknown; mimeType?: unknown };
      if (typeof activeFile.uri !== "string")
        throw new Error("Gemini active video did not include a URI.");
      const interaction = await retryProviderCall({
        provider: "gemini",
        stage: "video-review",
        onEvent: this.options.onProviderEvent,
        execute: () =>
          this.client.interactions.create({
            model: this.options.model ?? getGeminiModelConfig().videoReviewModel,
            system_instruction: `${untrustedProductDataInstruction} Review semantic advertisement quality only. Do not claim frame-exact timing and do not expose hidden content.`,
            input: [
              {
                type: "video",
                uri: activeFile.uri,
                mime_type:
                  typeof activeFile.mimeType === "string" ? activeFile.mimeType : "video/mp4",
              },
              {
                type: "text",
                text: JSON.stringify({
                  expectedDurationSeconds: input.expectedDurationSeconds,
                  storyboard: input.storyboard,
                  telemetry: input.telemetry.map(
                    ({ timestampMs, type, expectedResult, resultVerified }) => ({
                      timestampMs,
                      type,
                      expectedResult,
                      resultVerified,
                    }),
                  ),
                }),
              },
            ],
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: geminiVideoQualityReviewJsonSchema,
            },
          } as never),
      });
      const output = (interaction as { output_text?: unknown }).output_text;
      if (typeof output !== "string") throw new Error("Gemini video review returned no JSON.");
      return geminiVideoQualityReviewSchema.parse(JSON.parse(output));
    } finally {
      if (uploadedName) {
        await this.client.files
          .delete({ name: uploadedName } as never)
          .catch(() =>
            this.options.onWarning?.(
              "Gemini video upload cleanup failed; review output was retained.",
            ),
          );
      }
    }
  }
}
