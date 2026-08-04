import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWiseResumeFinalVisibleContentSafe,
  assertWiseResumeFixtureCreationAllowed,
  assertWiseResumeFixtureMutationAllowed,
  createWiseResumeFixtureIsolationAudit,
  createWiseResumeFixtureReference,
  migrateLegacyWiseResumeFixtureReference,
  parseWiseResumeFixtureReference,
  serializeWiseResumeFixtureReference,
  wiseResumeAccountFingerprint,
} from "./wiseresume-fixture-isolation.server.ts";
import {
  evaluateWiseResumeFixtureViewportSafety,
  prepareWiseResumeFixtureSmartTailoring,
  resolveWiseResumeFixtureCreationWorkspace,
  type ProductLocaleAdapterContext,
  wiseResumeFixtureRouteExpression,
  wiseResumeFixtureWriteExpression,
} from "./product-adapters/wiseresume.server.ts";
import type { LiveAccountSafetyAudit } from "./live-account-safety.server.ts";
import { wiseResumeLegacyAccountFingerprint } from "./wiseresume-account-fingerprint.server.ts";

const accountFingerprint = wiseResumeAccountFingerprint("demo-user@test.example");
const fixture = createWiseResumeFixtureReference({
  accountFingerprint,
  resumeRecordId: "fixture-resume-1",
  createdByWiseDemo: true,
  lastValidatedAt: "2026-08-02T00:00:00.000Z",
});

test("an empty account is safe for a newly created WiseDemo fixture", () => {
  const audit = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 0,
    fixtureRecordIds: [],
    storedFixture: null,
    privacyShieldActive: true,
  });
  assert.equal(audit.status, "safe");
  assert.equal(audit.mode, "empty-account");
  assert.doesNotThrow(() => assertWiseResumeFixtureCreationAllowed(audit));
});

test("existing non-fixture resumes coexist without authorizing a broad mutation", () => {
  const audit = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 4,
    fixtureRecordIds: [fixture.resumeRecordId],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  assert.equal(audit.status, "safe");
  assert.equal(audit.mode, "fixture-isolation");
  assert.equal(audit.nonFixtureResumeCount, 3);
  assert.doesNotThrow(() =>
    assertWiseResumeFixtureMutationAllowed({
      audit,
      fixture,
      targetResumeId: fixture.resumeRecordId,
      operation: "prepare fixture resume",
    }),
  );
  assert.throws(
    () =>
      assertWiseResumeFixtureMutationAllowed({
        audit,
        fixture,
        targetResumeId: "existing-resume-2",
        operation: "prepare fixture resume",
      }),
    /non-fixture/,
  );
});

test("fixture conflicts and unresolved identity cannot unlock mutation", () => {
  const ambiguous = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 2,
    fixtureRecordIds: [fixture.resumeRecordId, "fixture-resume-2"],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  const unresolved = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: false,
    totalResumeCount: 1,
    fixtureRecordIds: [fixture.resumeRecordId],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  assert.equal(ambiguous.status, "unsafe");
  assert.equal(unresolved.status, "inconclusive");
  assert.throws(() => assertWiseResumeFixtureCreationAllowed(ambiguous));
  assert.throws(() => assertWiseResumeFixtureCreationAllowed(unresolved));
});

test("legacy fixture fingerprints parse safely and migrate only after canonical identity confirmation", () => {
  const legacy = {
    ...serializeWiseResumeFixtureReference(fixture),
    accountFingerprint: wiseResumeLegacyAccountFingerprint("demo-user@test.example"),
  };
  const parsed = parseWiseResumeFixtureReference(legacy);
  assert.equal(parsed?.accountFingerprintFormat, "legacy-v0");
  assert.equal(
    migrateLegacyWiseResumeFixtureReference({
      reference: parsed!,
      authenticatedAccountConfirmed: false,
      expectedAccountFingerprint: accountFingerprint,
      legacyExpectedAccountFingerprint: legacy.accountFingerprint,
    }),
    null,
  );
  const migrated = migrateLegacyWiseResumeFixtureReference({
    reference: parsed!,
    authenticatedAccountConfirmed: true,
    expectedAccountFingerprint: accountFingerprint,
    legacyExpectedAccountFingerprint: legacy.accountFingerprint,
  });
  assert.equal(migrated?.accountFingerprint, accountFingerprint);
  assert.equal(migrated?.accountFingerprintFormat, "canonical-v1");
  assert.equal(migrated?.fixtureSignature, fixture.fixtureSignature);
  assert.equal(migrated?.resumeRecordId, fixture.resumeRecordId);
});

