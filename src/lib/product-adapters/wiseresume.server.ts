import type { RecordingLocale } from "../recording-locale";
import type { CdpAction } from "../steel-recorder.server";
import {
  fixtureViewportMaskAllowControlExpression,
  WISEDEMO_FIXTURE_VIEWPORT_MASK_ID,
} from "../steel-privacy-shield.server.ts";
import {
  WISE_RESUME_APPWRITE_ENDPOINT,
  wiseResumeWebSdkHeaders,
  wiseResumeWebSdkQueryRuntimeSource,
  type WiseResumeHttpStatusClass,
  type WiseResumeInventoryRequestStatus,
} from "../wiseresume-appwrite-query.server.ts";
import {
  assertLiveAccountMutationAllowed,
  type LiveAccountSafetyAudit,
} from "../live-account-safety.server.ts";
import {
  WISE_RESUME_FIXTURE_TITLE,
  assertWiseResumeFinalVisibleContentSafe,
  assertWiseResumeFixtureCreationAllowed,
  assertWiseResumeFixtureMutationAllowed,
  createWiseResumeFixtureIsolationAudit,
  createWiseResumeFixtureReference,
  type WiseResumeFinalVisibleSafety,
  type WiseResumeFixtureReference,
} from "../wiseresume-fixture-isolation.server.ts";

export type ProductLocaleAdapterContext = {
  evaluate: (expression: string) => Promise<unknown>;
  delay: (milliseconds: number) => Promise<unknown>;
  waitUntil: (expression: string, timeoutMs: number) => Promise<boolean>;
  goto: (url: string, settleMs: number) => Promise<void>;
  assertActive?: () => void;
};

const WISE_RESUME_CREATION_CONTROL_REVEAL_SELECTOR = [
  '[aria-label="New Resume"]',
  '[aria-label="Create Resume"]',
  '[data-testid="new-resume"]',
  '[data-testid="create-resume"]',
].join(", ");

export type WiseResumeFictionalResume = {
  profile: { name: string; currentRole: string; summary: string };
  experience: Array<{ company: string; title: string; achievements: string[] }>;
  skills: string[];
  education: { institution: string; program: string; focus: string };
};

export type WiseResumeFictionalJobPosting = {
  title: string;
  company: string;
  summary: string;
  requirements: string[];
};

export type WiseResumeSmartTailoringPlan = {
  resumeUrl: string;
  tailoringUrl: string;
  tailoringActionSelector: string;
  beforeEvidence: {
    contentHash: string;
    visibleWordCount: number;
    candidateTermsPresent: boolean;
    privateDataDetected: boolean;
  };
  finalActions: CdpAction[];
  createControlEvidence?: WiseResumeCreateControlEvidence;
};

export type WiseResumeCreateControlEvidence = {
  routeCategory: "resume-dashboard" | "login" | "onboarding" | "unrelated" | "unknown";
  workspaceConfirmed: boolean;
  candidateCount: number;
  selectorCategory: "data-testid" | "aria-label" | "exact-role-label" | "none";
  controlVisible: boolean;
  controlEnabled: boolean;
};

export type WiseResumeFixturePreparationStage =
  | "reveal-creation-control"
  | "resolve-fixture-workspace"
  | "create-or-reuse-fixture"
  | "create-fixture-before-click"
  | "create-fixture-transition"
  | "resolve-created-fixture"
  | "open-fixture"
  | "write-fictional-resume"
  | "open-tailoring-workflow"
  | "write-fictional-job-posting"
  | "verify-final-viewport";

export type WiseResumeTransformationEvidence = {
  beforeHash: string;
  afterHash: string;
  beforeWordCount: number;
  afterWordCount: number;
  changed: boolean;
  targetTermsVisible: boolean;
  tailoredResultVisible: boolean;
  privateDataDetected: boolean;
};

const unsafeDemoData =
  /(?:lorem ipsum|password|secret|api[_ -]?key|access token|\bdelete\b|\bbilling\b|\blogout\b|\bpublish\b|\bapply now\b)/i;
const sensitiveFictionalData =
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b|\b(?:\d[ -]*?){13,16}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export const wiseResumeFictionalResume: WiseResumeFictionalResume = {
  profile: {
    name: "Alex Morgan",
    currentRole: "Product Marketing Manager",
    summary:
      "Product marketer focused on clear positioning, launch readiness, and measurable customer insight for B2B software teams.",
  },
  experience: [
    {
      company: "Northstar Cloud Studio",
      title: "Product Marketing Manager",
      achievements: [
        "Created launch narratives for fictional workflow products.",
        "Partnered with sales and product teams on audience research.",
        "Built reporting stories that connected product usage to campaign learning.",
      ],
    },
  ],
  skills: [
    "Product positioning",
    "Go-to-market strategy",
    "Customer research",
    "Campaign analytics",
    "Cross-functional collaboration",
  ],
  education: {
    institution: "Ridgeway Institute",
    program: "Bachelor of Business Communication",
    focus: "Marketing and analytics",
  },
};

