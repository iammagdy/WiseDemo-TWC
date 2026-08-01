import assert from "node:assert/strict";
import test from "node:test";

import { getFrameDefinition, screenRectForPlacement } from "./frames.ts";
import { compositionSchema, totalCompositionDuration } from "./model.ts";
import { COMPOSITION_TEMPLATES, compositionFromTemplate } from "./templates.ts";

test("all five professional templates satisfy the versioned composition schema", () => {
  assert.equal(COMPOSITION_TEMPLATES.length, 5);
  for (const template of COMPOSITION_TEMPLATES) {
    const parsed = compositionSchema.parse(template.design);
    assert.equal(parsed.templateId, template.id);
    assert.ok(parsed.canvas.width >= 1080);
    assert.notEqual(parsed.frame.id, "raw-fullscreen");
  }
});

test("premium laptop recording is mapped into the exact screen region", () => {
  const frame = getFrameDefinition("premium-laptop");
  assert.deepEqual(frame.screenRegion, {
    x: 214,
    y: 95,
    width: 1492,
    height: 932,
    cornerRadius: 14,
  });
  const screen = screenRectForPlacement("premium-laptop", 230, 118, 1460);
  assert.ok(screen.x > 390 && screen.x < 394);
  assert.ok(screen.y > 189 && screen.y < 191);
  assert.ok(screen.width > 1134 && screen.width < 1136);
  assert.ok(screen.height > 708 && screen.height < 710);
});

test("intro and outro extend output without mutating raw duration", () => {
  const composition = compositionFromTemplate("premium-laptop");
  const rawDuration = 51.65;
  const outputDuration = totalCompositionDuration(composition, rawDuration);
  assert.equal(rawDuration, 51.65);
  assert.ok(Math.abs(outputDuration - 54.35) < 0.000_001);
});

test("vertical restyling is independent from the landscape composition", () => {
  const landscape = compositionFromTemplate("premium-laptop");
  const vertical = compositionFromTemplate("minimal-browser");
  vertical.canvas = { width: 1080, height: 1920, fps: 30, format: "vertical" };
  vertical.frame.x = 76;
  vertical.frame.y = 490;
  vertical.frame.width = 928;
  vertical.captions.position = "top";
  assert.equal(landscape.canvas.width, 1920);
  assert.equal(landscape.frame.id, "premium-laptop");
  assert.equal(vertical.canvas.height, 1920);
  assert.equal(vertical.frame.id, "minimal-browser");
  assert.notDeepEqual(vertical, landscape);
});