test("fixture mutation rejects missing, broad, or destructive targets", () => {
  const audit = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 1,
    fixtureRecordIds: [fixture.resumeRecordId],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  for (const [targetResumeId, operation] of [
    [null, "prepare fixture resume"],
    [fixture.resumeRecordId, "use latest resume"],
    [fixture.resumeRecordId, "delete fixture resume"],
  ] as const) {
    assert.throws(() =>
      assertWiseResumeFixtureMutationAllowed({ audit, fixture, targetResumeId, operation }),
    );
  }
});

test("references remain account-scoped and serialized output excludes content and credentials", () => {
  const serialized = JSON.stringify(serializeWiseResumeFixtureReference(fixture));
  assert.deepEqual(parseWiseResumeFixtureReference(JSON.parse(serialized)), fixture);
  assert.doesNotMatch(serialized, /body|title|email|password|credential|secret/i);
  assert.notEqual(accountFingerprint, wiseResumeAccountFingerprint("another-user@test.example"));
});

test("fixture route expression declares each helper before it is used", () => {
  const expression = wiseResumeFixtureRouteExpression("fixture-resume-1");
  assert.doesNotThrow(() => new Function(expression));
  assert.ok(
    expression.indexOf("const cssPath") < expression.indexOf("cssPath(fixtureEntry.element)"),
  );
  assert.match(expression, /fixtureSelector/);
  assert.match(expression, /aria-label="New Resume"/);
  assert.match(expression, /workspaceDefinitions/);
  assert.match(expression, /dashboardWorkspaceFallback/);
  assert.match(expression, /dashboardCreateControls\.length === 1/);
  assert.match(expression, /\[aria-label="New Resume"\]/);
  assert.match(expression, /dashboardCreateControls\[0\]\.parentElement/);
  assert.doesNotMatch(expression, /closest\("main"\)/);
  assert.doesNotMatch(expression, /username|password|credential|secret/i);
});

test("fixture preparation retains a supplemental dashboard wiring check", () => {
  const source = String(prepareWiseResumeFixtureSmartTailoring);
  assert.match(source, /resolveWiseResumeFixtureCreationWorkspace/);
});

const safeAudit: LiveAccountSafetyAudit = {
  status: "safe",
  mode: "empty-account",
  authenticatedAccountConfirmed: true,
  inventoryRequestEvidence: {
    source: "appwrite-resumes",
    sourceAvailable: true,
    inventoryResolved: true,
    countEstablished: true,
    requestStatus: "success",
    httpStatusClass: "2xx",
    domFallbackResolved: false,
  },
  totalResumeCount: 0,
  fixtureResumeCount: 0,
  nonFixtureResumeCount: 0,
  fixtureIsolated: true,
  privacyShieldActive: true,
  mutationScopeLockedToFixture: false,
  personalDataMarkersFound: false,
  reasons: [],
  auditedAt: "2026-08-03T00:00:00.000Z",
};

type RouteResult = {
  origin: string;
  resumeUrl: string | null;
  recordId: string | null;
  fixtureSelector: string | null;
  createSelector: string | null;
  createControlEvidence: {
    routeCategory: "resume-dashboard" | "login" | "onboarding" | "unrelated" | "unknown";
    workspaceConfirmed: boolean;
    candidateCount: number;
    selectorCategory: "data-testid" | "aria-label" | "exact-role-label" | "none";
    controlVisible: boolean;
    controlEnabled: boolean;
  };
};

function routeResult(
  input: Partial<RouteResult["createControlEvidence"]> & {
    routeCategory?: RouteResult["createControlEvidence"]["routeCategory"];
    createSelector?: string | null;
  } = {},
): RouteResult {
  return {
    origin: "https://wiseresume.app",
    resumeUrl: null,
    recordId: null,
    fixtureSelector: null,
    createSelector: input.createSelector ?? null,
    createControlEvidence: {
      routeCategory: input.routeCategory ?? "resume-dashboard",
      workspaceConfirmed: input.workspaceConfirmed ?? true,
      candidateCount: input.candidateCount ?? (input.createSelector ? 1 : 0),
      selectorCategory: input.selectorCategory ?? (input.createSelector ? "aria-label" : "none"),
      controlVisible: input.controlVisible ?? Boolean(input.createSelector),
      controlEnabled: input.controlEnabled ?? Boolean(input.createSelector),
    },
  };
}

