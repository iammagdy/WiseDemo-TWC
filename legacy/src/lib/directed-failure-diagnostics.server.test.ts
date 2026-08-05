import assert from "node:assert/strict";
import test from "node:test";

import {
  createDirectedFailureDiagnosticPersister,
  readDirectedFailureDiagnostics,
} from "./directed-failure-diagnostics.server.ts";
import {
  assertLiveAccountMutationAllowed,
  type LiveAccountSafetyAudit,
} from "./live-account-safety.server.ts";

const demoId = "6f1e0d9a-1111-2222-3333-00000000f329";

function audit(status: LiveAccountSafetyAudit["status"]): LiveAccountSafetyAudit {
  return {
    status,
    mode: "fixture-isolation",
    authenticatedAccountConfirmed: false,
    totalResumeCount: 0,
    fixtureResumeCount: 0,
    nonFixtureResumeCount: 0,
    fixtureIsolated: false,
    privacyShieldActive: true,
    mutationScopeLockedToFixture: false,
    personalDataMarkersFound: false,
    reasons: ["Authenticated account identity could not be confirmed."],
    auditedAt: "2026-08-03T00:00:00.000Z",
  };
}

function createFakePersister() {
  const artifacts: Array<Record<string, unknown>> = [];
  return {
    artifacts,
    persister: createDirectedFailureDiagnosticPersister({
      repository: {
        createDirectorArtifact: async (artifact) => {
          artifacts.push(artifact);
          return artifact as never;
        },
      },
      projectId: "project-1",
      demoId,
      auditCacheKey: "live-account-safety:test",
      authenticatedMapState: "pending-live-account-safety-audit",
    }),
  };
}

test("directed failure diagnostics retain safe audit, checkpoint, identity, and event evidence", async () => {
  const diagnostics = await readDirectedFailureDiagnostics(
    {
      getDemo: async () => ({
        id: demoId,
        project_id: "project-1",
        status: "failed",
        steel_session_id: "cafa1234-1111-2222-3333-00000000fdda",
        error_code: "DIRECTOR_CAPTURE_FAILED",
      }),
      listDirectorArtifacts: async () => [
        {
          id: "artifact-audit",
          project_id: "project-1",
          demo_id: demoId,
          artifact_kind: "live-account-safety-audit",
          cache_key: "audit",
          status: "ready",
          payload_json: {
            audit: {
              status: "inconclusive",
              mode: "fixture-isolation",
              authenticatedAccountConfirmed: false,
              identityEvidence: {
                source: "unavailable",
                sourceAvailable: false,
                authenticatedAccountConfirmed: false,
                confidence: 0,
                mismatchCategory: "identity-source-unavailable",
              },
              inventoryRequestEvidence: {
                source: "appwrite-resumes",
                sourceAvailable: true,
                inventoryResolved: false,
                countEstablished: false,
                requestStatus: "invalid-query",
                httpStatusClass: "4xx",
                domFallbackResolved: false,
              },
              totalResumeCount: null,
              fixtureResumeCount: null,
              nonFixtureResumeCount: null,
              fixtureIsolated: false,
              privacyShieldActive: true,
              mutationScopeLockedToFixture: false,
              personalDataMarkersFound: false,
              reasons: ["Identity sources were unavailable."],
            },
          },
          expires_at: null,
          provider: "wisedemo",
          model: null,
          duration_ms: null,
          revision: 1,
          failure_reason: null,
          created_at: "2026-08-03T00:00:00.000Z",
          updated_at: "2026-08-03T00:00:00.000Z",
        },
        {
          id: "artifact-checkpoints",
          project_id: "project-1",
          demo_id: demoId,
          artifact_kind: "privacy-shield-checkpoints",
          cache_key: "checkpoints",
          status: "ready",
          payload_json: [
            { checkpoint: "after-session-creation", active: true, repaired: false, timestampMs: 1 },
            { checkpoint: "before-account-audit", active: true, repaired: true, timestampMs: 2 },
          ],
          expires_at: null,
          provider: "wisedemo",
          model: null,
          duration_ms: null,
          revision: 2,
          failure_reason: null,
          created_at: "2026-08-03T00:00:01.000Z",
          updated_at: "2026-08-03T00:00:01.000Z",
        },
        {
          id: "artifact-identity",
          project_id: "project-1",
          demo_id: demoId,
          artifact_kind: "identity-source-attempts",
          cache_key: "identity",
          status: "ready",
          payload_json: [
            {
              source: "appwrite-account",
              sourceAvailable: false,
              authenticatedAccountConfirmed: false,
              confidence: 0,
              mismatchCategory: "identity-source-unavailable",
            },
            {
              source: "scoped-account-control",
              sourceAvailable: true,
              authenticatedAccountConfirmed: true,
              confidence: 0.84,
              mismatchCategory: null,
            },
          ],
          expires_at: null,
          provider: "wisedemo",
          model: null,
          duration_ms: null,
          revision: 2,
          failure_reason: null,
          created_at: "2026-08-03T00:00:02.000Z",
          updated_at: "2026-08-03T00:00:02.000Z",
        },
      ],
      listDemoEvents: async () => [
        {
          id: "event-1",
          demo_id: demoId,
          level: "error",
          step: "DIRECTOR_CAPTURE_FAILED",
          message: "Failure for person@example.com and 123e4567-e89b-12d3-a456-426614174000",
          created_at: "2026-08-03T00:00:03.000Z",
        },
      ],
    },
    demoId,
  );

  assert.equal(diagnostics.demo.id, "6f1e…f329");
  assert.equal(diagnostics.demo.steelSessionId, "cafa…fdda");
  assert.equal(diagnostics.audit.status, "inconclusive");
  assert.equal(diagnostics.audit.identityEvidence.sourceAvailable, false);
  assert.equal(diagnostics.audit.identityEvidence.mismatchCategory, "identity-source-unavailable");
  assert.deepEqual(diagnostics.audit.inventoryRequestEvidence, {
    source: "appwrite-resumes",
    sourceAvailable: true,
    inventoryResolved: false,
    countEstablished: false,
    requestStatus: "invalid-query",
    httpStatusClass: "4xx",
    domFallbackResolved: false,
  });
  assert.equal(diagnostics.checkpoints.items.length, 2);
  assert.deepEqual(
    diagnostics.identityAttempts.map((attempt) => attempt.source),
    ["appwrite-account", "scoped-account-control"],
  );
  assert.doesNotMatch(JSON.stringify(diagnostics), /person@example\.com|123e4567/);
});

