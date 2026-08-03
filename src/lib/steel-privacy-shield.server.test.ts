import assert from "node:assert/strict";
import test from "node:test";

import {
  canRemovePrivacyShield,
  fixtureViewportMaskDocumentScript,
  privacyShieldDocumentScript,
  privacyShieldIsActiveExpression,
} from "./steel-privacy-shield.server.ts";

test("privacy shield script is opaque and shows only the approved preparation message", () => {
  const script = privacyShieldDocumentScript();
  assert.match(script, /WiseDemo is preparing your product demo/);
  assert.match(script, /position: "fixed"/);
  assert.match(script, /zIndex: "2147483647"/);
  assert.doesNotMatch(script, /credential|password|email/i);
});

test("fixture viewport mask hides account navigation before the final take", () => {
  const script = fixtureViewportMaskDocumentScript();
  assert.match(script, /aside, nav, \[role=navigation\]/);
  assert.match(script, /visibility: hidden/);
});

test("live shield verification requires a mounted, visible overlay rather than registration alone", () => {
  const expression = privacyShieldIsActiveExpression();
  assert.match(expression, /isConnected/);
  assert.match(expression, /getComputedStyle/);
  assert.match(expression, /getBoundingClientRect/);
  assert.doesNotMatch(expression, /^Boolean\(/);
});

test("privacy shield cannot be removed while fixture safety is incomplete", () => {
  assert.equal(
    canRemovePrivacyShield({
      fixtureActive: true,
      unrelatedResumeTitlesVisible: false,
      accountEmailVisible: false,
      personalDataVisible: false,
    }),
    true,
  );
  assert.equal(
    canRemovePrivacyShield({
      fixtureActive: true,
      unrelatedResumeTitlesVisible: true,
      accountEmailVisible: false,
      personalDataVisible: false,
    }),
    false,
  );
});
