import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWiseResumeIdentityEvidence,
  resolveWiseResumeIdentity,
  wiseResumeAppwriteAccountIdentityExpression,
  wiseResumeScopedAccountControlIdentityExpression,
} from "./wiseresume-identity.server.ts";
import {
  wiseResumeAccountFingerprint,
  wiseResumeLegacyAccountFingerprint,
} from "./wiseresume-account-fingerprint.server.ts";

const normalizedIdentifier = "identity-alpha";

async function evaluatePrimaryFingerprint(identifier: string): Promise<string | null> {
  const expression = wiseResumeAppwriteAccountIdentityExpression();
  const evaluate = new Function("fetch", `return (${expression});`) as (
    fetch: typeof globalThis.fetch,
  ) => Promise<{ liveAccountFingerprint: string | null }>;
  return (await evaluate(async () => new Response(JSON.stringify({ email: identifier }))))
    .liveAccountFingerprint;
}

function evaluateFallbackFingerprint(identifier: string): string | null {
  const expression = wiseResumeScopedAccountControlIdentityExpression();
  const evaluate = new Function("document", `return (${expression});`) as (document: {
    querySelector: () => { getAttribute: () => string };
  }) => {
    liveAccountFingerprint: string | null;
  };
  return evaluate({
    querySelector: () => ({ getAttribute: () => identifier }),
  }).liveAccountFingerprint;
}

test("primary authenticated Appwrite account identity confirms an expected fingerprint", () => {
  const evidence = resolveWiseResumeIdentity({
    expectedAccountFingerprint: "expected-fingerprint",
    primary: { sourceAvailable: true, liveAccountFingerprint: "expected-fingerprint" },
  });
  assert.deepEqual(evidence, {
    source: "appwrite-account",
    sourceAvailable: true,
    authenticatedAccountConfirmed: true,
    confidence: 1,
    mismatchCategory: null,
  });
  assert.equal(classifyWiseResumeIdentityEvidence(evidence), "safe");
});

test("independent scoped control fallback confirms identity only after primary is unavailable", () => {
  const evidence = resolveWiseResumeIdentity({
    expectedAccountFingerprint: "expected-fingerprint",
    primary: { sourceAvailable: false, liveAccountFingerprint: null },
    fallback: { sourceAvailable: true, liveAccountFingerprint: "expected-fingerprint" },
  });
  assert.equal(evidence.source, "scoped-account-control");
  assert.equal(evidence.authenticatedAccountConfirmed, true);
  assert.equal(classifyWiseResumeIdentityEvidence(evidence), "safe");
});

test("a trustworthy mismatched identity is unsafe and unavailable sources are inconclusive", () => {
  const mismatch = resolveWiseResumeIdentity({
    expectedAccountFingerprint: "expected-fingerprint",
    primary: { sourceAvailable: true, liveAccountFingerprint: "other-fingerprint" },
  });
  const unavailable = resolveWiseResumeIdentity({
    expectedAccountFingerprint: "expected-fingerprint",
    primary: { sourceAvailable: false, liveAccountFingerprint: null },
    fallback: { sourceAvailable: false, liveAccountFingerprint: null },
  });
  assert.equal(classifyWiseResumeIdentityEvidence(mismatch), "unsafe");
  assert.equal(classifyWiseResumeIdentityEvidence(unavailable), "inconclusive");
});

test("identity expressions are independent and serialized evidence has no raw identity values", () => {
  const primary = wiseResumeAppwriteAccountIdentityExpression();
  const fallback = wiseResumeScopedAccountControlIdentityExpression();
  assert.match(primary, /\/v1\/account/);
  assert.doesNotMatch(fallback, /\/v1\/account|fetch\(/);
  assert.match(fallback, /\[data-user-email\]/);
  const serialized = JSON.stringify(
    resolveWiseResumeIdentity({
      expectedAccountFingerprint: "expected-fingerprint",
      primary: { sourceAvailable: false, liveAccountFingerprint: null },
      fallback: { sourceAvailable: true, liveAccountFingerprint: "expected-fingerprint" },
    }),
  );
  assert.doesNotMatch(serialized, /fingerprint|email|accountId|name|password|credential|secret/i);
});

test("server and both generated browser identity paths share the canonical fingerprint contract", async () => {
  const expected = wiseResumeAccountFingerprint(normalizedIdentifier);
  assert.equal(
    await evaluatePrimaryFingerprint(`  ${normalizedIdentifier.toUpperCase()}  `),
    expected,
  );
  assert.equal(evaluateFallbackFingerprint(` ${normalizedIdentifier.toUpperCase()} `), expected);
  assert.match(expected, /^wr-account-v1-[\da-f]+$/);
  assert.notEqual(expected, wiseResumeAccountFingerprint("identity-beta"));
});

test("a raw browser hash is classified explicitly as the historic format mismatch", () => {
  const canonical = wiseResumeAccountFingerprint(normalizedIdentifier);
  const legacy = wiseResumeLegacyAccountFingerprint(normalizedIdentifier);
  const rawHash = canonical.replace(/^wr-account-v1-/, "");
  const evidence = resolveWiseResumeIdentity({
    expectedAccountFingerprint: legacy,
    primary: { sourceAvailable: true, liveAccountFingerprint: rawHash },
  });
  assert.equal(evidence.authenticatedAccountConfirmed, false);
  assert.equal(evidence.mismatchCategory, "canonical-format-mismatch");
  assert.equal(classifyWiseResumeIdentityEvidence(evidence), "unsafe");
});

test("a canonical different account remains unsafe and unavailable evidence remains inconclusive", () => {
  const expected = wiseResumeAccountFingerprint(normalizedIdentifier);
  const different = wiseResumeAccountFingerprint("identity-beta");
  const mismatch = resolveWiseResumeIdentity({
    expectedAccountFingerprint: expected,
    primary: { sourceAvailable: true, liveAccountFingerprint: different },
  });
  const unavailable = resolveWiseResumeIdentity({
    expectedAccountFingerprint: expected,
    primary: { sourceAvailable: false, liveAccountFingerprint: null },
  });
  assert.equal(mismatch.mismatchCategory, "confirmed-different-account");
  assert.equal(classifyWiseResumeIdentityEvidence(mismatch), "unsafe");
  assert.equal(unavailable.mismatchCategory, "identity-source-unavailable");
  assert.equal(classifyWiseResumeIdentityEvidence(unavailable), "inconclusive");
});
