import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  requestStructuredGemini,
  serializeUntrustedProductData,
} from "./gemini-structured.server.ts";

test("structured Gemini output is parsed as JSON and secret-shaped data is redacted", async () => {
  let submitted = "";
  const result = await requestStructuredGemini({
    client: {
      interactions: {
        create: async (value: { input: string }) => {
          submitted = value.input;
          return { output_text: '{"choice":"supported"}' };
        },
      },
    } as never,
    model: "test-model",
    schema: z.object({ choice: z.literal("supported") }),
    jsonSchema: { type: "object" },
    systemInstruction: "Return a choice.",
    task: "Plan.",
    untrustedProductData: {
      feature: "supported",
      password: "never-send",
      nested: { apiKey: "never-send" },
    },
  });
  assert.equal(result.choice, "supported");
  assert.equal(submitted.includes("never-send"), false);
  assert.equal(
    serializeUntrustedProductData({ token: "redact", title: "safe" }).includes("redact"),
    false,
  );
});

test("structured Gemini rejects invalid JSON rather than extracting fenced text", async () => {
  await assert.rejects(() =>
    requestStructuredGemini({
      client: {
        interactions: { create: async () => ({ output_text: "```json\\n{}\\n```" }) },
      } as never,
      model: "test-model",
      schema: z.object({ choice: z.string() }),
      jsonSchema: { type: "object" },
      systemInstruction: "Return JSON.",
      task: "Plan.",
      untrustedProductData: {},
    }),
  );
});
