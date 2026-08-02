import type { ReconActionProbe, ReconObservation, ReconResult } from "./steel-recon.server";
import {
  detectSensitiveContent,
  rankFeatureCandidates,
  scoreFeatureCandidate,
  summarizeDomState,
  type FeatureCandidate,
  type FeatureEvidence,
  type ProductIntelligence,
} from "./product-intelligence";

function pageEvidence(observation: ReconObservation): FeatureEvidence[] {
  const evidence: FeatureEvidence[] = [
    { type: "url", value: observation.outline.url, timestamp: observation.timestamp },
    {
      type: "dom",
      value: observation.stateId,
      timestamp: observation.timestamp,
      sensitive: observation.sensitive,
    },
  ];
  if (observation.screenshotBase64) {
    evidence.push({
      type: "screenshot",
      value: observation.screenshotId,
      timestamp: observation.timestamp,
    });
  }
  return evidence;
}

function actionCandidate(action: ReconActionProbe, productName: string): FeatureCandidate | null {
  if (action.status !== "successful" || !action.meaningful) return null;
  const label = action.action.label || "Complete a product workflow";
  const score = scoreFeatureCandidate({
    action: action.action,
    requiredPreparationCount: action.requiredPreparation.length,
    hasProof:
      action.after.outline.headings.length > 0 || action.after.outline.visibleText.length > 80,
    sensitive: action.before.sensitive || action.after.sensitive,
  });
  if (score < 0.36) return null;
  const benefit = /tailor|match/i.test(label)
    ? "Turn a generic resume into a job-relevant application without rewriting it manually."
    : `Move from an unfinished task to a visible ${productName} result with confidence.`;
  const evidence: FeatureEvidence[] = [
    ...pageEvidence(action.before),
    ...pageEvidence(action.after),
    { type: "successful-action", value: action.action.id, timestamp: action.timestamp },
    {
      type: "state-diff",
      value: `visual=${action.action.visualChangeScore}; semantic=${action.action.semanticChangeScore}`,
      timestamp: action.timestamp,
    },
  ];
  return {
    id: `feature-${action.action.id}`,
    name: label,
    description: `${label} is a verified workflow with an observable before-and-after state.`,
    userProblem: "The user needs a faster, clearer path from work in progress to a useful outcome.",
    userBenefit: benefit,
    requiredState: action.action.requiredState,
    entryUrl: action.before.outline.url,
    actions: [action.action],
    expectedResult:
      action.after.outline.headings[0] || action.after.outline.title || "A visible product result",
    visualChangeScore: action.action.visualChangeScore,
    marketingValueScore: score,
    reliabilityScore: action.action.reliabilityScore,
    confidenceScore: score,
    estimatedDurationSeconds: Math.max(
      8,
      Math.min(22, 8 + Math.round(action.action.semanticChangeScore * 10)),
    ),
    requiredPreparation: action.requiredPreparation,
    evidence,
  };
}

function fallbackCandidate(recon: ReconResult, productName: string): FeatureCandidate | null {
  const page = recon.observations.find((entry) => !entry.sensitive) ?? recon.observations[0];
  const click = page?.outline.clickables.find(
    (entry) => !/logout|delete|billing|settings/i.test(entry.text),
  );
  if (!page || !click) return null;
  const action = {
    id: `fallback-${page.stateId}`,
    type: "click" as const,
    label: click.text,
    selector: click.selector,
    requiredState: page.outline.title || "Authenticated product page",
    status: "unverified" as const,
    visualChangeScore: 0.22,
    semanticChangeScore: 0.2,
    reliabilityScore: 0.35,
    zoomTarget: click.bounds
      ? {
          x: click.bounds.x,
          y: click.bounds.y,
          width: click.bounds.width,
          height: click.bounds.height,
        }
      : undefined,
    evidence: pageEvidence(page),
  };
  return {
    id: `feature-${action.id}`,
    name: click.text,
    description: `A candidate ${productName} workflow awaiting an action-level verification pass.`,
    userProblem: "The product value is not yet demonstrated in a focused story.",
    userBenefit: "Show the product's clearest visible outcome without unrelated navigation.",
    requiredState: action.requiredState,
    entryUrl: page.outline.url,
    actions: [action],
    expectedResult: page.outline.headings[0] || "A clear product outcome",
    visualChangeScore: action.visualChangeScore,
    marketingValueScore: 0.36,
    reliabilityScore: action.reliabilityScore,
    confidenceScore: 0.31,
    estimatedDurationSeconds: 12,
    requiredPreparation: recon.loggedIn ? [] : ["Sign in with a safe demo account before capture."],
    evidence: pageEvidence(page),
  };
}

