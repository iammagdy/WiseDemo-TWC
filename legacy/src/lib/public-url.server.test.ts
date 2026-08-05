import assert from "node:assert/strict";
import test from "node:test";

import { assertPublicHttpUrl, parsePublicHttpUrl } from "./public-url.server.ts";

test("public URL validation rejects SSRF targets and embedded credentials", async () => {
  assert.throws(() => parsePublicHttpUrl("file:///etc/passwd"));
  assert.throws(() => parsePublicHttpUrl("https://user:password@example.com"));
  assert.throws(() => parsePublicHttpUrl("http://localhost:3000"));
  assert.throws(() => parsePublicHttpUrl("http://169.254.169.254/latest/meta-data"));
  await assert.rejects(() =>
    assertPublicHttpUrl("https://product.example.test", async () => ["10.0.0.4"]),
  );
});

test("public URL validation accepts a resolved public HTTP target", async () => {
  const value = await assertPublicHttpUrl("https://product.example.test/path", async () => [
    "203.0.113.10",
  ]);
  assert.equal(value.hostname, "product.example.test");
});
