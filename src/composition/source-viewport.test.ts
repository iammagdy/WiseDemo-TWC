import assert from "node:assert/strict";
import test from "node:test";

import {
  correctedSourceViewport,
  detectSourceViewport,
  pagePointToCroppedSource,
  sourcePlacement,
} from "./source-viewport.ts";

const metrics = {
  innerWidth: 1280,
  innerHeight: 633,
  outerWidth: 1280,
  outerHeight: 720,
  screenX: 0,
  screenY: 0,
  devicePixelRatio: 1,
  visualViewportWidth: 1280,
  visualViewportHeight: 633,
  visualViewportOffsetLeft: 0,
  visualViewportOffsetTop: 0,
};

test("detects Chromium chrome above the page viewport from runtime metrics", () => {
  const detected = detectSourceViewport(metrics, { width: 1280, height: 720 });
  assert.deepEqual(detected.sourceViewport, {
    videoWidth: 1280,
    videoHeight: 720,
    contentX: 0,
    contentY: 87,
    contentWidth: 1280,
    contentHeight: 633,
  });
});

test("applies manual correction before contain or cover fitting", () => {
  const source = correctedSourceViewport(
    detectSourceViewport(metrics, { width: 1280, height: 720 }).sourceViewport,
    { top: 3, right: 10, bottom: 7, left: 10 },
  );
  assert.equal(source.contentY, 90);
  assert.equal(source.contentHeight, 623);
  const placement = sourcePlacement(source, { width: 1492, height: 932 }, "contain");
  assert.ok(placement.videoTop < 0);
  assert.ok(placement.width <= 1492);
  assert.ok(placement.height <= 932);
});

test("transforms page focus coordinates into corrected cropped-source coordinates", () => {
  const source = correctedSourceViewport(
    detectSourceViewport(metrics, { width: 1280, height: 720 }).sourceViewport,
    { top: 10, right: 0, bottom: 0, left: 20 },
  );
  assert.deepEqual(pagePointToCroppedSource(source, { x: 20, y: 10 }, { left: 20, top: 10 }), {
    x: 0,
    y: 0,
  });
});
