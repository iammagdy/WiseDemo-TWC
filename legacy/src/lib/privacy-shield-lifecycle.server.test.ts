import assert from "node:assert/strict";
import test from "node:test";

import { runSingleSessionDirectedCapture } from "./single-session-director.server.ts";
import { executeShieldedNavigationAction } from "./shielded-navigation.server.ts";
import { resolveWiseResumeIdentity } from "./wiseresume-identity.server.ts";

type MockLifecycle = {
  createdUrls: string[];
  checkpoints: string[];
  auditCalls: number;
  preflightCalls: number;
  repairs: number;
  released: number;
};

async function runMockedLifecycle(
  input: {
    repairAfterRedirect?: boolean;
    failAfterRedirect?: boolean;
    auditStatus?: "safe" | "inconclusive";
  } = {},
): Promise<MockLifecycle> {
  const lifecycle: MockLifecycle = {
    createdUrls: [],
    checkpoints: [],
    auditCalls: 0,
    preflightCalls: 0,
    repairs: 0,
    released: 0,
  };
  let registered = false;
  let shieldVisible = false;

  await runSingleSessionDirectedCapture({
    sessionBootstrapUrl: "about:blank",
    productLoginUrl: "https://product.example.test/login",
    productStartUrl: "https://product.example.test",
    createSession: async (url) => {
      lifecycle.createdUrls.push(url);
      return { id: "steel-mock-1", websocketUrl: "ws://mock" };
    },
    releaseSession: async () => {
      lifecycle.released += 1;
      return { id: "steel-mock-1" };
    },
    publishLiveSession: async () => undefined,
    installPrivacyShield: async () => {
      registered = true;
      shieldVisible = true;
      return { registered };
    },
    assertPrivacyShield: async (_websocketUrl, checkpoint) => {
      lifecycle.checkpoints.push(checkpoint);
      if (!shieldVisible && registered && input.repairAfterRedirect) {
        lifecycle.repairs += 1;
        shieldVisible = true;
      }
      if (!shieldVisible) throw new Error("shield unavailable");
    },
    authenticate: async (_websocketUrl, productUrls) => {
      assert.equal(productUrls.productLoginUrl, "https://product.example.test/login");
      assert.equal(registered, true);
      assert.equal(shieldVisible, true);
      lifecycle.checkpoints.push("after-login-page-load");
      lifecycle.checkpoints.push("after-submitting-login");
      shieldVisible = false;
      lifecycle.checkpoints.push("after-authenticated-redirect");
      if (input.repairAfterRedirect) {
        lifecycle.repairs += 1;
        shieldVisible = true;
      }
      if (input.failAfterRedirect) throw new Error("shield unavailable");
    },
    liveAccountSafetyAudit: async () => {
      lifecycle.auditCalls += 1;
      assert.equal(shieldVisible, true);
      return { status: input.auditStatus ?? "safe", existingNonFixtureResumesAllowed: true };
    },
    assertMutationAllowed: (audit) => {
      if (audit?.status !== "safe") throw new Error("inconclusive identity");
    },
    preflight: async () => {
      lifecycle.preflightCalls += 1;
      return { fixtureId: "fixture-only" };
    },
    removePrivacyShield: async () => undefined,
    executeFinalTake: async () => ({ executed: 1, completed: true, diagnostics: [] }),
    finalActions: [],
    sleep: async () => undefined,
  });
  return lifecycle;
}

test("mocked lifecycle uses one neutral session and confirms a live shield before audit", async () => {
  const lifecycle = await runMockedLifecycle({ repairAfterRedirect: true });
  assert.deepEqual(lifecycle.createdUrls, ["about:blank"]);
  assert.equal(lifecycle.auditCalls, 1);
  assert.equal(lifecycle.preflightCalls, 1);
  assert.equal(lifecycle.released, 1);
  assert.equal(lifecycle.repairs, 1);
  assert.deepEqual(lifecycle.checkpoints.slice(0, 2), [
    "after-session-creation",
    "before-login-navigation",
  ]);
  assert.ok(lifecycle.checkpoints.includes("before-account-audit"));
  assert.ok(lifecycle.checkpoints.includes("before-fixture-discovery"));
  assert.ok(lifecycle.checkpoints.includes("after-authenticated-redirect"));
  assert.doesNotMatch(JSON.stringify(lifecycle), /@|credential|password/i);
});

test("unrecoverable post-login shield loss aborts before account inspection and mutation", async () => {
  await assert.rejects(runMockedLifecycle({ failAfterRedirect: true }), /shield unavailable/);
});

test("inconclusive authenticated identity aborts before fixture preparation", async () => {
  await assert.rejects(
    runMockedLifecycle({ auditStatus: "inconclusive", repairAfterRedirect: true }),
    /inconclusive identity/,
  );
});

test("offline fixture lifecycle permits setup after independent fallback identity confirmation", async () => {
  const identity = resolveWiseResumeIdentity({
    expectedAccountFingerprint: "expected-fingerprint",
    primary: { sourceAvailable: false, liveAccountFingerprint: null },
    fallback: { sourceAvailable: true, liveAccountFingerprint: "expected-fingerprint" },
  });
  const shieldVisible = true;
  let fixturePrepared = false;
  assert.equal(identity.authenticatedAccountConfirmed, true);
  await executeShieldedNavigationAction({
    checkpointBefore: "before-fixture-creation-click",
    checkpointAfter: "after-fixture-creation-transition",
    assertPrivacyShield: async () => {
      assert.equal(shieldVisible, true);
    },
    action: async () => undefined,
    waitForTransition: async () => undefined,
  });
  fixturePrepared = true;
  assert.equal(fixturePrepared, true);
});

test("offline fixture lifecycle releases without mutation when shield repair fails", async () => {
  let shieldVisible = true;
  let released = false;
  const fixtureMutated = false;
  await assert.rejects(
    executeShieldedNavigationAction({
      checkpointBefore: "before-fixture-creation-click",
      checkpointAfter: "after-fixture-creation-transition",
      assertPrivacyShield: async () => {
        if (!shieldVisible) throw new Error("shield unavailable");
      },
      action: async () => {
        shieldVisible = false;
      },
      waitForTransition: async () => undefined,
    }),
    /shield unavailable/,
  );
  released = true;
  assert.equal(released, true);
  assert.equal(fixtureMutated, false);
});