export const wiseResumeFictionalJobPosting: WiseResumeFictionalJobPosting = {
  title: "Senior Product Marketing Manager",
  company: "Asterloop Software",
  summary:
    "Lead positioning and launch programs for a fictional B2B workflow platform serving growing product teams.",
  requirements: [
    "Own go-to-market strategy for new product capabilities.",
    "Translate customer research into product narratives and sales enablement.",
    "Partner with product, sales, and analytics teams to evaluate launch learning.",
    "Communicate clearly across cross-functional stakeholders.",
  ],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertSafeFictionalText(value: string, label: string) {
  if (!value.trim() || unsafeDemoData.test(value) || sensitiveFictionalData.test(value)) {
    throw new Error(`WiseResume fictional ${label} is missing or unsafe.`);
  }
}

export function createWiseResumeFictionalState() {
  const resume = clone(wiseResumeFictionalResume);
  const jobPosting = clone(wiseResumeFictionalJobPosting);
  validateWiseResumeFictionalResume(resume);
  validateWiseResumeFictionalJobPosting(jobPosting);
  return { resume, jobPosting };
}

export function validateWiseResumeFictionalResume(resume: WiseResumeFictionalResume): void {
  assertSafeFictionalText(resume.profile.name, "candidate name");
  assertSafeFictionalText(resume.profile.currentRole, "current role");
  assertSafeFictionalText(resume.profile.summary, "summary");
  if (!resume.experience.length || !resume.skills.length) {
    throw new Error("WiseResume fictional resume requires experience and skills.");
  }
  for (const experience of resume.experience) {
    assertSafeFictionalText(experience.company, "employer");
    assertSafeFictionalText(experience.title, "experience title");
    if (!experience.achievements.length)
      throw new Error("WiseResume fictional experience requires achievements.");
    experience.achievements.forEach((achievement) =>
      assertSafeFictionalText(achievement, "experience achievement"),
    );
  }
  resume.skills.forEach((skill) => assertSafeFictionalText(skill, "skill"));
  assertSafeFictionalText(resume.education.institution, "education institution");
  assertSafeFictionalText(resume.education.program, "education program");
  assertSafeFictionalText(resume.education.focus, "education focus");
}

export function validateWiseResumeFictionalJobPosting(job: WiseResumeFictionalJobPosting): void {
  assertSafeFictionalText(job.title, "job title");
  assertSafeFictionalText(job.company, "job company");
  assertSafeFictionalText(job.summary, "job summary");
  if (job.requirements.length < 3)
    throw new Error("WiseResume fictional job posting requires realistic requirements.");
  job.requirements.forEach((requirement) =>
    assertSafeFictionalText(requirement, "job requirement"),
  );
}

export function assertWiseResumeRequiredEntityCoverage(entities: ReadonlyArray<{ type: string }>) {
  const types = new Set(entities.map((entity) => entity.type));
  if (!types.has("resume") || !types.has("jobPosting")) {
    throw new Error("Smart Tailoring requires fictional resume and jobPosting entities.");
  }
}

export function assertWiseResumeOperationOrdering(operations: readonly string[]) {
  const required = [
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
  let previous = -1;
  for (const operation of required) {
    const index = operations.indexOf(operation);
    if (index < 0 || index <= previous) {
      throw new Error("WiseResume Smart Tailoring operations are incomplete or out of order.");
    }
    previous = index;
  }
}

export function assertSafeWiseResumeOperation(operation: string) {
  if (
    /(delete|remove|billing|payment|logout|publish|send application|external integration)/i.test(
      operation,
    )
  ) {
    throw new Error("Unsafe WiseResume operation rejected.");
  }
}

export function assertWiseResumeAccountTextSafe(visibleText: string) {
  const nonFixtureRecords = (
    visibleText.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\s+—\s+Job\b/g) ?? []
  ).filter((record) => !record.startsWith("Alex Morgan"));
  const emails = visibleText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? [];
  const personalEmail = emails.some((email) => !/(test|demo|qa|sandbox|wisedemo)/i.test(email));
  if (
    nonFixtureRecords.length ||
    personalEmail ||
    /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b|\b(?:\d[ -]*?){13,16}\b/.test(visibleText)
  ) {
    throw new Error("WiseResume account contains visible non-fixture or personal data.");
  }
}

export async function auditWiseResumeLiveAccount(
  context: ProductLocaleAdapterContext,
  expectedCredentialIdentifier: string,
): Promise<LiveAccountSafetyAudit> {
  if (!(await isWiseResume(context))) {
    return {
      status: "inconclusive",
      mode: "fixture-isolation",
      authenticatedAccountConfirmed: false,
      totalResumeCount: null,
      fixtureResumeCount: null,
      nonFixtureResumeCount: null,
      fixtureIsolated: false,
      privacyShieldActive: false,
      mutationScopeLockedToFixture: false,
      personalDataMarkersFound: false,
      reasons: ["The authenticated WiseResume page was unavailable for a safety audit."],
      auditedAt: new Date().toISOString(),
    };
  }
  const audit = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const body = text(document.body);
      const expected = ${JSON.stringify(expectedCredentialIdentifier.toLowerCase())};
      const records = body.match(/\\b[A-Z][a-z]+ [A-Z][a-z]+\\s+—\\s+Job\\b/g) || [];
      const fixtureRecords = records.filter((record) => /^(Alex Morgan|WiseDemo Fixture|QA Tailoring)/i.test(record));
      const nonFixtureRecords = records.filter((record) => !fixtureRecords.includes(record));
      return {
        authenticatedAccountConfirmed: Boolean(expected) && body.toLowerCase().includes(expected),
        totalResumeCount: records.length,
        fixtureResumeCount: fixtureRecords.length,
        nonFixtureResumeCount: nonFixtureRecords.length,
        personalDataMarkersFound: hasPrivateData(body),
      };
    })()`),
  );
  const authenticatedAccountConfirmed = audit?.authenticatedAccountConfirmed === true;
  const totalResumeCount = typeof audit?.totalResumeCount === "number" ? audit.totalResumeCount : 0;
  const fixtureResumeCount =
    typeof audit?.fixtureResumeCount === "number" ? audit.fixtureResumeCount : 0;
  const nonFixtureResumeCount =
    typeof audit?.nonFixtureResumeCount === "number" ? audit.nonFixtureResumeCount : 0;
  const personalDataMarkersFound = audit?.personalDataMarkersFound === true;
  const reasons: string[] = [];
  if (!authenticatedAccountConfirmed)
    reasons.push("Authenticated account identity could not be confirmed.");
  if (nonFixtureResumeCount) reasons.push("Visible non-fixture resume records were found.");
  if (personalDataMarkersFound) reasons.push("Visible personal-data markers were found.");
  return {
    status:
      nonFixtureResumeCount || personalDataMarkersFound
        ? "unsafe"
        : authenticatedAccountConfirmed
          ? "safe"
          : "inconclusive",
    authenticatedAccountConfirmed,
    totalResumeCount,
    fixtureResumeCount,
    nonFixtureResumeCount,
    mode: nonFixtureResumeCount > 0 ? "fixture-isolation" : "empty-account",
    fixtureIsolated: nonFixtureResumeCount === 0,
    privacyShieldActive: false,
    mutationScopeLockedToFixture: false,
    personalDataMarkersFound,
    reasons,
    auditedAt: new Date().toISOString(),
  };
}

function resumeDocument(resume: WiseResumeFictionalResume): string {
  return [
    resume.profile.name,
    resume.profile.currentRole,
    resume.profile.summary,
    "Experience",
    ...resume.experience.flatMap((entry) => [entry.title, entry.company, ...entry.achievements]),
    "Skills",
    ...resume.skills,
    "Education",
    resume.education.program,
    resume.education.institution,
    resume.education.focus,
  ].join("\n");
}

function jobDocument(job: WiseResumeFictionalJobPosting): string {
  return [job.title, job.company, job.summary, "Requirements", ...job.requirements].join("\n");
}

function browserHelpers() {
  return `
    const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 4 && rect.height > 4 && style.visibility !== "hidden" && style.display !== "none"; };
    const text = (element) => String(element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim();
    const cssPath = (element) => {
      if (element.id) return "#" + CSS.escape(element.id);
      if (element.getAttribute("data-testid")) return '[data-testid="' + element.getAttribute("data-testid").replace(/"/g, "") + '"]';
      if (element.getAttribute("aria-label")) return '[aria-label="' + element.getAttribute("aria-label").replace(/"/g, "") + '"]';
      if (element.getAttribute("name")) return element.tagName.toLowerCase() + '[name="' + element.getAttribute("name").replace(/"/g, "") + '"]';
      const parts = []; let node = element;
      while (node && node.nodeType === 1 && parts.length < 6) { let part = node.tagName.toLowerCase(); const parent = node.parentElement; if (parent) { const peers = Array.from(parent.children).filter((peer) => peer.tagName === node.tagName); if (peers.length > 1) part += ":nth-of-type(" + (peers.indexOf(node) + 1) + ")"; } parts.unshift(part); node = node.parentElement; }
      return parts.join(" > ");
    };
    const hash = (value) => { let result = 2166136261; for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16); };
    const hasPrivateData = (value) => {
      if (/\\b\\d{3}[-.\\s]?\\d{2}[-.\\s]?\\d{4}\\b|\\b(?:\\d[ -]*?){13,16}\\b/.test(value)) return true;
      const emails = value.match(/\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/gi) || [];
      return emails.some((email) => !/(test|demo|qa|sandbox|wisedemo)/i.test(email));
    };
    const setValue = (element, value) => {
      const existing = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.innerText;
      if (existing && existing.trim() && !existing.includes("Alex Morgan")) return false;
      if (element instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
      else if (element instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(element, value);
      else { element.focus(); element.textContent = value; }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    };
  `;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export async function prepareWiseResumeSmartTailoring(
  context: ProductLocaleAdapterContext,
  input: { liveAccountSafetyAudit?: LiveAccountSafetyAudit } = {},
): Promise<WiseResumeSmartTailoringPlan> {
  assertLiveAccountMutationAllowed(input.liveAccountSafetyAudit);
  if (!(await isWiseResume(context)))
    throw new Error("WiseResume adapter received a non-WiseResume page.");
  const { resume, jobPosting } = createWiseResumeFictionalState();
  assertWiseResumeRequiredEntityCoverage([{ type: "resume" }, { type: "jobPosting" }]);
  assertWiseResumeOperationOrdering([
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
  ]);

  const accountSafety = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const visibleText = text(document.body);
      const records = (visibleText.match(/\\b[A-Z][a-z]+ [A-Z][a-z]+\\s+—\\s+Job\\b/g) || []).filter((record) => !record.startsWith("Alex Morgan"));
      return { nonFixtureRecordCount: records.length, privateDataDetected: hasPrivateData(visibleText) };
    })()`),
  );
  if (
    (typeof accountSafety?.nonFixtureRecordCount === "number" &&
      accountSafety.nonFixtureRecordCount > 0) ||
    accountSafety?.privateDataDetected === true
  ) {
    throw new Error("WiseResume account contains visible non-fixture or personal data.");
  }

  const navigation = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const links = Array.from(document.querySelectorAll("a[href]")).filter(visible);
      const resume = links.find((link) => /resume|cv|profile|editor/i.test(text(link) + " " + link.getAttribute("href")));
      if (!resume) return null;
      return { origin: location.origin, resumeUrl: resume.href };
    })()`),
  );
  const origin = asString(navigation?.origin);
  const resumeUrl = asString(navigation?.resumeUrl);
  if (!origin || !resumeUrl || new URL(resumeUrl).origin !== origin)
    throw new Error(
      "WiseResume fictional resume route could not be resolved safely from the live DOM.",
    );
  await context.goto(resumeUrl, 1_500);
  if (
    !(await context.waitUntil(
      'document.readyState === "interactive" || document.readyState === "complete"',
      12_000,
    ))
  ) {
    throw new Error("WiseResume resume editor did not settle before fictional-state preparation.");
  }

  const resumePrepared = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const documentText = ${JSON.stringify(resumeDocument(resume))};
      const candidates = Array.from(document.querySelectorAll("textarea, [contenteditable=true], input")).filter(visible);
      const primary = candidates.find((element) => /resume|summary|experience|profile|about|content/i.test(text(element) + " " + element.getAttribute("name") + " " + element.getAttribute("placeholder") + " " + element.getAttribute("aria-label"))) || candidates.find((element) => element instanceof HTMLTextAreaElement || element.getAttribute("contenteditable") === "true");
      if (!primary || !setValue(primary, documentText)) return { prepared: false };
      const visibleText = text(document.body);
      return { prepared: true, candidateTermsPresent: /Alex Morgan|Product Marketing Manager/i.test(visibleText), privateDataDetected: hasPrivateData(visibleText), contentHash: hash(visibleText), visibleWordCount: visibleText.split(/\\s+/).filter(Boolean).length };
    })()`),
  );
  if (resumePrepared?.prepared !== true || resumePrepared?.candidateTermsPresent !== true) {
    throw new Error(
      "WiseResume fictional resume fields could not be prepared without overwriting non-test state.",
    );
  }
  if (resumePrepared.privateDataDetected === true) {
    throw new Error("WiseResume test account exposes private data in the capture viewport.");
  }

  const workflow = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const controls = Array.from(document.querySelectorAll("a[href], button, [role=button]")).filter(visible);
      const action = controls.find((element) => /smart tailoring|tailor.*resume|tailor|optimi[sz]e.*resume|match.*job/i.test(text(element)));
      if (!action) return null;
      return { href: action instanceof HTMLAnchorElement ? action.href : null, selector: cssPath(action), origin: location.origin };
    })()`),
  );
  const workflowHref = asString(workflow?.href);
  const workflowSelector = asString(workflow?.selector);
  if (workflowHref && new URL(workflowHref).origin === origin) {
    await context.goto(workflowHref, 1_500);
  } else if (workflowSelector) {
    const opened = await context.evaluate(
      `(() => { const target = document.querySelector(${JSON.stringify(workflowSelector)}); if (!target) return false; target.click(); return true; })()`,
    );
    if (opened !== true)
      throw new Error("WiseResume Smart Tailoring workflow could not be opened safely.");
    await context.delay(1_200);
  } else {
    throw new Error("WiseResume Smart Tailoring workflow was not available in the live DOM.");
  }

  const jobPrepared = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const posting = ${JSON.stringify(jobDocument(jobPosting))};
      const inputs = Array.from(document.querySelectorAll("textarea, [contenteditable=true], input")).filter(visible);
      const jobInput = inputs.find((element) => /job description|job posting|target role|role description|paste.*job/i.test(text(element) + " " + element.getAttribute("name") + " " + element.getAttribute("placeholder") + " " + element.getAttribute("aria-label")));
      if (!jobInput || !setValue(jobInput, posting)) return { prepared: false };
      const controls = Array.from(document.querySelectorAll("button, [role=button]")).filter(visible);
      const tailor = controls.find((element) => /smart tailoring|tailor.*resume|tailor|optimi[sz]e.*resume|match.*job|generate.*tailor/i.test(text(element)));
      if (!tailor) return { prepared: false };
      const visibleText = text(document.body);
      return { prepared: true, tailoringUrl: location.href, tailoringActionSelector: cssPath(tailor), contentHash: hash(visibleText), visibleWordCount: visibleText.split(/\\s+/).filter(Boolean).length, candidateTermsPresent: /Alex Morgan|Product Marketing Manager/i.test(visibleText), privateDataDetected: hasPrivateData(visibleText) };
    })()`),
  );
  const tailoringUrl = asString(jobPrepared?.tailoringUrl);
  const tailoringActionSelector = asString(jobPrepared?.tailoringActionSelector);
  if (jobPrepared?.prepared !== true || !tailoringUrl || !tailoringActionSelector) {
    throw new Error(
      "WiseResume fictional job posting or Smart Tailoring action could not be prepared safely.",
    );
  }
  if (jobPrepared.privateDataDetected === true) {
    throw new Error("WiseResume test account exposes private data in the tailoring viewport.");
  }

  const beforeEvidence = {
    contentHash: asString(jobPrepared.contentHash) ?? "",
    visibleWordCount:
      typeof jobPrepared.visibleWordCount === "number" ? jobPrepared.visibleWordCount : 0,
    candidateTermsPresent: jobPrepared.candidateTermsPresent === true,
    privateDataDetected: jobPrepared.privateDataDetected === true,
  };
  if (
    !beforeEvidence.contentHash ||
    !beforeEvidence.candidateTermsPresent ||
    beforeEvidence.privateDataDetected
  ) {
    throw new Error("WiseResume Smart Tailoring before state could not be verified safely.");
  }
  return {
    resumeUrl,
    tailoringUrl,
    tailoringActionSelector,
    beforeEvidence,
    finalActions: [
      { type: "goto", url: resumeUrl, waitMs: 1_800 },
      { type: "wait", ms: 1_200 },
      { type: "goto", url: tailoringUrl, waitMs: 1_600 },
      { type: "wait", ms: 700 },
      { type: "click", selector: tailoringActionSelector },
      { type: "wait", ms: 3_600 },
    ],
  };
}

