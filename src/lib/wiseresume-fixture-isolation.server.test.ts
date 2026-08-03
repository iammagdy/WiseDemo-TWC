import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWiseResumeFinalVisibleContentSafe,
  assertWiseResumeFixtureCreationAllowed,
  assertWiseResumeFixtureMutationAllowed,
  createWiseResumeFixtureIsolationAudit,
  createWiseResumeFixtureReference,
  migrateLegacyWiseResumeFixtureReference,
  parseWiseResumeFixtureReference,
  serializeWiseResumeFixtureReference,
  wiseResumeAccountFingerprint,
} from "./wiseresume-fixture-isolation.server.ts";
import {
  evaluateWiseResumeFixtureViewportSafety,
  wiseResumeFixtureRouteExpression,
  wiseResumeFixtureWriteExpression,
} from "./product-adapters/wiseresume.server.ts";
import { wiseResumeLegacyAccountFingerprint } from "./wiseresume-account-fingerprint.server.ts";

const accountFingerprint = wiseResumeAccountFingerprint("demo-user@test.example");
const fixture = createWiseResumeFixtureReference({
  accountFingerprint,
  resumeRecordId: "fixture-resume-1",
  createdByWiseDemo: true,
  lastValidatedAt: "2026-08-02T00:00:00.000Z",
});

test("an empty account is safe for a newly created WiseDemo fixture", () => {
  const audit = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 0,
    fixtureRecordIds: [],
    storedFixture: null,
    privacyShieldActive: true,
  });
  assert.equal(audit.status, "safe");
  assert.equal(audit.mode, "empty-account");
  assert.doesNotThrow(() => assertWiseResumeFixtureCreationAllowed(audit));
});

test("existing non-fixture resumes coexist without authorizing a broad mutation", () => {
  const audit = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 4,
    fixtureRecordIds: [fixture.resumeRecordId],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  assert.equal(audit.status, "safe");
  assert.equal(audit.mode, "fixture-isolation");
  assert.equal(audit.nonFixtureResumeCount, 3);
  assert.doesNotThrow(() =>
    assertWiseResumeFixtureMutationAllowed({
      audit,
      fixture,
      targetResumeId: fixture.resumeRecordId,
      operation: "prepare fixture resume",
    }),
  );
  assert.throws(
    () =>
      assertWiseResumeFixtureMutationAllowed({
        audit,
        fixture,
        targetResumeId: "existing-resume-2",
        operation: "prepare fixture resume",
      }),
    /non-fixture/,
  );
});

test("fixture conflicts and unresolved identity cannot unlock mutation", () => {
  const ambiguous = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 2,
    fixtureRecordIds: [fixture.resumeRecordId, "fixture-resume-2"],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  const unresolved = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: false,
    totalResumeCount: 1,
    fixtureRecordIds: [fixture.resumeRecordId],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  assert.equal(ambiguous.status, "unsafe");
  assert.equal(unresolved.status, "inconclusive");
  assert.throws(() => assertWiseResumeFixtureCreationAllowed(ambiguous));
  assert.throws(() => assertWiseResumeFixtureCreationAllowed(unresolved));
});

test("legacy fixture fingerprints parse safely and migrate only after canonical identity confirmation", () => {
  const legacy = {
    ...serializeWiseResumeFixtureReference(fixture),
    accountFingerprint: wiseResumeLegacyAccountFingerprint("demo-user@test.example"),
  };
  const parsed = parseWiseResumeFixtureReference(legacy);
  assert.equal(parsed?.accountFingerprintFormat, "legacy-v0");
  assert.equal(
    migrateLegacyWiseResumeFixtureReference({
      reference: parsed!,
      authenticatedAccountConfirmed: false,
      expectedAccountFingerprint: accountFingerprint,
      legacyExpectedAccountFingerprint: legacy.accountFingerprint,
    }),
    null,
  );
  const migrated = migrateLegacyWiseResumeFixtureReference({
    reference: parsed!,
    authenticatedAccountConfirmed: true,
    expectedAccountFingerprint: accountFingerprint,
    legacyExpectedAccountFingerprint: legacy.accountFingerprint,
  });
  assert.equal(migrated?.accountFingerprint, accountFingerprint);
  assert.equal(migrated?.accountFingerprintFormat, "canonical-v1");
  assert.equal(migrated?.fixtureSignature, fixture.fixtureSignature);
  assert.equal(migrated?.resumeRecordId, fixture.resumeRecordId);
});

