import assert from "node:assert/strict";
import test from "node:test";

import { isSafeReconNavigation } from "./recon-safety.ts";

const origin = "https://product.example.test";

test("recon accepts only safe exact-origin navigation", () => {
  assert.equal(isSafeReconNavigation(`${origin}/dashboard`, origin), true);
  assert.equal(isSafeReconNavigation(`${origin}/resume?id=1`, origin), true);
  assert.equal(isSafeReconNavigation(`${origin}.attacker.invalid/dashboard`, origin), false);
  assert.equal(isSafeReconNavigation("https://elsewhere.example.test/dashboard", origin), false);
  assert.equal(isSafeReconNavigation(`${origin}/logout`, origin), false);
  assert.equal(isSafeReconNavigation(`${origin}/privacy-policy`, origin), false);
  assert.equal(isSafeReconNavigation(`${origin}/resume.pdf`, origin), false);
  assert.equal(isSafeReconNavigation("not-a-url", origin), false);
});
