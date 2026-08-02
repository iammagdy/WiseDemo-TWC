import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveAccountSafetyError,
  assertLiveAccountMutationAllowed,
  classifyAuthenticatedMap,
  preSessionSafetyState,
  serializeLiveAccountSafetyAudit,
  type LiveAccountSafetyAudit,
} from "./live-account-safety.server.ts";

const safeAudit: LiveAccountSafetyAudit = {
  status: "safe",
  authenticatedAccountConfirmed: true,
  resumeCount: 0,
  fixtureResumeCount: 0,
  nonFixtureResumeCount: 0,
  personalDataMarkersFound: false,
  reasons: [],
  auditedAt: "2026-08-02T00:00:00.000Z",
};

test("newer credentials make an old authenticated map stale rather than unsafe", () => {
  const state = classifyAuthenticatedMap({
    credentialSavedAt: "2026-08-02T00:01:00.000Z",
    authenticatedMapUpdatedAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(state, "stale");
  assert.equal(preSessionSafetyState(state), "pending-live-account-safety-audit");
});

test("safe empty and fixture-only accounts unlock only the fictional mutation path", () => {
  assert.doesNotThrow(() => assertLiveAccountMutationAllowed(safeAudit));
  assert.doesNotThrow(() =>
    assertLiveAccountMutationAllowed({ ...safeAudit, resumeCount: 1, fixtureResumeCount: 1 }),
  );
});

test("unsafe, personal-data, and inconclusive audits reject mutation", () => {
  const unsafe = { ...safeAudit, status: "unsafe" as const, nonFixtureResumeCount: 1 };
  const personal = { ...safeAudit, status: "unsafe" as const, personalDataMarkersFound: true };
  const inconclusive = {
    ...safeAudit,
    status: "inconclusive" as const,
    authenticatedAccountConfirmed: false,
  };
  for (const audit of [unsafe, personal, inconclusive]) {
    assert.throws(() => assertLiveAccountMutationAllowed(audit), LiveAccountSafetyError);
  }
});

test("sanitized audit persistence excludes body and credential fields", () => {
  const serialized = JSON.stringify(
    serializeLiveAccountSafetyAudit({ ...safeAudit, reasons: ["No visible non-fixture records."] }),
  );
  assert.doesNotMatch(serialized, /resumeBody|username|password|credential|secret/i);
  assert.match(serialized, /"status":"safe"/);
});
