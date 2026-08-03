import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeWiseResumeOperation,
  auditWiseResumeFixtureIsolationAccount,
  assertWiseResumeAccountTextSafe,
  assertWiseResumeOperationOrdering,
  assertWiseResumeRequiredEntityCoverage,
  createWiseResumeFictionalState,
  serializeWiseResumeAdapterArtifact,
  validateWiseResumeFictionalJobPosting,
  validateWiseResumeFictionalResume,
  wiseResumeAuthoritativeInventoryExpression,
  wiseResumeFixtureInventoryExpression,
  type WiseResumeSmartTailoringPlan,
} from "./wiseresume.server.ts";
import { wiseResumeAccountFingerprint } from "../wiseresume-fixture-isolation.server.ts";
import {
  WISE_RESUME_RESPONSE_FORMAT,
  classifyWiseResumeInventoryHttpStatus,
  wiseResumeInventoryQueries,
  wiseResumeWebSdkHeaders,
} from "../wiseresume-appwrite-query.server.ts";

const orderedOperations = [
  "ensure-resume",
  "ensure-profile",
  "ensure-experience",
  "ensure-skills",
  "ensure-education",
  "prepare-job-posting",
  "open-smart-tailoring",
  "verify-before-state",
  "identify-tailoring-action",
  "identify-result-region",
  "prepare-clean-final-take",
];

test("WiseResume fictional Smart Tailoring state is complete and reusable", () => {
  const first = createWiseResumeFictionalState();
  const second = createWiseResumeFictionalState();
  validateWiseResumeFictionalResume(first.resume);
  validateWiseResumeFictionalJobPosting(first.jobPosting);
  first.resume.profile.name = "Changed only in this fixture";
  assert.equal(second.resume.profile.name, "Alex Morgan");
});

test("WiseResume fictional validation rejects real or unsafe content", () => {
  const { resume, jobPosting } = createWiseResumeFictionalState();
  resume.profile.summary = "Lorem ipsum password";
  jobPosting.company = "Private Employer";
  jobPosting.summary = "Contact real.person@example.com for details";
  assert.throws(() => validateWiseResumeFictionalResume(resume), /unsafe/);
  assert.throws(() => validateWiseResumeFictionalJobPosting(jobPosting), /unsafe/);
});

test("WiseResume Smart Tailoring requires both fictional entities and safe ordering", () => {
  assertWiseResumeRequiredEntityCoverage([{ type: "resume" }, { type: "jobPosting" }]);
  assert.throws(() => assertWiseResumeRequiredEntityCoverage([{ type: "resume" }]), /requires/);
  assertWiseResumeOperationOrdering(orderedOperations);
  assert.throws(
    () => assertWiseResumeOperationOrdering([...orderedOperations].reverse()),
    /out of order/,
  );
});

test("WiseResume adapter rejects destructive operations", () => {
  assertSafeWiseResumeOperation("open Smart Tailoring");
  assert.throws(() => assertSafeWiseResumeOperation("delete resume"), /Unsafe/);
  assert.throws(() => assertSafeWiseResumeOperation("send application"), /Unsafe/);
});

test("WiseResume adapter rejects visible non-fixture resumes or personal data", () => {
  assertWiseResumeAccountTextSafe("Dashboard\nNo resumes yet\ndemo-user@test.example");
  assert.throws(
    () => assertWiseResumeAccountTextSafe("Jordan Lee — Job (Tailored)"),
    /non-fixture/,
  );
  assert.throws(() => assertWiseResumeAccountTextSafe("person@example.com"), /personal data/);
});

test("WiseResume adapter artifacts exclude credentials and preserve only sanitized evidence", () => {
  const plan: WiseResumeSmartTailoringPlan = {
    resumeUrl: "https://wiseresume.app/resume",
    tailoringUrl: "https://wiseresume.app/tailoring",
    tailoringActionSelector: "button:nth-of-type(2)",
    beforeEvidence: {
      contentHash: "abc123",
      visibleWordCount: 120,
      candidateTermsPresent: true,
      privateDataDetected: false,
    },
    finalActions: [{ type: "click", selector: "button:nth-of-type(2)" }],
  };
  const serialized = JSON.stringify(serializeWiseResumeAdapterArtifact(plan));
  assert.doesNotMatch(serialized, /username|password|secret|credential/i);
  assert.match(serialized, /abc123/);
});

type BrowserResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function response(status: number, body: unknown): BrowserResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function evaluateAuthoritativeInventory(
  documentsResponse: BrowserResponse,
  storedFixtureRecordId: string | null = null,
) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return requests.length === 1 ? response(200, { $id: "mock-user" }) : documentsResponse;
  };
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const evaluate = new AsyncFunction(
    "fetch",
    "URLSearchParams",
    `return ${wiseResumeAuthoritativeInventoryExpression(storedFixtureRecordId)};`,
  );
  return {
    evidence: await evaluate(fetch, URLSearchParams),
    requests,
  };
}

test("authoritative Appwrite inventory resolves a successful empty response", async () => {
  const { evidence, requests } = await evaluateAuthoritativeInventory(
    response(200, { documents: [] }),
  );
  assert.deepEqual(evidence, {
    source: "appwrite-resumes",
    sourceAvailable: true,
    inventoryResolved: true,
    countEstablished: true,
    totalResumeCount: 0,
    fixtureRecordIds: [],
    requestStatus: "success",
    httpStatusClass: "2xx",
  });
  assert.match(requests[1]!.url, /databases\/main\/collections\/resumes\/documents/);
  const queryValues = new URL(requests[1]!.url).searchParams;
  assert.deepEqual(
    [queryValues.get("queries[0]"), queryValues.get("queries[1]"), queryValues.get("queries[2]")],
    wiseResumeInventoryQueries("mock-user"),
  );
  assert.equal(queryValues.getAll("queries[]").length, 0);
  assert.equal(requests[0]!.init?.credentials, "include");
  assert.equal(requests[1]!.init?.credentials, "include");
  assert.equal(
    (requests[1]!.init?.headers as Record<string, string>)["X-Appwrite-Response-Format"],
    WISE_RESUME_RESPONSE_FORMAT,
  );
  assert.deepEqual(requests[1]!.init?.headers, wiseResumeWebSdkHeaders());
  assert.equal("X-Appwrite-Key" in (requests[1]!.init?.headers as Record<string, string>), false);
});

test("authoritative Appwrite inventory retains only fixture metadata", async () => {
  const { evidence } = await evaluateAuthoritativeInventory(
    response(200, {
      documents: [
        {
          $id: "other-record",
          title: "Private title",
          $updatedAt: "2026-08-03",
          content: "discard",
        },
        {
          $id: "fixture-record",
          title: "[WiseDemo Fixture] Smart Tailoring Demo",
          $updatedAt: "2026-08-03",
          experience: "discard",
        },
      ],
    }),
  );
  const serialized = JSON.stringify(evidence);
  assert.match(serialized, /fixture-record/);
  assert.doesNotMatch(serialized, /other-record|Private title|content|experience|discard/);
});

test("authoritative inventory recognizes a stored fixture without exposing other IDs", async () => {
  const { evidence } = await evaluateAuthoritativeInventory(
    response(200, {
      documents: [
        { $id: "stored-fixture", title: "Fixture renamed", $updatedAt: "2026-08-03" },
        { $id: "other-record", title: "Private title", $updatedAt: "2026-08-03" },
      ],
    }),
    "stored-fixture",
  );
  assert.deepEqual((evidence as { fixtureRecordIds: string[] }).fixtureRecordIds, [
    "stored-fixture",
  ]);
  assert.equal((evidence as { totalResumeCount: number }).totalResumeCount, 2);
});

test("authoritative inventory reports a missing stored fixture without guessing a replacement", async () => {
  const { evidence } = await evaluateAuthoritativeInventory(
    response(200, {
      documents: [{ $id: "other-record", title: "Private title", $updatedAt: "2026-08-03" }],
    }),
    "missing-fixture",
  );
  assert.deepEqual((evidence as { fixtureRecordIds: string[] }).fixtureRecordIds, []);
  assert.equal((evidence as { inventoryResolved: boolean }).inventoryResolved, true);
});