export async function verifyWiseResumeSmartTailoringTransformation(
  context: ProductLocaleAdapterContext,
  plan: WiseResumeSmartTailoringPlan,
): Promise<WiseResumeTransformationEvidence> {
  const result = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const body = text(document.body);
      const tailoredResultVisible = /tailored|optimized|matched|suggested changes|updated resume|resume updated|review changes/i.test(body);
      const targetTermsVisible = /go-to-market|customer research|cross-functional|product narrative|launch/i.test(body);
      return { afterHash: hash(body), afterWordCount: body.split(/\\s+/).filter(Boolean).length, tailoredResultVisible, targetTermsVisible, privateDataDetected: hasPrivateData(body) };
    })()`),
  );
  const evidence: WiseResumeTransformationEvidence = {
    beforeHash: plan.beforeEvidence.contentHash,
    afterHash: asString(result?.afterHash) ?? "",
    beforeWordCount: plan.beforeEvidence.visibleWordCount,
    afterWordCount: typeof result?.afterWordCount === "number" ? result.afterWordCount : 0,
    changed: Boolean(result?.afterHash && result.afterHash !== plan.beforeEvidence.contentHash),
    targetTermsVisible: result?.targetTermsVisible === true,
    tailoredResultVisible: result?.tailoredResultVisible === true,
    privateDataDetected: result?.privateDataDetected === true,
  };
  if (
    !evidence.changed ||
    !evidence.targetTermsVisible ||
    !evidence.tailoredResultVisible ||
    evidence.privateDataDetected
  ) {
    throw new Error(
      "WiseResume Smart Tailoring did not produce a verified safe visible transformation.",
    );
  }
  return evidence;
}

export function serializeWiseResumeAdapterArtifact(plan: WiseResumeSmartTailoringPlan) {
  return {
    resumeUrl: plan.resumeUrl,
    tailoringUrl: plan.tailoringUrl,
    tailoringActionSelector: plan.tailoringActionSelector,
    beforeEvidence: plan.beforeEvidence,
    finalActionTypes: plan.finalActions.map((action) => action.type),
    createControlEvidence: plan.createControlEvidence ?? null,
  };
}

export type WiseResumeFixtureSmartTailoringPlan = WiseResumeSmartTailoringPlan & {
  fixture: WiseResumeFixtureReference;
  finalVisibleSafety: WiseResumeFinalVisibleSafety;
  capacityDeletion?: WiseResumeCapacityDeletionEvidence;
};

export type WiseResumeCapacityDeletionEvidence = {
  selectionCategory:
    "experimental" | "duplicate-copy" | "incomplete" | "trial" | "oldest-non-primary";
  nonPrimaryConfirmed: true;
  nonMasterConfirmed: true;
  exactTargetCount: 1;
  deletionSuccess: true;
  inventoryCountBefore: number;
  inventoryCountAfter: number;
};

type WiseResumeFixtureInventoryFacts = {
  authenticatedAccountConfirmed: boolean;
  inventoryResolved: boolean;
  inventoryEvidenceSources: string[];
  totalResumeCount: number | null;
  fixtureRecordIds: string[];
  privacyShieldActive: boolean;
  authoritativeRequestStatus: WiseResumeInventoryRequestStatus;
  authoritativeHttpStatusClass: WiseResumeHttpStatusClass;
  domFallbackResolved: boolean | null;
};

export type WiseResumeInventoryEvidence = {
  source: "appwrite-resumes";
  sourceAvailable: boolean;
  inventoryResolved: boolean;
  countEstablished: boolean;
  totalResumeCount: number | null;
  fixtureRecordIds: string[];
  requestStatus: WiseResumeInventoryRequestStatus;
  httpStatusClass: WiseResumeHttpStatusClass;
};

export function wiseResumeFixtureRouteExpression(fixtureRecordId: string | null): string {
  return `(() => {
    const expectedId = ${JSON.stringify(fixtureRecordId)};
    const cssPath = (element) => element.id ? "#" + CSS.escape(element.id) : element.getAttribute("data-testid") ? '[data-testid="' + element.getAttribute("data-testid").replace(/"/g, "") + '"]' : element.tagName.toLowerCase() + ":nth-of-type(" + (Array.from(element.parentElement?.children || []).filter((child) => child.tagName === element.tagName).indexOf(element) + 1) + ")";
    const recordId = (element) => {
      for (const attribute of ["data-resume-id", "data-record-id", "data-id", "data-document-id"]) { const value = element.getAttribute(attribute); if (value) return value; }
      const href = element instanceof HTMLAnchorElement ? element.href : element.getAttribute("href");
      if (!href) return null;
      try { const url = new URL(href, location.href); return url.searchParams.get("resumeId") || url.searchParams.get("resume_id") || (url.pathname.split("/").filter(Boolean).at(-1) || null); } catch { return null; }
    };
    const entries = Array.from(document.querySelectorAll("[data-resume-id], [data-record-id], [data-document-id], a[href*='resume']")).map((element) => ({ element, id: recordId(element) })).filter((entry) => entry.id && !/^(resume|resumes|editor|edit|new)$/i.test(entry.id));
    const fixtureEntry = expectedId ? entries.find((entry) => entry.id === expectedId) : null;
    const href = fixtureEntry?.element instanceof HTMLAnchorElement ? fixtureEntry.element.href : fixtureEntry?.element.getAttribute("href");
    const expectedOrigin = "https://wiseresume.app";
    const path = location.pathname.replace(/\\/+$/, "") || "/";
    const routeCategory = location.origin !== expectedOrigin ? "unrelated" : /(?:login|sign-in|auth)/i.test(path) ? "login" : /(?:onboarding|template|profile)/i.test(path) ? "onboarding" : path === "/dashboard" ? "resume-dashboard" : path ? "unrelated" : "unknown";
    const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 4 && rect.height > 4 && style.display !== "none" && style.visibility !== "hidden"; };
    const reachableBehindFixtureMask = (element) => {
      if (visible(element)) return true;
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      const mask = document.getElementById(${JSON.stringify(WISEDEMO_FIXTURE_VIEWPORT_MASK_ID)});
      const maskHidesElement = Boolean(mask && Array.from(mask.sheet?.cssRules || []).some((rule) => rule instanceof CSSStyleRule && rule.style.getPropertyValue("visibility") === "hidden" && rule.style.getPropertyPriority("visibility") === "important" && Boolean(rule.selectorText) && Boolean(element.closest(rule.selectorText))));
      return Boolean(maskHidesElement && rect.width > 4 && rect.height > 4 && style.display !== "none" && style.visibility === "hidden" && !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
    };
    const workspaceDefinitions = [
      '[data-testid="resume-workspace-toolbar"]',
      '[data-testid="resume-workspace"]',
      '[aria-label="Resume workspace toolbar"]',
      '[aria-label="Resume workspace"]',
    ];
    const declaredWorkspaceDefinition = workspaceDefinitions.find((selector) => { const element = document.querySelector(selector); return element && visible(element); }) || null;
    // WiseResume's authenticated dashboard currently exposes a stable New Resume
    // control but no explicit workspace test id or semantic main element. Treat
    // only the control's direct parent as the workspace when that exact
    // dashboard-owned control is singular and visible; never use a broad page
    // root or a list position as a creation target.
    const dashboardCreateControls = Array.from(document.querySelectorAll('[aria-label="New Resume"], [aria-label="Create Resume"], [data-testid="new-resume"], [data-testid="create-resume"]')).filter((element) => reachableBehindFixtureMask(element) && !(element instanceof HTMLButtonElement && element.disabled) && element.getAttribute("aria-disabled") !== "true");
    const dashboardWorkspaceFallback = routeCategory === "resume-dashboard" && dashboardCreateControls.length === 1 ? dashboardCreateControls[0].parentElement : null;
    const workspaceDefinition = declaredWorkspaceDefinition || (dashboardWorkspaceFallback ? "direct-parent" : null);
    const workspace = declaredWorkspaceDefinition ? document.querySelector(declaredWorkspaceDefinition) : dashboardWorkspaceFallback;
    const workspaceConfirmed = routeCategory === "resume-dashboard" && Boolean(workspace) && (Boolean(declaredWorkspaceDefinition) || dashboardCreateControls.length === 1);
    const controlDefinitions = [
      { selector: '[data-testid="create-resume"]', category: "data-testid" },
      { selector: '[data-testid="new-resume"]', category: "data-testid" },
      { selector: '[aria-label="Create Resume"]', category: "aria-label" },
      { selector: '[aria-label="New Resume"]', category: "aria-label" },
      { selector: 'button[role="button"]', category: "exact-role-label" },
      { selector: "button", category: "exact-role-label" },
    ];
    const candidates = workspace ? controlDefinitions.flatMap((definition) => Array.from(workspace.querySelectorAll(definition.selector)).filter((element) => definition.category !== "exact-role-label" || String(element.textContent || "").replace(/\\s+/g, " ").trim() === "Create Resume").map((element) => ({ element, definition }))) : [];
    const uniqueCandidates = candidates.filter((candidate, index) => candidates.findIndex((other) => other.element === candidate.element) === index);
    const candidate = uniqueCandidates.length === 1 ? uniqueCandidates[0] : null;
    const controlVisible = Boolean(candidate && reachableBehindFixtureMask(candidate.element));
    const controlEnabled = Boolean(candidate && !(candidate.element instanceof HTMLButtonElement && candidate.element.disabled) && candidate.element.getAttribute("aria-disabled") !== "true");
    const selectorCategory = candidate && controlVisible && controlEnabled ? candidate.definition.category : "none";
    const createSelector = candidate && selectorCategory !== "none" ? declaredWorkspaceDefinition ? workspaceDefinition + " " + candidate.definition.selector : candidate.definition.selector : null;
    return {
      origin: location.origin,
      resumeUrl: href || null,
      recordId: fixtureEntry?.id || null,
      fixtureSelector: fixtureEntry ? cssPath(fixtureEntry.element) : null,
      createSelector,
      createControlEvidence: { routeCategory, workspaceConfirmed, candidateCount: uniqueCandidates.length, selectorCategory, controlVisible, controlEnabled },
    };
  })()`;
}

export function wiseResumeFixtureWriteExpression(input: {
  fixtureRecordId: string;
  fixtureDocument: string;
}): string {
  return `(() => { ${browserHelpers()}
    const expectedId = ${JSON.stringify(input.fixtureRecordId)};
    const fixtureMarker = ${JSON.stringify(WISE_RESUME_FIXTURE_TITLE)};
    const documentText = ${JSON.stringify(input.fixtureDocument)};
    const locationMatches = location.href.includes(expectedId);
    const fields = Array.from(document.querySelectorAll("textarea, [contenteditable=true], input")).filter(visible);
    const fieldLabel = (element) => text(element) + " " + String(element.getAttribute("name") || "") + " " + String(element.getAttribute("placeholder") || "") + " " + String(element.getAttribute("aria-label") || "");
    const titleField = fields.find((element) => /resume title|document title|^title$|title/i.test(fieldLabel(element)));
    const primary = fields.find((element) => !/title/i.test(fieldLabel(element)) && /resume|summary|experience|profile|about|content/i.test(fieldLabel(element))) || fields.find((element) => element instanceof HTMLTextAreaElement || element.getAttribute("contenteditable") === "true");
    const write = (element, value) => {
      if (!element) return false;
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
      if (setter) setter.call(element, value); else element.textContent = value;
      element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); element.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    };
    if (!locationMatches || !primary || !write(primary, documentText)) return { prepared: false, targetMatched: locationMatches, markerWritten: false };
    const titleWritten = titleField ? write(titleField, fixtureMarker) : true;
    const visibleText = text(document.body);
    return { prepared: /Alex Morgan|Product Marketing Manager/i.test(visibleText), targetMatched: locationMatches, markerWritten: titleWritten && visibleText.includes(fixtureMarker), contentHash: hash(visibleText), visibleWordCount: visibleText.trim().split(" ").filter(Boolean).length, candidateTermsPresent: /Product Marketing Manager/i.test(visibleText), privateDataDetected: hasPrivateData(visibleText) };
  })()`;
}

export function evaluateWiseResumeFixtureViewportSafety(input: {
  activeRecordId: string | null;
  fixture: WiseResumeFixtureReference;
  fixtureMarkerVisible: boolean;
  unrelatedResumeTitlesVisible: boolean;
  accountEmailVisible: boolean;
  personalDataVisible: boolean;
}): WiseResumeFinalVisibleSafety {
  const activeRecordMatchesFixture = input.activeRecordId === input.fixture.resumeRecordId;
  return {
    fixtureActive: activeRecordMatchesFixture && input.fixtureMarkerVisible,
    activeRecordMatchesFixture,
    fixtureMarkerVisible: input.fixtureMarkerVisible,
    unrelatedResumeTitlesVisible: input.unrelatedResumeTitlesVisible,
    accountEmailVisible: input.accountEmailVisible,
    personalDataVisible: input.personalDataVisible,
  };
}

function resumeRecordIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const queryId = url.searchParams.get("resumeId") ?? url.searchParams.get("resume_id");
    if (queryId) return queryId;
    const last = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return /^(resume|resumes|editor|edit|new)$/i.test(last) ? null : last;
  } catch {
    return null;
  }
}

export function wiseResumeAuthoritativeInventoryExpression(
  storedFixtureRecordId: string | null,
): string {
  return `(async () => {
      const fixtureTitle = ${JSON.stringify(WISE_RESUME_FIXTURE_TITLE)};
      const storedFixtureRecordId = ${JSON.stringify(storedFixtureRecordId)};
      ${wiseResumeWebSdkQueryRuntimeSource()}
      const requestHeaders = ${JSON.stringify(wiseResumeWebSdkHeaders())};
      const failed = (requestStatus, httpStatusClass, sourceAvailable) => ({ source: "appwrite-resumes", sourceAvailable, inventoryResolved: false, countEstablished: false, totalResumeCount: null, fixtureRecordIds: [], requestStatus, httpStatusClass });
      const classify = (status) => {
        if (status === 400) return ["invalid-query", "4xx"];
        if (status === 401) return ["unauthorized", "4xx"];
        if (status === 403) return ["forbidden", "4xx"];
        if (status === 404) return ["not-found", "4xx"];
        if (status === 429) return ["rate-limited", "4xx"];
        if (status >= 500 && status < 600) return ["server-error", "5xx"];
        return ["invalid-query", status >= 400 ? "4xx" : "unknown"];
      };
      try {
        const accountResponse = await fetch(${JSON.stringify(`${WISE_RESUME_APPWRITE_ENDPOINT}/account`)}, { method: "GET", credentials: "include", headers: requestHeaders });
        if (!accountResponse.ok) { const [requestStatus, httpStatusClass] = classify(accountResponse.status); return failed(requestStatus, httpStatusClass, true); }
        let account = await accountResponse.json();
        const authenticatedUserId = typeof account?.$id === "string" ? account.$id : null;
        if (!authenticatedUserId) return failed("invalid-response", "2xx", true);
        account = null;
        const params = new URLSearchParams();
        [sdkQuery("equal", "user_id", [authenticatedUserId]), sdkQuery("orderDesc", "$updatedAt"), sdkQuery("limit", undefined, 50)].forEach((query, index) => params.append("queries[" + index + "]", query));
        const inventoryResponse = await fetch(${JSON.stringify(`${WISE_RESUME_APPWRITE_ENDPOINT}/databases/main/collections/resumes/documents`)} + "?" + params.toString(), { method: "GET", credentials: "include", headers: requestHeaders });
        if (!inventoryResponse.ok) { const [requestStatus, httpStatusClass] = classify(inventoryResponse.status); return failed(requestStatus, httpStatusClass, true); }
        let payload = await inventoryResponse.json();
        if (!payload || !Array.isArray(payload.documents)) return failed("invalid-response", "2xx", true);
        const documents = payload.documents;
        const records = documents.map((document) => ({
          id: typeof document?.$id === "string" ? document.$id : null,
          titleMarkerMatch: document?.title === fixtureTitle,
          updatedAtPresent: typeof document?.$updatedAt === "string" && document.$updatedAt.length > 0,
        }));
        payload = null;
        documents.length = 0;
        if (records.some((record) => !record.id || !record.updatedAtPresent)) return failed("invalid-response", "2xx", true);
        const fixtureRecordIds = records.filter((record) => record.id === storedFixtureRecordId || record.titleMarkerMatch).map((record) => record.id);
        return { source: "appwrite-resumes", sourceAvailable: true, inventoryResolved: true, countEstablished: true, totalResumeCount: records.length, fixtureRecordIds, requestStatus: "success", httpStatusClass: "2xx" };
      } catch { return failed("network-error", "network", false); }
    })()`;
}

export function wiseResumeFixtureInventoryExpression(): string {
  return `(() => {
      const inventoryEvidence = {
        resumeWorkspaceRow: Boolean(document.querySelector(".resume-workspace-row")),
        resumeWorkspaceCard: Boolean(document.querySelector(".resume-workspace-card")),
        createResumeControl: Boolean(document.querySelector("[aria-label='Create Resume'], [data-testid='create-resume']")),
        emptyState: Boolean(document.querySelector("[data-testid='resume-empty-state'], .resume-workspace-empty")),
      };
      const inventoryEvidenceSources = Object.entries(inventoryEvidence).filter(([, active]) => active).map(([source]) => source.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()));
      return {
        authenticatedAccountConfirmed: false,
        inventoryResolved: inventoryEvidenceSources.length > 0,
        inventoryEvidenceSources,
        countEstablished:
          inventoryEvidence.emptyState || inventoryEvidence.resumeWorkspaceRow || inventoryEvidence.resumeWorkspaceCard,
        totalResumeCount: document.querySelectorAll(".resume-workspace-row, .resume-workspace-card").length,
        fixtureRecordIds: [],
        privacyShieldActive: Boolean(document.getElementById("wisedemo-privacy-shield")),
      };
    })()`;
}

async function readWiseResumeFixtureInventory(
  context: ProductLocaleAdapterContext,
  storedFixtureRecordId: string | null,
): Promise<WiseResumeFixtureInventoryFacts> {
  const authoritative = asRecord(
    await context.evaluate(wiseResumeAuthoritativeInventoryExpression(storedFixtureRecordId)),
  );
  const requestStatus = asString(authoritative?.requestStatus);
  const authoritativeHttpStatusClass = asString(authoritative?.httpStatusClass);
  if (authoritative?.source === "appwrite-resumes" && requestStatus === "success") {
    return {
      authenticatedAccountConfirmed: false,
      inventoryResolved: true,
      inventoryEvidenceSources: ["appwrite-resumes-success"],
      totalResumeCount:
        typeof authoritative.totalResumeCount === "number" ? authoritative.totalResumeCount : null,
      fixtureRecordIds: Array.isArray(authoritative.fixtureRecordIds)
        ? authoritative.fixtureRecordIds.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      privacyShieldActive:
        (await context.evaluate('Boolean(document.getElementById("wisedemo-privacy-shield"))')) ===
        true,
      authoritativeRequestStatus: "success",
      authoritativeHttpStatusClass: "2xx",
      domFallbackResolved: null,
    };
  }
  const facts = asRecord(await context.evaluate(wiseResumeFixtureInventoryExpression()));
  const fallbackSources = Array.isArray(facts?.inventoryEvidenceSources)
    ? facts.inventoryEvidenceSources.filter((value): value is string =>
        /^[a-z-]{1,64}$/.test(value),
      )
    : [];
  const fallbackResolved = facts?.inventoryResolved === true;
  const safeRequestStatus: WiseResumeInventoryRequestStatus =
    requestStatus === "unauthorized" ||
    requestStatus === "forbidden" ||
    requestStatus === "invalid-query" ||
    requestStatus === "not-found" ||
    requestStatus === "rate-limited" ||
    requestStatus === "server-error" ||
    requestStatus === "network-error" ||
    requestStatus === "invalid-response"
      ? requestStatus
      : "invalid-response";
  const safeHttpStatusClass: WiseResumeHttpStatusClass =
    authoritativeHttpStatusClass === "2xx" ||
    authoritativeHttpStatusClass === "4xx" ||
    authoritativeHttpStatusClass === "5xx" ||
    authoritativeHttpStatusClass === "network" ||
    authoritativeHttpStatusClass === "unknown"
      ? authoritativeHttpStatusClass
      : "unknown";
  return {
    authenticatedAccountConfirmed: facts?.authenticatedAccountConfirmed === true,
    inventoryResolved: fallbackResolved,
    inventoryEvidenceSources: [
      `appwrite-resumes-${safeRequestStatus}`,
      ...(fallbackSources.length
        ? fallbackSources.map((source) => `dom-fallback-${source}`)
        : ["dom-fallback-unresolved"]),
    ],
    totalResumeCount: null,
    fixtureRecordIds: Array.isArray(facts?.fixtureRecordIds)
      ? facts.fixtureRecordIds.filter((value): value is string => typeof value === "string")
      : [],
    privacyShieldActive: facts?.privacyShieldActive === true,
    authoritativeRequestStatus: safeRequestStatus,
    authoritativeHttpStatusClass: safeHttpStatusClass,
    domFallbackResolved: fallbackResolved,
  };
}

async function readWiseResumeAuthenticatedIdentity(
  context: ProductLocaleAdapterContext,
  expectedAccountFingerprint: string,
  onIdentityAttempt?: (
    evidence: import("../wiseresume-identity.server.ts").WiseResumeIdentityEvidence,
  ) => Promise<void>,
): Promise<import("../wiseresume-identity.server.ts").WiseResumeIdentityEvidence> {
  const {
    createWiseResumeIdentityAttemptEvidence,
    resolveWiseResumeIdentity,
    wiseResumeAppwriteAccountIdentityExpression,
    wiseResumeScopedAccountControlIdentityExpression,
  } = await import("../wiseresume-identity.server.ts");
  const primary = asRecord(await context.evaluate(wiseResumeAppwriteAccountIdentityExpression()));
  await onIdentityAttempt?.(
    createWiseResumeIdentityAttemptEvidence({
      source: "appwrite-account",
      sourceAvailable: primary?.sourceAvailable === true,
      liveAccountFingerprint: asString(primary?.liveAccountFingerprint),
      expectedAccountFingerprint,
    }),
  );
  const fallback =
    primary?.sourceAvailable === true
      ? null
      : asRecord(await context.evaluate(wiseResumeScopedAccountControlIdentityExpression()));
  if (fallback) {
    await onIdentityAttempt?.(
      createWiseResumeIdentityAttemptEvidence({
        source: "scoped-account-control",
        sourceAvailable: fallback.sourceAvailable === true,
        liveAccountFingerprint: asString(fallback.liveAccountFingerprint),
        expectedAccountFingerprint,
      }),
    );
  }
  return resolveWiseResumeIdentity({
    expectedAccountFingerprint,
    primary: {
      sourceAvailable: primary?.sourceAvailable === true,
      liveAccountFingerprint: asString(primary?.liveAccountFingerprint),
    },
    fallback: fallback
      ? {
          sourceAvailable: fallback.sourceAvailable === true,
          liveAccountFingerprint: asString(fallback.liveAccountFingerprint),
        }
      : undefined,
  });
}

export async function auditWiseResumeFixtureIsolationAccount(
  context: ProductLocaleAdapterContext,
  input: {
    expectedAccountFingerprint: string;
    legacyExpectedAccountFingerprint: string;
    storedFixture: WiseResumeFixtureReference | null;
    onIdentityAttempt?: (
      evidence: import("../wiseresume-identity.server.ts").WiseResumeIdentityEvidence,
    ) => Promise<void>;
  },
): Promise<LiveAccountSafetyAudit> {
  if (!(await isWiseResume(context))) {
    return {
      status: "inconclusive",
      mode: "fixture-isolation",
      authenticatedAccountConfirmed: false,
      totalResumeCount: null,
      fixtureResumeCount: null,
      nonFixtureResumeCount: null,
      fixtureIsolated: false,
      privacyShieldActive: false,
      mutationScopeLockedToFixture: false,
      personalDataMarkersFound: false,
      reasons: ["The authenticated WiseResume page was unavailable for a safety audit."],
      auditedAt: new Date().toISOString(),
    };
  }
  const identity = await readWiseResumeAuthenticatedIdentity(
    context,
    input.expectedAccountFingerprint,
    input.onIdentityAttempt,
  );
  const shieldActive =
    (await context.evaluate('Boolean(document.getElementById("wisedemo-privacy-shield"))')) ===
    true;
  const unresolvedFacts: WiseResumeFixtureInventoryFacts = {
    authenticatedAccountConfirmed: false,
    inventoryResolved: false,
    inventoryEvidenceSources: [],
    totalResumeCount: null,
    fixtureRecordIds: [],
    privacyShieldActive: shieldActive,
    authoritativeRequestStatus: "invalid-response",
    authoritativeHttpStatusClass: "unknown",
    domFallbackResolved: null,
  };
  const unresolvedAudit = createWiseResumeFixtureIsolationAudit({
    ...unresolvedFacts,
    authenticatedAccountConfirmed: identity.authenticatedAccountConfirmed,
    storedFixture: input.storedFixture,
  });
  if (!identity.sourceAvailable && unresolvedAudit.status !== "unsafe") {
    return {
      ...unresolvedAudit,
      identityEvidence: identity,
      status: "inconclusive",
      reasons: [
        ...unresolvedAudit.reasons,
        "Authenticated account identity source was unavailable.",
      ],
    };
  }
  if (identity.sourceAvailable && !identity.authenticatedAccountConfirmed) {
    const reason =
      identity.mismatchCategory === "canonical-format-mismatch"
        ? "Authenticated account identity used a non-canonical fingerprint format."
        : "Authenticated account identity did not match the configured credential.";
    return {
      ...unresolvedAudit,
      identityEvidence: identity,
      status: "unsafe",
      fixtureIsolated: false,
      mutationScopeLockedToFixture: false,
      reasons: [reason],
    };
  }
  const facts = await readWiseResumeFixtureInventory(
    context,
    input.storedFixture?.resumeRecordId ?? null,
  );
  const audit = createWiseResumeFixtureIsolationAudit({
    ...facts,
    authenticatedAccountConfirmed: identity.authenticatedAccountConfirmed,
    storedFixture: input.storedFixture,
  });
  const inventoryRequestEvidence = {
    source: "appwrite-resumes" as const,
    sourceAvailable: facts.authoritativeRequestStatus !== "network-error",
    inventoryResolved: facts.authoritativeRequestStatus === "success" && facts.inventoryResolved,
    countEstablished:
      facts.authoritativeRequestStatus === "success" && typeof facts.totalResumeCount === "number",
    requestStatus: facts.authoritativeRequestStatus,
    httpStatusClass: facts.authoritativeHttpStatusClass,
    domFallbackResolved: facts.domFallbackResolved,
  };
  if (facts.authoritativeRequestStatus !== "success") {
    return {
      ...audit,
      identityEvidence: identity,
      inventoryEvidenceSources: facts.inventoryEvidenceSources,
      inventoryRequestEvidence,
      status: "inconclusive",
      reasons: ["Authoritative resume inventory request did not complete."],
    };
  }
  if (!facts.inventoryResolved && audit.status === "safe") {
    return {
      ...audit,
      identityEvidence: identity,
      inventoryEvidenceSources: facts.inventoryEvidenceSources,
      inventoryRequestEvidence,
      status: "inconclusive",
      reasons: ["Resume inventory could not be resolved."],
    };
  }
  const legacyFixtureMatchesExpectedIdentity =
    input.storedFixture?.accountFingerprintFormat === "legacy-v0" &&
    input.storedFixture.accountFingerprint === input.legacyExpectedAccountFingerprint &&
    identity.authenticatedAccountConfirmed;
  if (
    input.storedFixture &&
    input.storedFixture.accountFingerprint !== input.expectedAccountFingerprint &&
    !legacyFixtureMatchesExpectedIdentity
  ) {
    return {
      ...audit,
      status: "unsafe",
      inventoryRequestEvidence,
      fixtureIsolated: false,
      mutationScopeLockedToFixture: false,
      reasons: ["Persisted fixture scope does not match the authenticated account."],
    };
  }
  return {
    ...audit,
    identityEvidence: identity,
    inventoryEvidenceSources: facts.inventoryEvidenceSources,
    inventoryRequestEvidence,
  };
}

async function executeWiseResumeShieldedNavigationAction(input: {
  checkpointBefore: string;
  checkpointAfter: string;
  assertPrivacyShield: ((checkpoint: string) => Promise<void>) | undefined;
  action: () => Promise<void>;
  waitForTransition: () => Promise<void>;
}): Promise<void> {
  const assertPrivacyShield = input.assertPrivacyShield;
  if (!assertPrivacyShield) {
    await input.action();
    await input.waitForTransition();
    return;
  }
  const { executeShieldedNavigationAction } = await import("../shielded-navigation.server.ts");
  await executeShieldedNavigationAction({
    checkpointBefore: input.checkpointBefore,
    checkpointAfter: input.checkpointAfter,
    assertPrivacyShield,
    action: input.action,
    waitForTransition: input.waitForTransition,
  });
}

async function gotoWiseResumeFixtureWithShield(input: {
  context: ProductLocaleAdapterContext;
  url: string;
  waitMs: number;
  checkpointBefore: string;
  checkpointAfter: string;
  assertPrivacyShield: ((checkpoint: string) => Promise<void>) | undefined;
  settleExpression?: string;
  settleError?: string;
}): Promise<void> {
  await input.assertPrivacyShield?.(input.checkpointBefore);
  await input.context.goto(input.url, input.waitMs);
  if (input.settleExpression && !(await input.context.waitUntil(input.settleExpression, 12_000))) {
    throw new Error(input.settleError ?? "WiseResume navigation did not settle.");
  }
  await input.assertPrivacyShield?.(input.checkpointAfter);
}

async function clickWiseResumeControlWithShield(input: {
  context: ProductLocaleAdapterContext;
  selector: string;
  checkpointBefore: string;
  checkpointAfter: string;
  assertPrivacyShield: ((checkpoint: string) => Promise<void>) | undefined;
  expectedTransition: string;
  transitionError: string;
  beforeAction?: () => Promise<void> | void;
  onActionCompleted?: () => Promise<void> | void;
}): Promise<void> {
  input.context.assertActive?.();
  const beforeUrl = await input.context.evaluate("location.href");
  if (typeof beforeUrl !== "string") throw new Error(input.transitionError);
  let clicked: unknown;
  await executeWiseResumeShieldedNavigationAction({
    checkpointBefore: input.checkpointBefore,
    checkpointAfter: input.checkpointAfter,
    assertPrivacyShield: input.assertPrivacyShield,
    action: async () => {
      await input.beforeAction?.();
      input.context.assertActive?.();
      clicked = await input.context.evaluate(
        `(() => { const target = document.querySelector(${JSON.stringify(input.selector)}); if (!target) return false; target.click(); return true; })()`,
      );
      if (clicked !== true) throw new Error("WiseResume control was not actionable.");
      input.context.assertActive?.();
      await input.onActionCompleted?.();
    },
    waitForTransition: async () => {
      const transitioned = await input.context.waitUntil(
        `(() => (location.href !== ${JSON.stringify(beforeUrl)}) || (${input.expectedTransition}))()`,
        12_000,
      );
      if (!transitioned) throw new Error(input.transitionError);
      input.context.assertActive?.();
      const settled = await input.context.waitUntil(
        'document.readyState === "interactive" || document.readyState === "complete"',
        12_000,
      );
      if (!settled) throw new Error(input.transitionError);
      input.context.assertActive?.();
    },
  });
}

async function resolveWiseResumeFixtureRoute(
  context: ProductLocaleAdapterContext,
  fixture: WiseResumeFixtureReference | null,
): Promise<{
  origin: string;
  resumeUrl: string | null;
  recordId: string | null;
  fixtureSelector: string | null;
  createSelector: string | null;
  createControlEvidence: WiseResumeCreateControlEvidence;
}> {
  const route = asRecord(
    await context.evaluate(wiseResumeFixtureRouteExpression(fixture?.resumeRecordId ?? null)),
  );
  return {
    origin: asString(route?.origin) ?? "",
    resumeUrl: asString(route?.resumeUrl),
    recordId: asString(route?.recordId),
    fixtureSelector: asString(route?.fixtureSelector),
    createSelector: asString(route?.createSelector),
    createControlEvidence: readWiseResumeCreateControlEvidence(route?.createControlEvidence),
  };
}

function readWiseResumeCreateControlEvidence(value: unknown): WiseResumeCreateControlEvidence {
  const evidence = asRecord(value);
  const routeCategory = asString(evidence?.routeCategory);
  const selectorCategory = asString(evidence?.selectorCategory);
  return {
    routeCategory:
      routeCategory === "resume-dashboard" ||
      routeCategory === "login" ||
      routeCategory === "onboarding" ||
      routeCategory === "unrelated" ||
      routeCategory === "unknown"
        ? routeCategory
        : "unknown",
    workspaceConfirmed: evidence?.workspaceConfirmed === true,
    candidateCount:
      typeof evidence?.candidateCount === "number" &&
      Number.isInteger(evidence.candidateCount) &&
      evidence.candidateCount >= 0
        ? evidence.candidateCount
        : 0,
    selectorCategory:
      selectorCategory === "data-testid" ||
      selectorCategory === "aria-label" ||
      selectorCategory === "exact-role-label" ||
      selectorCategory === "none"
        ? selectorCategory
        : "none",
    controlVisible: evidence?.controlVisible === true,
    controlEnabled: evidence?.controlEnabled === true,
  };
}

function assertWiseResumeVerifiedDashboardWorkspace(input: {
  route: Awaited<ReturnType<typeof resolveWiseResumeFixtureRoute>>;
  audit: LiveAccountSafetyAudit | undefined;
}): void {
  const evidence = input.route.createControlEvidence;
  const inventory = input.audit?.inventoryRequestEvidence;
  if (
    input.route.origin !== "https://wiseresume.app" ||
    evidence.routeCategory !== "resume-dashboard" ||
    !evidence.workspaceConfirmed ||
    input.audit?.authenticatedAccountConfirmed !== true ||
    input.audit?.privacyShieldActive !== true ||
    inventory?.inventoryResolved !== true ||
    inventory.countEstablished !== true
  ) {
    const candidateCount = Math.min(5, Math.max(0, evidence.candidateCount));
    throw new Error(
      `WiseResume dashboard workspace verification failed: route=${evidence.routeCategory}; workspace=${evidence.workspaceConfirmed ? "verified" : "missing"}; candidates=${candidateCount}; control=${evidence.controlVisible && evidence.controlEnabled ? "actionable" : "not-actionable"}.`,
    );
  }
}

export async function resolveWiseResumeFixtureCreationWorkspace(
  context: ProductLocaleAdapterContext,
  input: {
    liveAccountSafetyAudit: LiveAccountSafetyAudit | undefined;
    storedFixture: WiseResumeFixtureReference | null;
    assertPrivacyShield?: (checkpoint: string) => Promise<void>;
  },
) {
  let route = await resolveWiseResumeFixtureRoute(context, input.storedFixture);
  if (input.storedFixture) return route;

  assertWiseResumeFixtureCreationAllowed(input.liveAccountSafetyAudit);
  const evidence = route.createControlEvidence;
  const needsDashboardNavigation =
    evidence.routeCategory !== "resume-dashboard" || !evidence.workspaceConfirmed;
  if (needsDashboardNavigation) {
    await gotoWiseResumeFixtureWithShield({
      context,
      url: "https://wiseresume.app/dashboard",
      waitMs: 1_200,
      checkpointBefore: "before-fixture-dashboard-navigation",
      checkpointAfter: "after-fixture-dashboard-navigation",
      assertPrivacyShield: input.assertPrivacyShield,
      settleExpression:
        'document.readyState === "interactive" || document.readyState === "complete"',
      settleError: "WiseResume dashboard did not settle after navigation.",
    });
    route = await resolveWiseResumeFixtureRoute(context, null);
  }

  assertWiseResumeVerifiedDashboardWorkspace({ route, audit: input.liveAccountSafetyAudit });
  if (
    !route.createSelector ||
    route.createControlEvidence.candidateCount !== 1 ||
    !route.createControlEvidence.controlVisible ||
    !route.createControlEvidence.controlEnabled
  ) {
    throw new Error("WiseResume fixture creation control could not be resolved.");
  }
  return route;
}

const wiseResumeCreationSurfaceExpression = `(() => {
  const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 4 && rect.height > 4 && style.visibility !== "hidden" && style.display !== "none"; };
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(visible);
  const editor = document.querySelector('textarea, [contenteditable="true"], input[name*="resume"], [data-testid*="editor"]');
  return Boolean(dialog || editor);
})()`;

function wiseResumeInstallCreationCaptureExpression(): string {
  return `(() => {
    const key = "__wisedemoFixtureCreationCapture";
    const prior = window[key];
    if (prior?.restore) prior.restore();
    const nativeFetch = window.fetch;
    const capture = { armed: false, requestSeen: false, resumeRecordId: null, restore: null };
    window.fetch = async function(...args) {
      const request = args[0];
      const options = args[1] || {};
      const requestUrl = typeof request === "string" ? request : request instanceof Request ? request.url : "";
      const method = String(options.method || (request instanceof Request ? request.method : "GET")).toUpperCase();
      const response = await nativeFetch.apply(this, args);
      if (capture.armed && method === "POST" && /\\/databases\\/main\\/collections\\/resumes\\/documents(?:\\?|$)/.test(requestUrl)) {
        capture.requestSeen = true;
        try {
          const payload = await response.clone().json();
          if (typeof payload?.$id === "string" && payload.$id) capture.resumeRecordId = payload.$id;
        } catch { /* only the correlated fixture ID is retained */ }
      }
      return response;
    };
    capture.restore = () => { if (window.fetch !== nativeFetch) window.fetch = nativeFetch; };
    window[key] = capture;
    return true;
  })()`;
}

const wiseResumeArmCreationCaptureExpression =
  "(() => { const capture = window.__wisedemoFixtureCreationCapture; if (!capture) return false; capture.armed = true; return true; })()";

const wiseResumeReadCreationCaptureExpression =
  '(() => { const capture = window.__wisedemoFixtureCreationCapture; return { requestSeen: capture?.requestSeen === true, resumeRecordId: typeof capture?.resumeRecordId === "string" ? capture.resumeRecordId : null }; })()';

const wiseResumeRestoreCreationCaptureExpression =
  "(() => { const capture = window.__wisedemoFixtureCreationCapture; try { capture?.restore?.(); } finally { delete window.__wisedemoFixtureCreationCapture; } return true; })()";

async function clickWiseResumeCreationDialogControl(input: {
  context: ProductLocaleAdapterContext;
  label: "Start from Scratch" | "Mid-Level" | "Continue" | "Create";
  checkpoint: string;
  waitFor: string;
  error: string;
  assertPrivacyShield: ((checkpoint: string) => Promise<void>) | undefined;
}): Promise<void> {
  await executeWiseResumeShieldedNavigationAction({
    checkpointBefore: `before-${input.checkpoint}`,
    checkpointAfter: `after-${input.checkpoint}`,
    assertPrivacyShield: input.assertPrivacyShield,
    action: async () => {
      input.context.assertActive?.();
      const clicked = await input.context.evaluate(`(() => { ${browserHelpers()}
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(visible);
        if (!dialog) return false;
        const label = ${JSON.stringify(input.label)};
        const control = Array.from(dialog.querySelectorAll('button, [role="button"]')).filter(visible).find((element) => {
          const value = text(element);
          return label === "Mid-Level" ? /^Mid-Level(?:\\s|$)/.test(value) : value === label;
        });
        if (!control || control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true") return false;
        control.click();
        return true;
      })()`);
      if (clicked !== true) throw new Error(input.error);
    },
    waitForTransition: async () => {
      const ready = await input.context.waitUntil(input.waitFor, 12_000);
      if (!ready) throw new Error(input.error);
    },
  });
}

async function completeWiseResumeFixtureCreationDialog(input: {
  context: ProductLocaleAdapterContext;
  fixtureTitle: string;
  assertPrivacyShield: ((checkpoint: string) => Promise<void>) | undefined;
}): Promise<void> {
  await clickWiseResumeCreationDialogControl({
    ...input,
    label: "Start from Scratch",
    checkpoint: "fixture-creation-start-from-scratch",
    waitFor:
      'Array.from(document.querySelectorAll(\'[role="dialog"] button\')).some((element) => /^Mid-Level(?:\\s|$)/.test(String(element.textContent || "").replace(/\\s+/g, " ").trim()))',
    error: "WiseResume fixture creation wizard did not expose the fictional blank-resume path.",
  });
  await clickWiseResumeCreationDialogControl({
    ...input,
    label: "Mid-Level",
    checkpoint: "fixture-creation-experience-level",
    waitFor:
      'Array.from(document.querySelectorAll(\'[role="dialog"] button\')).some((element) => String(element.textContent || "").replace(/\\s+/g, " ").trim() === "Continue" && !element.hasAttribute("disabled"))',
    error: "WiseResume fixture creation wizard did not accept the fictional experience level.",
  });
  await clickWiseResumeCreationDialogControl({
    ...input,
    label: "Continue",
    checkpoint: "fixture-creation-template-step",
    waitFor:
      "Boolean(document.querySelector('[role=\"dialog\"] input#title')) || Boolean(document.querySelector('[role=\"dialog\"] button'))",
    error: "WiseResume fixture creation wizard did not reach template selection.",
  });
  await clickWiseResumeCreationDialogControl({
    ...input,
    label: "Continue",
    checkpoint: "fixture-creation-title-step",
    waitFor: "Boolean(document.querySelector('[role=\"dialog\"] input#title'))",
    error: "WiseResume fixture creation wizard did not reach the fixture title field.",
  });
  await input.assertPrivacyShield?.("before-fixture-creation-title-write");
  input.context.assertActive?.();
  const filled = await input.context.evaluate(`(() => {
    const title = document.querySelector('[role="dialog"] input#title');
    if (!(title instanceof HTMLInputElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, ${JSON.stringify(input.fixtureTitle)});
    title.dispatchEvent(new Event("input", { bubbles: true }));
    title.dispatchEvent(new Event("change", { bubbles: true }));
    title.dispatchEvent(new Event("blur", { bubbles: true }));
    return title.value === ${JSON.stringify(input.fixtureTitle)};
  })()`);
  if (filled !== true)
    throw new Error("WiseResume fixture creation wizard rejected the fixture title.");
  await input.assertPrivacyShield?.("after-fixture-creation-title-write");
  await clickWiseResumeCreationDialogControl({
    ...input,
    label: "Create",
    checkpoint: "fixture-creation-submit",
    waitFor:
      "(() => { const capture = window.__wisedemoFixtureCreationCapture; return Boolean(capture?.resumeRecordId) || !document.querySelector('[role=\"dialog\"]'); })()",
    error: "WiseResume fixture creation did not return a correlated fixture record.",
  });
}

async function createWiseResumeFixture(
  context: ProductLocaleAdapterContext,
  selector: string,
  accountFingerprint: string,
  assertPrivacyShield: ((checkpoint: string) => Promise<void>) | undefined,
  onStage: ((stage: WiseResumeFixturePreparationStage) => Promise<void> | void) | undefined,
): Promise<{ fixture: WiseResumeFixtureReference; resumeUrl: string }> {
  context.assertActive?.();
  await onStage?.("create-fixture-before-click");
  if ((await context.evaluate(wiseResumeInstallCreationCaptureExpression())) !== true)
    throw new Error("WiseResume fixture creation correlation could not be installed.");
  try {
    await clickWiseResumeControlWithShield({
      context,
      selector,
      checkpointBefore: "before-fixture-creation-click",
      checkpointAfter: "after-fixture-creation-transition",
      assertPrivacyShield,
      beforeAction: async () => {
        if ((await context.evaluate(wiseResumeArmCreationCaptureExpression)) !== true)
          throw new Error("WiseResume fixture creation correlation could not be armed.");
      },
      onActionCompleted: async () => {
        context.assertActive?.();
        await onStage?.("create-fixture-transition");
      },
      expectedTransition: wiseResumeCreationSurfaceExpression,
      transitionError: "WiseResume fixture creation did not reach a bounded creation surface.",
    });
    context.assertActive?.();
    const creationDialogOpen =
      (await context.evaluate("Boolean(document.querySelector('[role=\"dialog\"]'))")) === true;
    if (creationDialogOpen) {
      await completeWiseResumeFixtureCreationDialog({
        context,
        fixtureTitle: WISE_RESUME_FIXTURE_TITLE,
        assertPrivacyShield,
      });
    }
    context.assertActive?.();
    await onStage?.("resolve-created-fixture");
    const correlation = asRecord(await context.evaluate(wiseResumeReadCreationCaptureExpression));
    const recordId = asString(correlation?.resumeRecordId);
    if (correlation?.requestSeen !== true || !recordId)
      throw new Error("WiseResume fixture creation did not provide a correlated record ID.");
    const resumeUrl = await context.evaluate("location.href");
    if (typeof resumeUrl !== "string")
      throw new Error("WiseResume fixture route could not be resolved.");
    return {
      fixture: createWiseResumeFixtureReference({
        accountFingerprint,
        resumeRecordId: recordId,
        createdByWiseDemo: true,
      }),
      resumeUrl,
    };
  } finally {
    await context.evaluate(wiseResumeRestoreCreationCaptureExpression).catch(() => undefined);
  }
}

async function readWiseResumeFinalVisibleSafety(
  context: ProductLocaleAdapterContext,
  fixture: WiseResumeFixtureReference,
): Promise<WiseResumeFinalVisibleSafety> {
  const result = asRecord(
    await context.evaluate(`(() => {
      const expectedId = ${JSON.stringify(fixture.resumeRecordId)};
      const fixtureTitle = ${JSON.stringify(WISE_RESUME_FIXTURE_TITLE)};
      const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 4 && rect.height > 4 && style.display !== "none" && style.visibility !== "hidden"; };
      const text = Array.from(document.querySelectorAll("body *")).filter(visible).map((element) => String(element.textContent || "")).join(" ");
      const activeRecordId = (() => { try { const url = new URL(location.href); return url.searchParams.get("resumeId") || url.searchParams.get("resume_id") || url.pathname.split("/").filter(Boolean).at(-1) || null; } catch { return null; } })();
      const recordIds = Array.from(document.querySelectorAll("[data-resume-id], [data-record-id], [data-document-id], a[href*='resume']")).filter(visible).map((element) => element.getAttribute("data-resume-id") || element.getAttribute("data-record-id") || element.getAttribute("data-document-id") || (() => { try { const url = new URL(element.getAttribute("href") || "", location.href); return url.searchParams.get("resumeId") || url.searchParams.get("resume_id") || url.pathname.split("/").filter(Boolean).at(-1); } catch { return null; } })()).filter((id) => id && !/^(resume|resumes|editor|edit|new)$/i.test(id));
      const accountEmailVisible = Array.from(document.querySelectorAll("[data-user-email], [data-testid*=account], [data-testid*=profile], [aria-label*=account], [aria-label*=profile]")).some((element) => visible(element) && /[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}/i.test(String(element.textContent || element.getAttribute("data-user-email") || element.getAttribute("aria-label") || "")));
      return {
        activeRecordId,
        fixtureMarkerVisible: text.includes(fixtureTitle),
        unrelatedResumeTitlesVisible: recordIds.some((id) => id !== expectedId),
        accountEmailVisible,
        personalDataVisible: /[0-9]{3}[. -]?[0-9]{2}[. -]?[0-9]{4}|(?:[0-9][ -]*?){13,16}/.test(text),
      };
    })()`),
  );
  return evaluateWiseResumeFixtureViewportSafety({
    activeRecordId: asString(result?.activeRecordId),
    fixture,
    fixtureMarkerVisible: result?.fixtureMarkerVisible === true,
    unrelatedResumeTitlesVisible: result?.unrelatedResumeTitlesVisible === true,
    accountEmailVisible: result?.accountEmailVisible === true,
    personalDataVisible: result?.personalDataVisible === true,
  });
}

async function deleteOneWiseResumeCapacityRecord(
  context: ProductLocaleAdapterContext,
  audit: LiveAccountSafetyAudit | undefined,
): Promise<WiseResumeCapacityDeletionEvidence> {
  const inventory = audit?.inventoryRequestEvidence;
  if (
    audit?.authenticatedAccountConfirmed !== true ||
    audit.privacyShieldActive !== true ||
    inventory?.requestStatus !== "success" ||
    inventory.inventoryResolved !== true ||
    inventory.countEstablished !== true
  ) {
    throw new Error(
      "WiseResume capacity deletion requires a confirmed shielded account inventory.",
    );
  }
  const result = asRecord(
    await context.evaluate(`(async () => {
      const endpoint = "https://fra.cloud.appwrite.io/v1";
      const project = "69fd362b001eb325a192";
      const headers = { "X-Appwrite-Project": project, "Content-Type": "application/json" };
      const query = (attribute, values) => encodeURIComponent(JSON.stringify({ method: "equal", attribute, values }));
      const list = async (userId) => {
        const response = await fetch(endpoint + "/databases/main/collections/resumes/documents?queries[]=" + query("user_id", [userId]) + "&queries[]=" + encodeURIComponent(JSON.stringify({ method: "limit", values: [50] })), { credentials: "include", headers });
        if (!response.ok) return null;
        const payload = await response.json();
        return Array.isArray(payload?.documents) ? payload.documents : null;
      };
      const accountResponse = await fetch(endpoint + "/account", { credentials: "include", headers });
      if (!accountResponse.ok) return { ok: false, reason: "account" };
      const account = await accountResponse.json();
      if (typeof account?.$id !== "string" || !account.$id) return { ok: false, reason: "account" };
      const documents = await list(account.$id);
      if (!documents) return { ok: false, reason: "inventory" };
      const ids = new Set(documents.map((document) => typeof document?.$id === "string" ? document.$id : "").filter(Boolean));
      const primaryIds = documents.filter((document) => document?.is_primary === true).map((document) => document.$id).filter((id) => typeof id === "string" && ids.has(id));
      const hasDependent = (id) => documents.some((document) => document?.parent_resume_id === id);
      const eligible = documents.map((document) => {
        const id = typeof document?.$id === "string" && ids.has(document.$id) ? document.$id : null;
        const title = typeof document?.title === "string" ? document.title : "";
        const parent = typeof document?.parent_resume_id === "string" && ids.has(document.parent_resume_id) ? document.parent_resume_id : null;
        const nonPrimary = document?.is_primary === false || (primaryIds.length === 1 && document?.$id !== primaryIds[0]);
        const nonMaster = document?.is_master === false || Boolean(parent);
        const independent = Boolean(id) && !hasDependent(id);
        const incomplete = !title.trim() || (![document?.summary, document?.experience, document?.education, document?.skills].some((value) => typeof value === "string" && value.trim().length > 24));
        return { id, title, parent, nonPrimary, nonMaster, independent, incomplete, trial: document?.is_trial === true, createdAt: String(document?.$createdAt || "") };
      }).filter((record) => record.id && record.nonPrimary && record.nonMaster && record.independent);
      const categories = [
        ["experimental", (record) => /\\b(wisedemo|demo|qa|test|sandbox|experimental)\\b/i.test(record.title)],
        ["duplicate-copy", (record) => Boolean(record.parent) || /\\b(copy|duplicate)\\b/i.test(record.title)],
        ["incomplete", (record) => record.incomplete],
        ["trial", (record) => record.trial],
        ["oldest-non-primary", () => true],
      ];
      let selected = null;
      let category = null;
      for (const [name, predicate] of categories) {
        const matches = eligible.filter(predicate);
        if (!matches.length) continue;
        if (name === "oldest-non-primary") {
          matches.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
          if (matches.length > 1 && matches[0].createdAt === matches[1].createdAt)
            return { ok: false, reason: "ambiguous" };
        }
        if (matches.length !== 1 && name !== "oldest-non-primary") return { ok: false, reason: "ambiguous" };
        selected = matches[0]; category = name; break;
      }
      if (!selected?.id || !category) return { ok: false, reason: "no-eligible-record" };
      const deletion = await fetch(endpoint + "/databases/main/collections/resumes/documents/" + encodeURIComponent(selected.id), { method: "DELETE", credentials: "include", headers });
      if (!deletion.ok) return { ok: false, reason: "delete" };
      const after = await list(account.$id);
      if (!after || after.length !== documents.length - 1) return { ok: false, reason: "post-delete-inventory" };
      return { ok: true, selectionCategory: category, nonPrimaryConfirmed: selected.nonPrimary === true, nonMasterConfirmed: selected.nonMaster === true, exactTargetCount: 1, deletionSuccess: true, inventoryCountBefore: documents.length, inventoryCountAfter: after.length };
    })()`),
  );
  if (result?.ok !== true) {
    const safeReason = [
      "account",
      "inventory",
      "ambiguous",
      "no-eligible-record",
      "delete",
      "post-delete-inventory",
    ].includes(asString(result?.reason) ?? "")
      ? asString(result?.reason)
      : "invalid-result";
    throw new Error(`WiseResume capacity deletion stopped safely: ${safeReason}.`);
  }
  if (
    !["experimental", "duplicate-copy", "incomplete", "trial", "oldest-non-primary"].includes(
      asString(result?.selectionCategory) ?? "",
    ) ||
    result.nonPrimaryConfirmed !== true ||
    result.nonMasterConfirmed !== true ||
    result.exactTargetCount !== 1 ||
    result.deletionSuccess !== true ||
    typeof result.inventoryCountBefore !== "number" ||
    typeof result.inventoryCountAfter !== "number" ||
    result.inventoryCountAfter !== result.inventoryCountBefore - 1
  ) {
    throw new Error(
      "WiseResume capacity deletion could not select and remove exactly one safe record.",
    );
  }
  return {
    selectionCategory: asString(
      result.selectionCategory,
    ) as WiseResumeCapacityDeletionEvidence["selectionCategory"],
    nonPrimaryConfirmed: true,
    nonMasterConfirmed: true,
    exactTargetCount: 1,
    deletionSuccess: true,
    inventoryCountBefore: result.inventoryCountBefore,
    inventoryCountAfter: result.inventoryCountAfter,
  };
}

export async function prepareWiseResumeFixtureSmartTailoring(
  context: ProductLocaleAdapterContext,
  input: {
    liveAccountSafetyAudit: LiveAccountSafetyAudit | undefined;
    storedFixture: WiseResumeFixtureReference | null;
    accountFingerprint: string;
    allowOneCapacityDeletion?: boolean;
    onCapacityDeletion?: (evidence: WiseResumeCapacityDeletionEvidence) => Promise<void>;
    assertPrivacyShield?: (checkpoint: string) => Promise<void>;
    onStage?: (stage: WiseResumeFixturePreparationStage) => Promise<void> | void;
  },
): Promise<WiseResumeFixtureSmartTailoringPlan> {
  if (!(await isWiseResume(context)))
    throw new Error("WiseResume adapter received a non-WiseResume page.");
  const { resume, jobPosting } = createWiseResumeFictionalState();
  let fixture = input.storedFixture;
  let capacityDeletion: WiseResumeCapacityDeletionEvidence | undefined;
  if (!fixture) {
    await input.onStage?.("reveal-creation-control");
    await input.assertPrivacyShield?.("before-fixture-creation-control-reveal");
    const revealed = await context.evaluate(
      fixtureViewportMaskAllowControlExpression(WISE_RESUME_CREATION_CONTROL_REVEAL_SELECTOR),
    );
    if (revealed !== true)
      throw new Error("WiseResume fixture creation control could not be safely revealed.");
    await input.assertPrivacyShield?.("after-fixture-creation-control-reveal");
  }
  await input.onStage?.("resolve-fixture-workspace");
  let route = await resolveWiseResumeFixtureCreationWorkspace(context, {
    liveAccountSafetyAudit: input.liveAccountSafetyAudit,
    storedFixture: fixture,
    assertPrivacyShield: input.assertPrivacyShield,
  });
  let resumeUrl = route.resumeUrl;
  if (!fixture) {
    if (input.allowOneCapacityDeletion) {
      capacityDeletion = await deleteOneWiseResumeCapacityRecord(
        context,
        input.liveAccountSafetyAudit,
      );
      await input.onCapacityDeletion?.(capacityDeletion);
      await gotoWiseResumeFixtureWithShield({
        context,
        url: "https://wiseresume.app/dashboard",
        waitMs: 1_200,
        checkpointBefore: "before-capacity-refresh-navigation",
        checkpointAfter: "after-capacity-refresh-navigation",
        assertPrivacyShield: input.assertPrivacyShield,
      });
      route = await resolveWiseResumeFixtureCreationWorkspace(context, {
        liveAccountSafetyAudit: input.liveAccountSafetyAudit,
        storedFixture: null,
        assertPrivacyShield: input.assertPrivacyShield,
      });
      resumeUrl = route.resumeUrl;
    }
    await input.onStage?.("create-or-reuse-fixture");
    if (route.recordId && route.resumeUrl) {
      fixture = createWiseResumeFixtureReference({
        accountFingerprint: input.accountFingerprint,
        resumeRecordId: route.recordId,
        createdByWiseDemo: false,
      });
    } else {
      if (!route.createSelector)
        throw new Error("WiseResume fixture creation control could not be resolved.");
      const created = await createWiseResumeFixture(
        context,
        route.createSelector,
        input.accountFingerprint,
        input.assertPrivacyShield,
        input.onStage,
      );
      fixture = created.fixture;
      resumeUrl = created.resumeUrl;
      route = { ...route, recordId: fixture.resumeRecordId };
    }
  }
  if (fixture.accountFingerprint !== input.accountFingerprint)
    throw new Error("WiseResume fixture scope does not match the authenticated account.");
  if (!resumeUrl || route.recordId !== fixture.resumeRecordId)
    throw new Error("WiseResume fixture route is unresolved or targets a different record.");
  assertWiseResumeFixtureMutationAllowed({
    audit: input.liveAccountSafetyAudit,
    fixture,
    targetResumeId: route.recordId,
    operation: "prepare fixture resume",
  });
  await input.onStage?.("open-fixture");
  if (route.fixtureSelector) {
    await clickWiseResumeControlWithShield({
      context,
      selector: route.fixtureSelector,
      checkpointBefore: "before-existing-fixture-click",
      checkpointAfter: "after-existing-fixture-transition",
      assertPrivacyShield: input.assertPrivacyShield,
      expectedTransition: `location.href === ${JSON.stringify(resumeUrl)}`,
      transitionError:
        "WiseResume fixture did not open after the selected fixture control was clicked.",
    });
  } else {
    await gotoWiseResumeFixtureWithShield({
      context,
      url: resumeUrl,
      waitMs: 1_200,
      checkpointBefore: "before-fixture-resume-navigation",
      checkpointAfter: "after-fixture-resume-navigation",
      assertPrivacyShield: input.assertPrivacyShield,
    });
  }
  const fixtureDocument = [WISE_RESUME_FIXTURE_TITLE, resumeDocument(resume)].join("\n");
  await input.onStage?.("write-fictional-resume");
  await input.assertPrivacyShield?.("before-fixture-resume-mutation");
  const prepared = asRecord(
    await context.evaluate(
      wiseResumeFixtureWriteExpression({
        fixtureRecordId: fixture.resumeRecordId,
        fixtureDocument,
      }),
    ),
  );
  if (
    prepared?.prepared !== true ||
    prepared.targetMatched !== true ||
    prepared.markerWritten !== true
  )
    throw new Error("WiseResume fixture resume could not be prepared in the scoped record.");
  if (prepared.privateDataDetected === true)
    throw new Error("WiseResume fixture viewport contains sensitive data.");
  await input.onStage?.("open-tailoring-workflow");
  const workflow = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const control = Array.from(document.querySelectorAll("a[href], button, [role=button]")).filter(visible).find((element) => /smart tailoring|tailor.*resume|tailor|optimi[sz]e.*resume|match.*job/i.test(text(element)));
      if (!control) return null;
      return { href: control instanceof HTMLAnchorElement ? control.href : null, selector: cssPath(control), origin: location.origin };
    })()`),
  );
  const workflowHref = asString(workflow?.href);
  const workflowSelector = asString(workflow?.selector);
  if (workflowSelector) {
    await clickWiseResumeControlWithShield({
      context,
      selector: workflowSelector,
      checkpointBefore: "before-smart-tailoring-click",
      checkpointAfter: "after-smart-tailoring-transition",
      assertPrivacyShield: input.assertPrivacyShield,
      expectedTransition:
        'document.querySelector("textarea, [contenteditable=true], [data-testid*=tailor], [data-testid*=job]") !== null',
      transitionError: "WiseResume Smart Tailoring workflow did not settle after opening.",
    });
  } else if (workflowHref && workflow?.origin === route.origin) {
    await gotoWiseResumeFixtureWithShield({
      context,
      url: workflowHref,
      waitMs: 1_200,
      checkpointBefore: "before-fixture-workflow-navigation",
      checkpointAfter: "after-fixture-workflow-navigation",
      assertPrivacyShield: input.assertPrivacyShield,
    });
  } else throw new Error("WiseResume Smart Tailoring workflow was unavailable for the fixture.");
  assertWiseResumeFixtureMutationAllowed({
    audit: input.liveAccountSafetyAudit,
    fixture,
    targetResumeId: fixture.resumeRecordId,
    operation: "prepare fixture job posting",
  });
  await input.onStage?.("write-fictional-job-posting");
  await input.assertPrivacyShield?.("before-fixture-job-posting-mutation");
  const jobPrepared = asRecord(
    await context.evaluate(`(() => { ${browserHelpers()}
      const posting = ${JSON.stringify(jobDocument(jobPosting))};
      const input = Array.from(document.querySelectorAll("textarea, [contenteditable=true], input")).filter(visible).find((element) => /job description|job posting|target role|role description|paste.*job/i.test(text(element) + " " + element.getAttribute("name") + " " + element.getAttribute("placeholder") + " " + element.getAttribute("aria-label")));
      if (!input) return { prepared: false };
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
      if (setter) setter.call(input, posting); else input.textContent = posting;
      input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); input.dispatchEvent(new Event("blur", { bubbles: true }));
      const tailor = Array.from(document.querySelectorAll("button, [role=button]")).filter(visible).find((element) => /smart tailoring|tailor.*resume|tailor|optimi[sz]e.*resume|match.*job|generate.*tailor/i.test(text(element)));
      const visibleText = text(document.body);
      return { prepared: Boolean(tailor), tailoringActionSelector: tailor ? cssPath(tailor) : null, tailoringUrl: location.href, contentHash: hash(visibleText), visibleWordCount: visibleText.trim().split(" ").filter(Boolean).length, candidateTermsPresent: /Senior Product Marketing Manager|Asterloop Software/i.test(visibleText), privateDataDetected: hasPrivateData(visibleText) };
    })()`),
  );
  const tailoringUrl = asString(jobPrepared?.tailoringUrl);
  const tailoringActionSelector = asString(jobPrepared?.tailoringActionSelector);
  if (
    jobPrepared?.prepared !== true ||
    !tailoringUrl ||
    !tailoringActionSelector ||
    jobPrepared.candidateTermsPresent !== true
  )
    throw new Error(
      "WiseResume fictional job posting could not be prepared for the scoped fixture.",
    );
  if (jobPrepared.privateDataDetected === true)
    throw new Error("WiseResume fixture viewport contains sensitive data.");
  await gotoWiseResumeFixtureWithShield({
    context,
    url: resumeUrl,
    waitMs: 1_000,
    checkpointBefore: "before-final-fixture-navigation",
    checkpointAfter: "after-final-fixture-navigation",
    assertPrivacyShield: input.assertPrivacyShield,
  });
  await input.onStage?.("verify-final-viewport");
  const finalVisibleSafety = await readWiseResumeFinalVisibleSafety(context, fixture);
  assertWiseResumeFinalVisibleContentSafe(finalVisibleSafety);
  return {
    resumeUrl,
    tailoringUrl,
    tailoringActionSelector,
    beforeEvidence: {
      contentHash: asString(prepared?.contentHash) ?? "",
      visibleWordCount:
        typeof prepared?.visibleWordCount === "number" ? prepared.visibleWordCount : 0,
      candidateTermsPresent: prepared?.candidateTermsPresent === true,
      privateDataDetected: prepared?.privateDataDetected === true,
    },
    finalActions: [
      { type: "goto", url: tailoringUrl },
      {
        type: "click",
        selector: tailoringActionSelector,
        expected: { selector: "textarea, [contenteditable=true], [data-testid*=resume]" },
      },
    ],
    createControlEvidence: route.createControlEvidence,
    fixture: { ...fixture, lastValidatedAt: new Date().toISOString() },
    finalVisibleSafety,
    capacityDeletion,
  };
}

