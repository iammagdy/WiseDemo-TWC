import assert from "node:assert/strict";
import test from "node:test";

import { executeShieldedNavigationAction } from "./shielded-navigation.server.ts";

test("shielded navigation checks the live shield before and after a transition", async () => {
  const order: string[] = [];
  await executeShieldedNavigationAction({
    checkpointBefore: "before-action",
    checkpointAfter: "after-transition",
    assertPrivacyShield: async (checkpoint) => {
      order.push(checkpoint);
    },
    action: async () => {
      order.push("click");
    },
    waitForTransition: async () => {
      order.push("settled");
    },
  });
  assert.deepEqual(order, ["before-action", "click", "settled", "after-transition"]);
});

test("shielded navigation supports login, SPA, document, modal, fixture, and locale transitions", async () => {
  for (const transition of [
    "login",
    "spa",
    "document",
    "modal",
    "fixture",
    "existing-fixture",
    "smart-tailoring",
    "locale",
  ] as const) {
    const order: string[] = [];
    await executeShieldedNavigationAction({
      checkpointBefore: `before-${transition}`,
      checkpointAfter: `after-${transition}`,
      assertPrivacyShield: async (checkpoint) => {
        order.push(checkpoint);
      },
      action: async () => {
        order.push(`${transition}-action`);
      },
      waitForTransition: async () => {
        order.push(`${transition}-settled`);
      },
    });
    assert.deepEqual(order, [
      `before-${transition}`,
      `${transition}-action`,
      `${transition}-settled`,
      `after-${transition}`,
    ]);
  }
});

test("unrecoverable shield loss aborts before protected inspection", async () => {
  const inspected = false;
  await assert.rejects(
    executeShieldedNavigationAction({
      checkpointBefore: "before-fixture-creation-click",
      checkpointAfter: "after-fixture-creation-transition",
      assertPrivacyShield: async (checkpoint) => {
        if (checkpoint.startsWith("after")) throw new Error("shield unavailable");
      },
      action: async () => undefined,
      waitForTransition: async () => undefined,
    }),
    /shield unavailable/,
  );
  assert.equal(inspected, false);
});
