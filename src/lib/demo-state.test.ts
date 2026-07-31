import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionDemo,
  getDemoPlaybackState,
  isVerifiedLoginOutcome,
  stableRecordingUrl,
} from "./demo-state.ts";

test("allows only accurate recording state transitions", () => {
  assert.equal(canTransitionDemo("pending", "scanning"), true);
  assert.equal(canTransitionDemo("scanning", "planning"), true);
  assert.equal(canTransitionDemo("recording", "rendering"), true);
  assert.equal(canTransitionDemo("rendering", "ready"), true);
  assert.equal(canTransitionDemo("recording", "ready"), false);
  assert.equal(canTransitionDemo("failed", "ready"), false);
});

test("player becomes ready only when ready status has a durable video URL", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    mp4_url: null,
    recording_url: null,
    recording_object_path: null,
    live_view_url: null,
    session_viewer_url: null,
  };
  assert.equal(getDemoPlaybackState({ ...base, status: "rendering" }).isReady, false);
  const ready = getDemoPlaybackState({
    ...base,
    status: "ready",
    recording_object_path: "owner/demo/recording.mp4",
  });
  assert.equal(ready.isReady, true);
  assert.equal(ready.videoUrl, stableRecordingUrl(base.id));
});

test("credential login succeeds only after verified input, submit, and form exit", () => {
  assert.equal(
    isVerifiedLoginOutcome({
      fieldsApplied: true,
      submitted: true,
      loginFormGone: true,
      outlineHasPasswordField: false,
    }),
    true,
  );
  assert.equal(
    isVerifiedLoginOutcome({
      fieldsApplied: true,
      submitted: true,
      loginFormGone: false,
      outlineHasPasswordField: true,
    }),
    false,
  );
});