test("authoritative inventory preserves two exact fixture markers for ambiguity handling", async () => {
  const { evidence } = await evaluateAuthoritativeInventory(
    response(200, {
      documents: [
        {
          $id: "fixture-one",
          title: "[WiseDemo Fixture] Smart Tailoring Demo",
          $updatedAt: "2026-08-03",
        },
        {
          $id: "fixture-two",
          title: "[WiseDemo Fixture] Smart Tailoring Demo",
          $updatedAt: "2026-08-03",
        },
      ],
    }),
  );
  assert.equal((evidence as { fixtureRecordIds: string[] }).fixtureRecordIds.length, 2);
});

test("the audit prefers resolved Appwrite inventory and cannot mutate before its safe result", async () => {
  const expectedAccountFingerprint = wiseResumeAccountFingerprint("mock-user");
  const evaluations: string[] = [];
  const audit = await auditWiseResumeFixtureIsolationAccount(
    {
      evaluate: async (expression) => {
        evaluations.push(expression);
        if (expression === "location.hostname") return "wiseresume.app";
        if (expression.includes("liveAccountFingerprint")) {
          return { sourceAvailable: true, liveAccountFingerprint: expectedAccountFingerprint };
        }
        if (expression.includes("wisedemo-privacy-shield")) return true;
        if (expression.includes("storedFixtureRecordId")) {
          return {
            source: "appwrite-resumes",
            sourceAvailable: true,
            inventoryResolved: true,
            totalResumeCount: 2,
            fixtureRecordIds: [],
            requestStatus: "success",
            httpStatusClass: "2xx",
          };
        }
        throw new Error("Unexpected browser evaluation.");
      },
      delay: async () => undefined,
      waitUntil: async () => true,
      goto: async () => undefined,
    },
    {
      expectedAccountFingerprint,
      legacyExpectedAccountFingerprint: "legacy-not-used",
      storedFixture: null,
    },
  );
  assert.equal(audit.status, "safe");
  assert.equal(audit.nonFixtureResumeCount, 2);
  assert.equal(audit.inventoryRequestEvidence?.countEstablished, true);
  assert.deepEqual(audit.inventoryEvidenceSources, ["appwrite-resumes-success"]);
  assert.equal(
    evaluations.some((expression) => expression.includes("resume-workspace-card")),
    false,
  );
});

test("failed authoritative inventory leaves the audit inconclusive with an unknown count", async () => {
  const expectedAccountFingerprint = wiseResumeAccountFingerprint("mock-user");
  const audit = await auditWiseResumeFixtureIsolationAccount(
    {
      evaluate: async (expression) => {
        if (expression === "location.hostname") return "wiseresume.app";
        if (expression.includes("liveAccountFingerprint")) {
          return { sourceAvailable: true, liveAccountFingerprint: expectedAccountFingerprint };
        }
        if (expression.includes("storedFixtureRecordId")) {
          return {
            source: "appwrite-resumes",
            sourceAvailable: true,
            inventoryResolved: false,
            totalResumeCount: null,
            fixtureRecordIds: [],
            requestStatus: "invalid-query",
            httpStatusClass: "4xx",
          };
        }
        if (expression.includes("resume-workspace-row")) {
          return {
            authenticatedAccountConfirmed: false,
            inventoryResolved: true,
            inventoryEvidenceSources: ["empty-state"],
            countEstablished: true,
            totalResumeCount: 0,
            fixtureRecordIds: [],
            privacyShieldActive: true,
          };
        }
        if (expression.includes("wisedemo-privacy-shield")) return true;
        throw new Error("Unexpected browser evaluation.");
      },
      delay: async () => undefined,
      waitUntil: async () => true,
      goto: async () => undefined,
    },
    {
      expectedAccountFingerprint,
      legacyExpectedAccountFingerprint: "legacy-not-used",
      storedFixture: null,
    },
  );
  assert.equal(audit.status, "inconclusive");
  assert.equal(audit.totalResumeCount, null);
  assert.equal(audit.nonFixtureResumeCount, null);
  assert.deepEqual(audit.inventoryRequestEvidence, {
    source: "appwrite-resumes",
    sourceAvailable: true,
    inventoryResolved: false,
    countEstablished: false,
    requestStatus: "invalid-query",
    httpStatusClass: "4xx",
    domFallbackResolved: true,
  });
  assert.deepEqual(audit.inventoryEvidenceSources, [
    "appwrite-resumes-invalid-query",
    "dom-fallback-empty-state",
  ]);
});

