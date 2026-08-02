import assert from "node:assert/strict";
import test from "node:test";

import { runSingleSessionDirectedCapture } from "./single-session-director.server.ts";

test("directed capture uses one session and records a trim-ready take", async () => {
  let time = 0;
  let created = 0;
  let released = 0;
  const result = await runSingleSessionDirectedCapture({
    startUrl: "https://product.example.test",
    createSession: async () => { created += 1; time += 5; return { id: "steel-1", websocketUrl: "ws://steel" }; },
    releaseSession: async () => { released += 1; return { id: "steel-1" }; },
    publishLiveSession: async () => { time += 5; },
    preflight: async () => { time += 1_000; return { selector: "resolved-by-dom" }; },
    executeFinalTake: async () => { time += 2_000; return { executed: 1, completed: true, diagnostics: [{ index: 0, type: "click", success: true, code: "ACTION_SUCCEEDED", message: "ok", startedAt: 1_010, completedAt: 3_010, cursor: { x: 40, y: 60 }, boundingBox: { x: 20, y: 40, width: 40, height: 40 } }] }; },
    finalActions: [{ type: "click", selector: "[data-resolved='feature']", expected: { selector: "[data-result]" } }],
    sleep: async (milliseconds) => { time += milliseconds; },
    now: () => time,
  });
  assert.equal(created, 1);
  assert.equal(released, 1);
  assert.ok(result.markers.takeEndedAtMs > result.markers.takeStartedAtMs);
  assert.equal(result.telemetry[0].boundingBox?.width, 40);
});
