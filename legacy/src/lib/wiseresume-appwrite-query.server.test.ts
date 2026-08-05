import assert from "node:assert/strict";
import test from "node:test";

import {
  WISE_RESUME_WEB_SDK_VERSION,
  serializeWiseResumeWebSdkQuery,
  wiseResumeInventoryQueries,
} from "./wiseresume-appwrite-query.server.ts";

test("WiseResume Appwrite Web SDK 25 serializer matches equal, orderDesc, and limit", () => {
  assert.equal(WISE_RESUME_WEB_SDK_VERSION, "25.0.0");
  assert.equal(
    serializeWiseResumeWebSdkQuery("equal", "user_id", ["fictional user/with?characters"]),
    '{"method":"equal","attribute":"user_id","values":["fictional user/with?characters"]}',
  );
  assert.equal(
    serializeWiseResumeWebSdkQuery("orderDesc", "$updatedAt", undefined),
    '{"method":"orderDesc","attribute":"$updatedAt"}',
  );
  assert.equal(
    serializeWiseResumeWebSdkQuery("limit", undefined, 50),
    '{"method":"limit","values":[50]}',
  );
});

test("WiseResume inventory query parameters preserve three indexed SDK query entries", () => {
  const params = new URLSearchParams();
  wiseResumeInventoryQueries("fictional user/with?characters").forEach((query, index) =>
    params.append(`queries[${index}]`, query),
  );
  assert.equal(params.getAll("queries[]").length, 0);
  assert.deepEqual(
    [params.get("queries[0]"), params.get("queries[1]"), params.get("queries[2]")],
    wiseResumeInventoryQueries("fictional user/with?characters"),
  );
});
