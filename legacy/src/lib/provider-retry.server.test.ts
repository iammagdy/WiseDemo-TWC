import assert from "node:assert/strict";
import test from "node:test";

import { retryProviderCall } from "./provider-retry.server.ts";

test("provider retries honor Retry-After without recording payloads", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await retryProviderCall({
    provider: "context",
    stage: "public-extract",
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    execute: async () => {
      attempts += 1;
      if (attempts === 1) throw { status: 429, headers: { "retry-after": "2" } };
      return "ok";
    },
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2_000]);
});

test("provider does not retry invalid authentication", async () => {
  let attempts = 0;
  await assert.rejects(() =>
    retryProviderCall({
      provider: "gemini",
      stage: "planning",
      execute: async () => {
        attempts += 1;
        throw { status: 401 };
      },
    }),
  );
  assert.equal(attempts, 1);
});
