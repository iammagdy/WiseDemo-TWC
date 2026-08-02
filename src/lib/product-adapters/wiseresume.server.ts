import type { RecordingLocale } from "../recording-locale";
import type { CdpAction } from "../steel-recorder.server";
import {
  assertLiveAccountMutationAllowed,
  type LiveAccountSafetyAudit,
} from "../live-account-safety.server.ts";

export type ProductLocaleAdapterContext = {
  evaluate: (expression: string) => Promise<unknown>;
  delay: (milliseconds: number) => Promise<unknown>;
  waitUntil: (expression: string, timeoutMs: number) => Promise<boolean>;
  goto: (url: string, settleMs: number) => Promise<void>;
};

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
};

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
      authenticatedAccountConfirmed: false,
      resumeCount: 0,
      fixtureResumeCount: 0,
      nonFixtureResumeCount: 0,
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
        resumeCount: records.length,
        fixtureResumeCount: fixtureRecords.length,
        nonFixtureResumeCount: nonFixtureRecords.length,
        personalDataMarkersFound: hasPrivateData(body),
      };
    })()`),
  );
  const authenticatedAccountConfirmed = audit?.authenticatedAccountConfirmed === true;
  const resumeCount = typeof audit?.resumeCount === "number" ? audit.resumeCount : 0;
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
    resumeCount,
    fixtureResumeCount,
    nonFixtureResumeCount,
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
