import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProfessionalRecordingDuration,
  executeRecordingPass,
  executeWithinBudget,
  recordingActionBudgetMs,
  RecordingPassError,
} from "./recording-pass.server.ts";

test("runs login and scenes in a fresh session, holds the final view, and releases", async () => {
  let clock = 0;
  const events: string[] = [];
  const session = { id: "recording-session", websocketUrl: "wss://recording.test" };

  const result = await executeRecordingPass({
    startUrl: "https://product.example.test/login",
    now: () => clock,
    sleep: async (ms) => {
      events.push(`hold:${ms}`);
      clock += ms;
    },
    createSession: async () => {
      events.push("create");
      clock += 1_000;
      return session;
    },
    publishLiveSession: async () => {
      events.push("publish");
    },
    authenticate: async () => {
      events.push("authenticate");
      clock += 5_000;
    },
    executeScenes: async (_websocketUrl, maxWallMs) => {
      events.push(`execute:${maxWallMs}`);
      clock += 20_000;
      return { completed: true };
    },
    releaseSession: async () => {
      events.push("release");
      clock += 500;
      return session;
    },
  });

  assert.deepEqual(events, [
    "create",
    "publish",
    "authenticate",
    "execute:55000",
    "hold:24000",
    "release",
  ]);
  assert.equal(result.elapsedMs, 50_500);
  assert.equal(result.execution.completed, true);
});

test("always releases the recording session when an action fails", async () => {
  let releases = 0;
  await assert.rejects(
    executeRecordingPass({
      startUrl: "https://product.example.test",
      createSession: async () => ({ id: "session", websocketUrl: "wss://recording.test" }),
      publishLiveSession: async () => undefined,
      executeScenes: async () => ({ completed: false, error: "selector missing" }),
      releaseSession: async () => {
        releases += 1;
        return { id: "session" };
      },
    }),
    (error) => error instanceof RecordingPassError && error.code === "CDP_ACTION_FAILED",
  );
  assert.equal(releases, 1);
});

test("rejects sessions without a browser connection and still releases them", async () => {
  let releases = 0;
  await assert.rejects(
    executeRecordingPass({
      startUrl: "https://product.example.test",
      createSession: async () => ({ id: "session" }),
      publishLiveSession: async () => undefined,
      executeScenes: async () => ({ completed: true }),
      releaseSession: async () => {
        releases += 1;
        return { id: "session" };
      },
    }),
    (error) => error instanceof RecordingPassError && error.code === "MISSING_RECORDING_WEBSOCKET",
  );
  assert.equal(releases, 1);
});

test("enforces a safe action budget and finalized professional duration", () => {
  assert.equal(recordingActionBudgetMs(6_000), 55_000);
  assert.equal(recordingActionBudgetMs(50_000), 12_000);
  assert.throws(
    () => recordingActionBudgetMs(55_000),
    (error) => error instanceof RecordingPassError && error.code === "RECORDING_START_TOO_SLOW",
  );
  assert.doesNotThrow(() => assertProfessionalRecordingDuration(45));
  assert.doesNotThrow(() => assertProfessionalRecordingDuration(69));
  assert.throws(
    () => assertProfessionalRecordingDuration(44),
    (error) =>
      error instanceof RecordingPassError && error.code === "RECORDING_DURATION_OUT_OF_RANGE",
  );
  assert.throws(
    () => assertProfessionalRecordingDuration(70),
    (error) =>
      error instanceof RecordingPassError && error.code === "RECORDING_DURATION_OUT_OF_RANGE",
  );
});

test("interrupts a walkthrough that exceeds its recording budget", async () => {
  await assert.rejects(
    executeWithinBudget(() => new Promise<never>(() => undefined), 5),
    (error) => error instanceof RecordingPassError && error.code === "RECORDING_WALL_CLOCK_TIMEOUT",
  );
});