function mockedWorkspaceContext(input: {
  routes: RouteResult[];
  events: string[];
  clickResult?: boolean;
  createTransition?: boolean;
}): ProductLocaleAdapterContext {
  let routeIndex = 0;
  let creationClicked = false;
  return {
    evaluate: async (expression) => {
      if (expression === "location.hostname") return "wiseresume.app";
      if (expression.includes("wisedemo-fixture-viewport-mask")) {
        input.events.push("reveal:create-control");
        return true;
      }
      if (expression.includes("workspaceDefinitions")) {
        input.events.push(`route:${routeIndex}`);
        return input.routes[Math.min(routeIndex++, input.routes.length - 1)];
      }
      if (expression === "location.href")
        return creationClicked
          ? "https://wiseresume.app/resume/new"
          : "https://wiseresume.app/dashboard";
      if (expression.includes("target.click")) {
        input.events.push(`click:${expression.includes('[aria-label=\\"New Resume\\"]')}`);
        creationClicked = true;
        return input.clickResult ?? true;
      }
      throw new Error("unexpected browser evaluation");
    },
    delay: async () => undefined,
    waitUntil: async (expression) => {
      input.events.push(expression.includes("document.readyState") ? "settled" : "transition");
      return input.createTransition ?? true;
    },
    goto: async (url) => {
      input.events.push(`goto:${url}`);
    },
  };
}

test("dashboard fallback is behavioral, shielded, settled, and clicks only its unique narrow control", async () => {
  const events: string[] = [];
  const context = mockedWorkspaceContext({
    events,
    routes: [
      routeResult({ routeCategory: "unrelated" }),
      routeResult({
        createSelector: '[data-testid="resume-workspace-toolbar"] [aria-label="New Resume"]',
      }),
    ],
  });
  const checkpoints: string[] = [];
  const shield = async (checkpoint: string) => {
    checkpoints.push(checkpoint);
    events.push(`shield:${checkpoint}`);
  };

  const route = await resolveWiseResumeFixtureCreationWorkspace(context, {
    liveAccountSafetyAudit: safeAudit,
    storedFixture: null,
    assertPrivacyShield: shield,
  });
  assert.equal(
    route.createSelector,
    '[data-testid="resume-workspace-toolbar"] [aria-label="New Resume"]',
  );
  assert.deepEqual(checkpoints, [
    "before-fixture-dashboard-navigation",
    "after-fixture-dashboard-navigation",
  ]);
  assert.deepEqual(events, [
    "route:0",
    "shield:before-fixture-dashboard-navigation",
    "goto:https://wiseresume.app/dashboard",
    "settled",
    "shield:after-fixture-dashboard-navigation",
    "route:1",
  ]);
  assert.doesNotMatch(
    JSON.stringify(route.createControlEvidence),
    /New Resume|resume-workspace-toolbar/,
  );
});

test("dashboard verification failures retain only bounded control diagnostics", async () => {
  await assert.rejects(
    resolveWiseResumeFixtureCreationWorkspace(
      mockedWorkspaceContext({
        events: [],
        routes: [routeResult({ workspaceConfirmed: false, candidateCount: 99 })],
      }),
      { liveAccountSafetyAudit: safeAudit, storedFixture: null },
    ),
    /route=resume-dashboard; workspace=missing; candidates=5; control=not-actionable/,
  );
});

test("fixture preparation clicks the unique dashboard control and no other control before mutation", async () => {
  const events: string[] = [];
  const context = mockedWorkspaceContext({
    events,
    routes: [
      routeResult({ routeCategory: "unrelated" }),
      routeResult({
        createSelector: '[data-testid="resume-workspace-toolbar"] [aria-label="New Resume"]',
      }),
    ],
  });
  await assert.rejects(
    prepareWiseResumeFixtureSmartTailoring(context, {
      liveAccountSafetyAudit: safeAudit,
      storedFixture: null,
      accountFingerprint,
      assertPrivacyShield: async () => undefined,
    }),
    /WiseResume fixture creation did not provide a scoped record ID/,
  );
  assert.deepEqual(
    events.filter((event) => event.startsWith("click:")),
    ["click:true"],
  );
  assert.equal(events.filter((event) => event.startsWith("goto:")).length, 1);
  assert.deepEqual(
    events.filter((event) => event.startsWith("reveal:")),
    ["reveal:create-control"],
  );
});

test("valid dashboard control and stored fixture avoid creation-workspace navigation", async () => {
  const directEvents: string[] = [];
  await resolveWiseResumeFixtureCreationWorkspace(
    mockedWorkspaceContext({
      events: directEvents,
      routes: [
        routeResult({
          createSelector: '[data-testid="resume-workspace-toolbar"] [aria-label="New Resume"]',
        }),
      ],
    }),
    { liveAccountSafetyAudit: safeAudit, storedFixture: null },
  );
  assert.deepEqual(directEvents, ["route:0"]);

  const storedEvents: string[] = [];
  await resolveWiseResumeFixtureCreationWorkspace(
    mockedWorkspaceContext({ events: storedEvents, routes: [routeResult()] }),
    { liveAccountSafetyAudit: safeAudit, storedFixture: fixture },
  );
  assert.deepEqual(storedEvents, ["route:0"]);
});