async function isWiseResume(context: ProductLocaleAdapterContext): Promise<boolean> {
  const host = await context.evaluate("location.hostname");
  return typeof host === "string" && /(^|\.)wiseresume\.app$/i.test(host);
}

export async function openWiseResumeLanguageSettings(
  context: ProductLocaleAdapterContext,
): Promise<boolean> {
  if (!(await isWiseResume(context))) return false;

  const clicked = await context.evaluate(
    `(() => {
      const visible = (element) => { const rect = element.getBoundingClientRect(); return rect.width > 4 && rect.height > 4; };
      const label = (element) => String(element.innerText || element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
      const settings = Array.from(document.querySelectorAll("a[href], button, [role=button], [role=menuitem]"))
        .find((element) => visible(element) && (/settings|الإعدادات/i.test(label(element)) || /settings/i.test(element.getAttribute("href") || "")));
      if (!settings) return false;
      settings.click();
      return true;
    })()`,
  );
  if (clicked === true) await context.delay(900);
  const selectorReady = await context.waitUntil(
    `Array.from(document.querySelectorAll("select")).some((select) => Array.from(select.options).some((option) => /english|^en([-_]|$)/i.test(option.text + " " + option.value)))`,
    12_000,
  );
  if (selectorReady) return true;

  const origin = await context.evaluate("location.origin");
  if (typeof origin !== "string") return false;
  await context.goto(new URL("/settings", origin).toString(), 1_500);
  return context.waitUntil(
    `Array.from(document.querySelectorAll("select")).some((select) => Array.from(select.options).some((option) => /english|^en([-_]|$)/i.test(option.text + " " + option.value)))`,
    15_000,
  );
}