for (const [status, requestStatus] of [
  [400, "invalid-query"],
  [401, "unauthorized"],
  [403, "forbidden"],
  [404, "not-found"],
  [429, "rate-limited"],
  [500, "server-error"],
] as const) {
  test(`authoritative inventory classifies HTTP ${status} without a false zero`, async () => {
    const { evidence } = await evaluateAuthoritativeInventory(response(status, {}));
    assert.deepEqual(evidence, {
      source: "appwrite-resumes",
      sourceAvailable: true,
      inventoryResolved: false,
      countEstablished: false,
      totalResumeCount: null,
      fixtureRecordIds: [],
      requestStatus,
      httpStatusClass: status >= 500 ? "5xx" : "4xx",
    });
    assert.equal(classifyWiseResumeInventoryHttpStatus(status).requestStatus, requestStatus);
  });
}

test("authoritative inventory treats network and invalid responses as inconclusive", async () => {
  const invalid = await evaluateAuthoritativeInventory(response(200, { unexpected: true }));
  assert.equal((invalid.evidence as { requestStatus: string }).requestStatus, "invalid-response");
  assert.equal((invalid.evidence as { totalResumeCount: number | null }).totalResumeCount, null);
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const evaluate = new AsyncFunction(
    "fetch",
    "URLSearchParams",
    `return ${wiseResumeAuthoritativeInventoryExpression(null)};`,
  );
  const unavailable = await evaluate(async () => {
    throw new Error("offline");
  }, URLSearchParams);
  assert.equal((unavailable as { requestStatus: string }).requestStatus, "network-error");
});

test("scoped DOM fallback recognizes settled workspace without reading card text", () => {
  const evaluate = new Function(
    "document",
    `return ${wiseResumeFixtureInventoryExpression()};`,
  ) as (document: {
    querySelectorAll: (selector: string) => object[];
    querySelector: (selector: string) => object | null;
    getElementById: () => null;
  }) => {
    inventoryResolved: boolean;
    inventoryEvidenceSources: string[];
    totalResumeCount: number;
  };
  const inventory = evaluate({
    querySelectorAll: (selector) => (selector.includes("resume-workspace") ? [{}, {}] : []),
    querySelector: (selector) => (selector.includes("resume-workspace-card") ? {} : null),
    getElementById: () => null,
  });
  assert.equal(inventory.inventoryResolved, true);
  assert.deepEqual(inventory.inventoryEvidenceSources, ["resume-workspace-card"]);
  assert.equal(inventory.totalResumeCount, 2);
});

test("generic resume selectors cannot resolve the DOM fallback, while the empty state can", () => {
  const evaluate = new Function(
    "document",
    `return ${wiseResumeFixtureInventoryExpression()};`,
  ) as (document: {
    querySelectorAll: () => [];
    querySelector: (selector: string) => object | null;
    getElementById: () => null;
  }) => { inventoryResolved: boolean; inventoryEvidenceSources: string[] };
  const generic = evaluate({
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
  });
  assert.equal(generic.inventoryResolved, false);
  const empty = evaluate({
    querySelectorAll: () => [],
    querySelector: (selector) => (selector.includes("resume-empty-state") ? {} : null),
    getElementById: () => null,
  });
  assert.deepEqual(empty.inventoryEvidenceSources, ["empty-state"]);
});
