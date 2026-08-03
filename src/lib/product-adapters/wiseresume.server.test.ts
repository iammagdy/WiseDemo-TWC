import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeWiseResumeOperation,
  assertWiseResumeAccountTextSafe,
  assertWiseResumeOperationOrdering,
  assertWiseResumeRequiredEntityCoverage,
  createWiseResumeFictionalState,
  serializeWiseResumeAdapterArtifact,
  validateWiseResumeFictionalJobPosting,
  validateWiseResumeFictionalResume,
  wiseResumeFixtureInventoryExpression,
  type WiseResumeSmartTailoringPlan,
} from "./wiseresume.server.ts";

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

test("WiseResume inventory recognizes a settled resume workspace without reading resume content", () => {
  const evaluate = new Function(
    "document",
    "HTMLAnchorElement",
    "getComputedStyle",
    "location",
    `return ${wiseResumeFixtureInventoryExpression()};`,
  ) as (
    document: {
      querySelectorAll: () => [];
      querySelector: (selector: string) => object | null;
      getElementById: () => null;
    },
    anchor: new () => object,
    getComputedStyle: () => { display: string; visibility: string },
    location: { href: string },
  ) => { inventoryResolved: boolean; totalResumeCount: number };
  const inventory = evaluate(
    {
      querySelectorAll: () => [],
      querySelector: (selector) => (selector.includes("New Resume") ? {} : null),
      getElementById: () => null,
    },
    class {},
    () => ({ display: "block", visibility: "visible" }),
    { href: "https://example.test/dashboard" },
  );
  assert.equal(inventory.inventoryResolved, true);
  assert.equal(inventory.totalResumeCount, 0);
});
