import assert from "node:assert/strict";
import test from "node:test";

import {
  detectSensitiveContent,
  rankFeatureCandidates,
  scoreMeaningfulStateChange,
} from "./product-intelligence.ts";

test("state-change scoring rejects no-op actions and rewards a visible result", () => {
  const noOp = scoreMeaningfulStateChange(
    {
      url: "https://app.test/a",
      title: "Dashboard",
      summary: "Dashboard Create resume",
      screenshotFingerprint: "a",
    },
    {
      url: "https://app.test/a",
      title: "Dashboard",
      summary: "Dashboard Create resume",
      screenshotFingerprint: "a",
    },
  );
  assert.equal(noOp.meaningful, false);
  const changed = scoreMeaningfulStateChange(
    {
      url: "https://app.test/a",
      title: "Dashboard",
      summary: "Draft resume",
      screenshotFingerprint: "a",
    },
    {
      url: "https://app.test/result",
      title: "Tailored resume",
      summary: "Your resume now matches the role",
      screenshotFingerprint: "b",
    },
  );
  assert.equal(changed.meaningful, true);
  assert.ok(changed.visualChangeScore > 0.6);
});

test("candidate ranking favors confident, visual marketing evidence", () => {
  const candidate = (id: string, confidenceScore: number) =>
    ({
      id,
      confidenceScore,
      marketingValueScore: confidenceScore,
      visualChangeScore: confidenceScore,
    }) as never;
  assert.deepEqual(
    rankFeatureCandidates([candidate("low", 0.3), candidate("high", 0.9)]).map((entry) => entry.id),
    ["high", "low"],
  );
});

test("sensitive-content detection catches credentials and email addresses", () => {
  assert.equal(detectSensitiveContent("hello@example.test"), true);
  assert.equal(detectSensitiveContent("Tailor a resume for this role"), false);
});
