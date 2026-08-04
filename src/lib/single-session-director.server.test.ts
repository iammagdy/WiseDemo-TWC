import assert from "node:assert/strict";
import test from "node:test";

import { runSingleSessionDirectedCapture } from "./single-session-director.server.ts";

test("directed capture uses one session and records a trim-ready take", async () => {
  let time = 0;
  let created = 0;
  let released = 0;
  const result = await runSingleSessionDirectedCapture({
    sessionBootstrapUrl: "about:blank",
    createSession: async () => {
      created += 1;
      time += 5;
      return { id: "steel-1", websocketUrl: "ws://steel" };
    },
    releaseSession: async () => {
      released += 1;
      return { id: "steel-1" };
    },
    publishLiveSession: async () => {
      time += 5;
    },
    preflight: async () => {
      time += 1_000;
      return { selector: "resolved-by-dom" };
    },
    executeFinalTake: async () => {
      time += 2_000;
      return {
        executed: 1,
        completed: true,
        diagnostics: [
          {
            index: 0,
            type: "click",
            success: true,
            code: "ACTION_SUCCEEDED",
            message: "ok",
            startedAt: 1_010,
            completedAt: 3_010,
            cursor: { x: 40, y: 60 },
            boundingBox: { x: 20, y: 40, width: 40, height: 40 },
          },
        ],
      };
    },
    finalActions: [
      {
        type: "click",
        selector: "[data-resolved='feature']",
        expected: { selector: "[data-result]" },
      },
    ],
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    now: () => time,
  });
  assert.equal(created, 1);
  assert.equal(released, 1);
  assert.ok(result.markers.takeEndedAtMs > result.markers.takeStartedAtMs);
  assert.equal(result.telemetry[0].boundingBox?.width, 40);
});

test("directed capture verifies the final take before recording its end marker", async () => {
  let time = 0;
  const result = await runSingleSessionDirectedCapture({
    sessionBootstrapUrl: "about:blank",
    createSession: async () => ({ id: "steel-1", websocketUrl: "ws://steel" }),
    releaseSession: async () => ({ id: "steel-1" }),
    publishLiveSession: async () => undefined,
    preflight: async () => "prepared",
    executeFinalTake: async () => ({ executed: 1, completed: true, diagnostics: [] }),
    verifyFinalTake: async () => {
      time = 500;
      return { transformed: true };
    },
    finalActions: [],
    sleep: async () => undefined,
    now: () => time,
  });
  assert.deepEqual(result.verification, { transformed: true });
  assert.ok(result.markers.takeEndedAtMs >= 500);
});

test("directed capture uses separate protected setup and clean-take budgets", async () => {
  let preflightBudget = 0;
  let takeBudget = 0;
  await runSingleSessionDirectedCapture({
    sessionBootstrapUrl: "about:blank",
    createSession: async () => ({ id: "steel-1", websocketUrl: "ws://steel" }),
    releaseSession: async () => ({ id: "steel-1" }),
    publishLiveSession: async () => undefined,
    preflight: async (_websocketUrl, maxWallMs) => {
      preflightBudget = maxWallMs;
      return "prepared";
    },
    executeFinalTake: async (_websocketUrl, maxWallMs) => {
      takeBudget = maxWallMs;
      return { executed: 1, completed: true, diagnostics: [] };
    },
    finalActions: [],
    sleep: async () => undefined,
  });
  assert.equal(preflightBudget, 125_000);
  assert.equal(takeBudget, 22_000);
});

test("fixture preflight retains its full budget after protected bootstrap", async () => {
  let preflightCalled = false;
  await runSingleSessionDirectedCapture({
    sessionBootstrapUrl: "about:blank",
    createSession: async () => ({ id: "steel-1", websocketUrl: "ws://steel" }),
    releaseSession: async () => ({ id: "steel-1" }),
    publishLiveSession: async () => undefined,
    installPrivacyShield: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { shield: true };
    },
    preflight: async () => {
      preflightCalled = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "prepared";
    },
    executeFinalTake: async () => ({ executed: 1, completed: true, diagnostics: [] }),
    finalActions: [],
    phaseBudget: {
      protectedBootstrapMaxMs: 30,
      preflightMaxMs: 30,
    },
    sleep: async () => undefined,
  });
  assert.equal(preflightCalled, true);
});

