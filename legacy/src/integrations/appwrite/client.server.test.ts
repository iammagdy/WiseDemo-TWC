import assert from "node:assert/strict";
import test from "node:test";

import { withAppwriteTransportRetries } from "./client.server.ts";

test("retries idempotent Appwrite reads after a transport failure", async () => {
  let attempts = 0;
  const service = withAppwriteTransportRetries(
    {
      async listRows() {
        attempts += 1;
        if (attempts === 1) {
          const error = new TypeError("fetch failed") as TypeError & {
            cause?: { code: string };
          };
          error.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
          throw error;
        }
        return { total: 0, rows: [] };
      },
    },
    async () => undefined,
  );

  const result = await service.listRows();
  assert.equal(attempts, 2);
  assert.equal(result.total, 0);
});

test("retries idempotent Appwrite row updates after a transport failure", async () => {
  let attempts = 0;
  const service = withAppwriteTransportRetries(
    {
      async updateRow() {
        attempts += 1;
        if (attempts === 1) throw new TypeError("fetch failed");
        return { $id: "demo-id" };
      },
    },
    async () => undefined,
  );

  const result = await service.updateRow();
  assert.equal(attempts, 2);
  assert.equal(result.$id, "demo-id");
});

test("does not retry non-idempotent Appwrite row creates", async () => {
  let attempts = 0;
  const service = withAppwriteTransportRetries(
    {
      async createRow() {
        attempts += 1;
        throw new TypeError("fetch failed");
      },
    },
    async () => undefined,
  );

  await assert.rejects(() => service.createRow(), /fetch failed/);
  assert.equal(attempts, 1);
});