test("unsafe and inconclusive audits persist before mutation assertion stops the flow", async () => {
  for (const status of ["unsafe", "inconclusive"] as const) {
    const { artifacts, persister } = createFakePersister();
    const persistedAudit = audit(status);
    persistedAudit.reasons = [
      "Identity test@example.com did not match 123e4567-e89b-12d3-a456-426614174000.",
    ];
    await persister.persistAudit(persistedAudit);
    assert.throws(() => assertLiveAccountMutationAllowed(audit(status)));
    assert.equal(artifacts.at(-1)?.artifact_kind, "live-account-safety-audit");
    assert.doesNotMatch(JSON.stringify(artifacts), /test@example\.com|123e4567/);
  }
});

test("privacy checkpoint snapshots remain after login and shield-restoration failures", async () => {
  for (const checkpoint of ["after-login-submission", "after-authenticated-redirect"]) {
    const { artifacts, persister } = createFakePersister();
    await persister.persistCheckpoint({
      checkpoint,
      active: checkpoint !== "after-authenticated-redirect",
      repaired: false,
      timestampMs: 1,
    });
    await assert.rejects(async () => {
      throw new Error("navigation stopped");
    });
    const payload = artifacts.at(-1)?.payload_json as Array<{ checkpoint: string }>;
    assert.equal(payload[0]?.checkpoint, checkpoint);
  }
});

test("primary and fallback identity attempts persist independently without identity values", async () => {
  const { artifacts, persister } = createFakePersister();
  await persister.persistIdentityAttempt({
    source: "appwrite-account",
    sourceAvailable: false,
    authenticatedAccountConfirmed: false,
    confidence: 0,
    mismatchCategory: "identity-source-unavailable",
  });
  await persister.persistIdentityAttempt({
    source: "scoped-account-control",
    sourceAvailable: true,
    authenticatedAccountConfirmed: true,
    confidence: 0.84,
    mismatchCategory: null,
  });
  const payload = artifacts.at(-1)?.payload_json as Array<{ source: string }>;
  assert.deepEqual(
    payload.map((attempt) => attempt.source),
    ["appwrite-account", "scoped-account-control"],
  );
  assert.doesNotMatch(JSON.stringify(artifacts), /fingerprint|resumeRecordId|@/i);
});

test("failure diagnostic persistence does not create sessions or mutate a product", async () => {
  const counters = { sessions: 0, mutations: 0, released: 0 };
  const { persister } = createFakePersister();
  await persister.persistCheckpoint({
    checkpoint: "before-account-audit",
    active: true,
    repaired: false,
    timestampMs: 1,
  });
  await persister.persistAudit(audit("inconclusive"));
  counters.released += 1;
  assert.deepEqual(counters, { sessions: 0, mutations: 0, released: 1 });
});

test("failure persistence saves each checkpoint, identity attempt, and audit before release paths", async () => {
  const { artifacts, persister } = createFakePersister();
  await persister.persistCheckpoint({
    checkpoint: "after-login-page-load",
    active: true,
    repaired: true,
    timestampMs: 1,
  });
  await persister.persistIdentityAttempt({
    source: "appwrite-account",
    sourceAvailable: false,
    authenticatedAccountConfirmed: false,
    confidence: 0,
    mismatchCategory: "identity-source-unavailable",
  });
  await persister.persistAudit(audit("inconclusive"));
  assert.deepEqual(
    artifacts.map((artifact) => (artifact as { artifact_kind: string }).artifact_kind),
    ["privacy-shield-checkpoints", "identity-source-attempts", "live-account-safety-audit"],
  );
  assert.doesNotMatch(JSON.stringify(artifacts), /fingerprint|resumeRecordId|@/i);
});
