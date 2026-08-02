import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWiseResumeIdentityEvidence,
  resolveWiseResumeIdentity,
  wiseResumeAppwriteAccountIdentityExpression,
  wiseResumeScopedAccountControlIdentityExpression,
} from "./wiseresume-identity.server.ts";

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