for (const [name, finalRoute] of [
  ["login redirect", routeResult({ routeCategory: "login" })],
  ["onboarding redirect", routeResult({ routeCategory: "onboarding" })],
  ["unrelated redirect", routeResult({ routeCategory: "unrelated" })],
  ["no dashboard control", routeResult()],
  ["ambiguous controls", routeResult({ candidateCount: 2 })],
  ["hidden control", routeResult({ candidateCount: 1, controlVisible: false })],
  [
    "disabled control",
    routeResult({ candidateCount: 1, controlVisible: true, controlEnabled: false }),
  ],
] as const) {
  test(`dashboard ${name} aborts before a fixture click or mutation`, async () => {
    const events: string[] = [];
    await assert.rejects(
      resolveWiseResumeFixtureCreationWorkspace(
        mockedWorkspaceContext({
          events,
          routes: [routeResult({ routeCategory: "unrelated" }), finalRoute],
        }),
        { liveAccountSafetyAudit: safeAudit, storedFixture: null },
      ),
    );
    assert.equal(
      events.some((event) => event.startsWith("click:")),
      false,
    );
    assert.equal(events.filter((event) => event.startsWith("goto:")).length, 1);
  });
}

test("a failed post-navigation privacy shield aborts without retry or mutation", async () => {
  const events: string[] = [];
  await assert.rejects(
    resolveWiseResumeFixtureCreationWorkspace(
      mockedWorkspaceContext({
        events,
        routes: [routeResult({ routeCategory: "unrelated" }), routeResult()],
      }),
      {
        liveAccountSafetyAudit: safeAudit,
        storedFixture: null,
        assertPrivacyShield: async (checkpoint) => {
          events.push(`shield:${checkpoint}`);
          if (checkpoint === "after-fixture-dashboard-navigation")
            throw new Error("shield restoration failed");
        },
      },
    ),
    /shield restoration failed/,
  );
  assert.equal(events.filter((event) => event.startsWith("goto:")).length, 1);
  assert.equal(
    events.some((event) => event.startsWith("click:")),
    false,
  );
  assert.doesNotMatch(String(resolveWiseResumeFixtureCreationWorkspace), /Steel|session/i);
});

test("fixture write expression writes a stable WiseDemo marker without account-wide fields", () => {
  const expression = wiseResumeFixtureWriteExpression({
    fixtureRecordId: fixture.resumeRecordId,
    fixtureDocument: "[WiseDemo Fixture] Smart Tailoring Demo\nFictional resume content",
  });
  assert.doesNotThrow(() => new Function(expression));
  assert.match(expression, /fixtureMarker/);
  assert.match(expression, /markerWritten/);
  assert.doesNotMatch(expression, /account.*profile|password|credential|secret/i);
});

test("final capture safety requires only the isolated fixture in the viewport", () => {
  const safeViewport = evaluateWiseResumeFixtureViewportSafety({
    activeRecordId: fixture.resumeRecordId,
    fixture,
    fixtureMarkerVisible: true,
    unrelatedResumeTitlesVisible: false,
    accountEmailVisible: false,
    personalDataVisible: false,
  });
  assert.doesNotThrow(() => assertWiseResumeFinalVisibleContentSafe(safeViewport));
  assert.throws(() =>
    assertWiseResumeFinalVisibleContentSafe(
      evaluateWiseResumeFixtureViewportSafety({
        activeRecordId: fixture.resumeRecordId,
        fixture,
        fixtureMarkerVisible: false,
        unrelatedResumeTitlesVisible: true,
        accountEmailVisible: false,
        personalDataVisible: false,
      }),
    ),
  );
  assert.throws(() =>
    assertWiseResumeFinalVisibleContentSafe(
      evaluateWiseResumeFixtureViewportSafety({
        activeRecordId: "wrong-record",
        fixture,
        fixtureMarkerVisible: true,
        unrelatedResumeTitlesVisible: false,
        accountEmailVisible: false,
        personalDataVisible: false,
      }),
    ),
  );
});

test("a rejected non-fixture target leaves the fixture reference and external records unchanged", () => {
  const audit = createWiseResumeFixtureIsolationAudit({
    authenticatedAccountConfirmed: true,
    totalResumeCount: 2,
    fixtureRecordIds: [fixture.resumeRecordId],
    storedFixture: fixture,
    privacyShieldActive: true,
  });
  const existingRecordIds = Object.freeze([fixture.resumeRecordId, "existing-record"]);
  assert.throws(() =>
    assertWiseResumeFixtureMutationAllowed({
      audit,
      fixture,
      targetResumeId: "existing-record",
      operation: "prepare fixture resume",
    }),
  );
  assert.deepEqual(existingRecordIds, [fixture.resumeRecordId, "existing-record"]);
});
