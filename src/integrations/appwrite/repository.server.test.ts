import assert from "node:assert/strict";
import test from "node:test";

import type { TablesDB } from "node-appwrite";

import { SHARED_WORKSPACE_ID, WiseDemoRepository } from "./repository.server.ts";

function demoRow(overrides: Record<string, unknown> = {}) {
  return {
    $id: "11111111-1111-4111-8111-111111111111",
    $sequence: "1",
    $tableId: "demos",
    $databaseId: "wisedemo",
    $createdAt: "2026-08-01T08:00:00.000Z",
    $updatedAt: "2026-08-01T08:00:00.000Z",
    $permissions: [],
    workspace_id: SHARED_WORKSPACE_ID,
    project_id: "22222222-2222-4222-8222-222222222222",
    title: "WiseResume walkthrough",
    feature_prompt: "Show the resume workflow",
    scene_script: '[{"shot":"Open dashboard"}]',
    status: "pending",
    progress_pct: 5,
    is_public: true,
    execution_attempts: 0,
    execution_started_at: null,
    finalization_attempts: 0,
    finalization_started_at: null,
    ...overrides,
  };
}

function repositoryWithTransactionalDemo(initial = demoRow()) {
  let current = { ...initial };
  let staged: Record<string, unknown> | null = null;
  let transactionNumber = 0;
  let rollbacks = 0;
  const tables = {
    createTransaction: async ({ ttl }: { ttl: number }) => {
      assert.equal(ttl, 60);
      return { $id: `tx-${++transactionNumber}` };
    },
    getRow: async () => ({ ...current }),
    updateRow: async ({
      data,
      transactionId,
    }: {
      data: Record<string, unknown>;
      transactionId?: string;
    }) => {
      if (transactionId) staged = { ...data };
      else current = { ...current, ...data, $updatedAt: "2026-08-01T08:01:00.000Z" };
      return { ...current, ...data };
    },
    updateTransaction: async ({ commit, rollback }: { commit?: boolean; rollback?: boolean }) => {
      if (commit && staged) {
        current = { ...current, ...staged, $updatedAt: "2026-08-01T08:01:00.000Z" };
        staged = null;
      }
      if (rollback) {
        staged = null;
        rollbacks += 1;
      }
      return {};
    },
  } as unknown as TablesDB;
  const repository = new WiseDemoRepository({
    tables,
    config: {
      databaseId: "wisedemo",
      projectsTableId: "projects",
      credentialsTableId: "project_credentials",
      demosTableId: "demos",
      demoEventsTableId: "demo_events",
      compositionsTableId: "compositions",
      compositionExportsTableId: "composition_exports",
      productIntelligenceTableId: "product_intelligence",
      storyboardsTableId: "storyboards",
      demoScenesTableId: "demo_scenes",
      qualityReviewsTableId: "quality_reviews",
      directorArtifactsTableId: "director_artifacts",
    },
  });
  return { repository, rollbacks: () => rollbacks };
}

test("claims demo execution transactionally and rejects a live duplicate lease", async () => {
  const { repository, rollbacks } = repositoryWithTransactionalDemo();
  const now = new Date("2026-08-01T08:02:00.000Z");

  const claimed = await repository.claimDemoExecution("11111111-1111-4111-8111-111111111111", now);
  assert.equal(claimed?.status, "scanning");
  assert.equal(claimed?.execution_attempts, 1);
  assert.equal(claimed?.execution_started_at, now.toISOString());
  assert.deepEqual(claimed?.scene_script, [{ shot: "Open dashboard" }]);

  const duplicate = await repository.claimDemoExecution(
    "11111111-1111-4111-8111-111111111111",
    new Date("2026-08-01T08:03:00.000Z"),
  );
  assert.equal(duplicate, null);
  assert.equal(rollbacks(), 1);
});

test("reclaims only stale Appwrite execution leases", async () => {
  const { repository } = repositoryWithTransactionalDemo(
    demoRow({
      status: "recording",
      execution_attempts: 2,
      execution_started_at: "2026-08-01T07:40:00.000Z",
    }),
  );
  const claimed = await repository.claimDemoExecution(
    "11111111-1111-4111-8111-111111111111",
    new Date("2026-08-01T08:00:00.000Z"),
  );
  assert.equal(claimed?.execution_attempts, 3);
  assert.equal(claimed?.status, "scanning");
});