export function buildProductIntelligence(input: {
  productName: string;
  baseUrl: string;
  recon: ReconResult;
}): ProductIntelligence {
  const observations = input.recon.observations.length
    ? input.recon.observations
    : input.recon.pages.map((outline, index) => ({
        stateId: `legacy-${index}`,
        screenshotId: `legacy-${index}`,
        screenshotBase64: null,
        screenshotFingerprint: null,
        timestamp: Date.now(),
        sensitive: detectSensitiveContent(outline.visibleText ?? ""),
        outline,
      }));
  const pages = observations.map((observation) => ({
    id: `page-${observation.stateId}`,
    url: observation.outline.url,
    title: observation.outline.title,
    headings: observation.outline.headings,
    navigationLabels: observation.outline.navLinks.map((link) => link.text),
    buttonLabels: observation.outline.clickables.map((entry) => entry.text),
    inputs: observation.outline.inputs.map((entry) => entry.label),
    visibleSummary: summarizeDomState({
      url: observation.outline.url,
      title: observation.outline.title,
      headings: observation.outline.headings,
      buttonLabels: observation.outline.clickables.map((entry) => entry.text),
      visibleText: observation.outline.visibleText ?? "",
    }),
    stateId: observation.stateId,
    sensitiveContentDetected: observation.sensitive,
    evidence: pageEvidence(observation),
  }));
  const candidates = rankFeatureCandidates(
    input.recon.actionProbes
      .map((probe) => actionCandidate(probe, input.productName))
      .filter((entry): entry is FeatureCandidate => Boolean(entry)),
  );
  if (!candidates.length) {
    const fallback = fallbackCandidate(input.recon, input.productName);
    if (fallback) candidates.push(fallback);
  }
  const workflows = candidates.map((candidate) => ({
    id: `workflow-${candidate.id}`,
    name: candidate.name,
    description: candidate.description,
    entryUrl: candidate.entryUrl,
    actionIds: candidate.actions.map((action) => action.id),
    expectedResult: candidate.expectedResult,
    confidence: candidate.confidenceScore,
    evidence: candidate.evidence,
  }));
  const firstUsefulPage = pages.find((page) => !page.sensitiveContentDetected) ?? pages[0];
  const productCategory = /resume|cv|career/i.test(
    `${input.productName} ${firstUsefulPage?.visibleSummary ?? ""}`,
  )
    ? "Career and resume software"
    : "SaaS application";
  const confidence = candidates.length
    ? candidates.reduce((total, candidate) => total + candidate.confidenceScore, 0) /
      candidates.length
    : 0.18;
  return {
    version: 2,
    productName: input.productName,
    productCategory,
    probableAudience:
      productCategory === "Career and resume software"
        ? ["Job seekers", "Career coaches"]
        : ["SaaS product users"],
    valuePropositions: candidates.slice(0, 3).map((candidate) => ({
      statement: candidate.userBenefit,
      evidence: candidate.evidence.slice(0, 4),
    })),
    pages,
    workflows,
    featureCandidates: candidates.slice(0, 3),
    globalConfidence: Number(confidence.toFixed(3)),
    generatedAt: new Date().toISOString(),
  };
}

export function replaceScreenshotEvidence(
  intelligence: ProductIntelligence,
  screenshots: Map<string, string>,
): ProductIntelligence {
  const replace = (evidence: FeatureEvidence[]) =>
    evidence.map((entry) =>
      entry.type === "screenshot" && screenshots.has(entry.value)
        ? { ...entry, value: screenshots.get(entry.value) as string }
        : entry,
    );
  return {
    ...intelligence,
    pages: intelligence.pages.map((page) => ({ ...page, evidence: replace(page.evidence) })),
    workflows: intelligence.workflows.map((workflow) => ({
      ...workflow,
      evidence: replace(workflow.evidence),
    })),
    featureCandidates: intelligence.featureCandidates.map((candidate) => ({
      ...candidate,
      evidence: replace(candidate.evidence),
      actions: candidate.actions.map((action) => ({
        ...action,
        evidence: replace(action.evidence),
      })),
    })),
  };
}