test("a preflight timeout aborts its guarded work before session release", async () => {
  let released = 0;
  let signalWasAborted = false;
  await assert.rejects(
    runSingleSessionDirectedCapture({
      sessionBootstrapUrl: "about:blank",
      createSession: async () => ({ id: "steel-1", websocketUrl: "ws://steel" }),
      releaseSession: async () => {
        released += 1;
        return { id: "steel-1" };
      },
      publishLiveSession: async () => undefined,
      preflight: async (_websocketUrl, _maxWallMs, _audit, signal) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        signalWasAborted = signal.aborted;
        if (signal.aborted) throw signal.reason;
        return "prepared";
      },
      executeFinalTake: async () => ({ executed: 1, completed: true, diagnostics: [] }),
      finalActions: [],
      phaseBudget: { preflightMaxMs: 5 },
    }),
    /Protected fixture preparation exceeded/,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signalWasAborted, true);
  assert.equal(released, 1);
});

test("unsafe live safety audit releases the only session before mutation", async () => {
  let created = 0;
  let released = 0;
  let preflightCalled = false;
  await assert.rejects(
    runSingleSessionDirectedCapture({
      sessionBootstrapUrl: "about:blank",
      createSession: async () => {
        created += 1;
        return { id: "steel-1", websocketUrl: "ws://steel" };
      },
      releaseSession: async () => {
        released += 1;
        return { id: "steel-1" };
      },
      publishLiveSession: async () => undefined,
      liveAccountSafetyAudit: async () => ({ status: "unsafe" }),
      assertMutationAllowed: (audit) => {
        if (audit?.status !== "safe") throw new Error("unsafe account");
      },
      preflight: async () => {
        preflightCalled = true;
        return "should not run";
      },
      executeFinalTake: async () => ({ executed: 0, completed: true, diagnostics: [] }),
      finalActions: [],
    }),
    /unsafe account/,
  );
  assert.equal(created, 1);
  assert.equal(released, 1);
  assert.equal(preflightCalled, false);
});

test("privacy shield is installed before authentication and removed only after preflight", async () => {
  const order: string[] = [];
  await runSingleSessionDirectedCapture({
    sessionBootstrapUrl: "about:blank",
    createSession: async () => ({ id: "steel-1", websocketUrl: "ws://steel" }),
    releaseSession: async () => ({ id: "steel-1" }),
    publishLiveSession: async () => {
      order.push("publish");
    },
    installPrivacyShield: async () => {
      order.push("install-shield");
      return { shield: true };
    },
    authenticate: async () => {
      order.push("authenticate");
    },
    liveAccountSafetyAudit: async () => ({ status: "safe" }),
    assertMutationAllowed: () => {
      order.push("audit-approved");
    },
    preflight: async () => {
      order.push("preflight");
      return { safe: true };
    },
    removePrivacyShield: async () => {
      order.push("remove-shield");
    },
    executeFinalTake: async () => {
      order.push("take");
      return { executed: 1, completed: true, diagnostics: [] };
    },
    finalActions: [],
    sleep: async () => undefined,
  });
  assert.deepEqual(order, [
    "publish",
    "install-shield",
    "authenticate",
    "audit-approved",
    "preflight",
    "remove-shield",
    "take",
  ]);
});

test("one-session lifecycle initializes locale once and verifies it for every later attachment", async () => {
  const localeModes: string[] = [];
  await runSingleSessionDirectedCapture({
    sessionBootstrapUrl: "about:blank",
    createSession: async () => ({ id: "steel-1", websocketUrl: "ws://steel" }),
    releaseSession: async () => ({ id: "steel-1" }),
    publishLiveSession: async () => undefined,
    installPrivacyShield: async () => {
      localeModes.push("initialize");
      return { shield: true };
    },
    assertPrivacyShield: async () => {
      localeModes.push("verify");
    },
    authenticate: async () => {
      localeModes.push("verify");
    },
    liveAccountSafetyAudit: async () => {
      localeModes.push("verify");
      return { status: "safe" };
    },
    assertMutationAllowed: () => undefined,
    preflight: async () => {
      localeModes.push("verify");
      return { safe: true };
    },
    removePrivacyShield: async () => undefined,
    executeFinalTake: async () => {
      localeModes.push("verify");
      return { executed: 1, completed: true, diagnostics: [] };
    },
    finalActions: [],
    sleep: async () => undefined,
  });
  assert.equal(localeModes.filter((mode) => mode === "initialize").length, 1);
  assert.equal(localeModes.filter((mode) => mode === "verify").length, 8);
});