export async function applyWiseResumeProfileLocale(
  context: ProductLocaleAdapterContext,
  locale: Exclude<RecordingLocale, "auto">,
): Promise<boolean> {
  if (!(await isWiseResume(context))) return false;
  const language = locale === "english" ? "en" : "ar";
  const updated = await context.evaluate(
    `(async () => {
      const endpoint = "https://fra.cloud.appwrite.io/v1";
      const project = "69fd362b001eb325a192";
      const headers = { "X-Appwrite-Project": project, "Content-Type": "application/json" };
      const accountResponse = await fetch(endpoint + "/account", { credentials: "include", headers });
      if (!accountResponse.ok) return false;
      const account = await accountResponse.json();
      if (!account || typeof account.$id !== "string") return false;
      const query = encodeURIComponent(JSON.stringify({ method: "equal", attribute: "user_id", values: [account.$id] }));
      const listResponse = await fetch(endpoint + "/databases/main/collections/user_preferences/documents?queries[]=" + query, { credentials: "include", headers });
      if (!listResponse.ok) return false;
      const list = await listResponse.json();
      const documentId = list?.documents?.[0]?.$id;
      if (typeof documentId !== "string") return false;
      const updateResponse = await fetch(endpoint + "/databases/main/collections/user_preferences/documents/" + encodeURIComponent(documentId), {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({ data: { language: ${JSON.stringify(language)} } }),
      });
      if (!updateResponse.ok) return false;
      localStorage.setItem("wiseresume-locale", ${JSON.stringify(language)});
      location.reload();
      return true;
    })()`,
  );
  if (updated !== true) return false;
  await context.delay(1_500);
  await context.waitUntil(
    'document.readyState === "interactive" || document.readyState === "complete"',
    12_000,
  );
  return true;
}