test("fixture mutation rejects missing, broad, or destructive targets", () => {
  const audit = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 1,
    fixtureRecordIds: [fixture.resumeRecordId],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  for (const [targetResumeId, operation] of [
    [null, "prepare fixture resume"],
    [fixture.resumeRecordId, "use latest resume"],
    [fixture.resumeRecordId, "delete fixture resume"],
  ] as const) {
    assert.throws(() =>
      assertWiseResumeFixtureMutationAllowed({ audit, fixture, targetResumeId, operation }),
    );
  }
});

test("references remain account-scoped and serialized output excludes content and credentials", () => {
  const serialized = JSON.stringify(serializeWiseResumeFixtureReference(fixture));
  assert.deepEqual(parseWiseResumeFixtureReference(JSON.parse(serialized)), fixture);
  assert.doesNotMatch(serialized, /body|title|email|password|credential|secret/i);
  assert.notEqual(accountFingerprint, wiseResumeAccountFingerprint("another-user@test.example"));
});

test("fixture route expression declares each helper before it is used", () => {
  const expression = wiseResumeFixtureRouteExpression("fixture-resume-1");
  assert.doesNotThrow(() => new Function(expression));
  assert.ok(
    expression.indexOf("const elementText") < expression.indexOf("elementText(entry.element)"),
  );
  assert.ok(expression.indexOf("const cssPath") < expression.indexOf("cssPath(create)"));
  assert.match(expression, /fixtureSelector/);
  assert.match(expression, /aria-label='New Resume'/);
  assert.doesNotMatch(expression, /username|password|credential|secret/i);
});

test("fixture write expression writes a stable WiseDemo marker without account-wide fields", () => {
  const expression = wiseResumeFixtureWriteExpression({
    fixtureRecordId: fixture.resumeRecordId,
    fixtureDocument: "[WiseDemo Fixture] Smart Tailoring Demo\nFictional resume content",
  });
  assert.doesNotThrow(() => new Function(expression));
  assert.match(expression, /fixtureMarker/);
  assert.match(expression, /markerWritten/);
  assert.doesNotMatch(expression, /account.*profile|password|credential|secret/i);
});

test("final capture safety requires only the isolated fixture in the viewport", () => {
  const safeViewport = evaluateWiseResumeFixtureViewportSafety({
    activeRecordId: fixture.resumeRecordId,
    fixture,
    fixtureMarkerVisible: true,
    unrelatedResumeTitlesVisible: false,
    accountEmailVisible: false,
    personalDataVisible: false,
  });
  assert.doesNotThrow(() => assertWiseResumeFinalVisibleContentSafe(safeViewport));
  assert.throws(() =>
    assertWiseResumeFinalVisibleContentSafe(
      evaluateWiseResumeFixtureViewportSafety({
        activeRecordId: fixture.resumeRecordId,
        fixture,
        fixtureMarkerVisible: false,
        unrelatedResumeTitlesVisible: true,
        accountEmailVisible: false,
        personalDataVisible: false,
      }),
    ),
  );
  assert.throws(() =>
    assertWiseResumeFinalVisibleContentSafe(
      evaluateWiseResumeFixtureViewportSafety({
        activeRecordId: "wrong-record",
        fixture,
        fixtureMarkerVisible: true,
        unrelatedResumeTitlesVisible: false,
        accountEmailVisible: false,
        personalDataVisible: false,
      }),
    ),
  );
});

test("a rejected non-fixture target leaves the fixture reference and external records unchanged", () => {
  const audit = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 2,
    fixtureRecordIds: [fixture.resumeRecordId],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  const existingRecordIds = Object.freeze([fixture.resumeRecordId, "existing-record"]);
  assert.throws(() =>
    assertWiseResumeFixtureMutationAllowed({
      audit,
      fixture,
      targetResumeId: "existing-record",
      operation: "prepare fixture resume",
    }),
  );
  assert.deepEqual(existingRecordIds, [fixture.resumeRecordId, "existing-record"]);
});
