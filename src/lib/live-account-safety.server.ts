import type { WiseResumeIdentityEvidence } from "./wiseresume-identity.server.ts";

export type AuthenticatedMapState = "authoritative" | "stale" | "pending-live-account-safety-audit";

export type LiveAccountSafetyAudit = {
  status: "safe" | "unsafe" | "inconclusive";
  mode: "empty-account" | "fixture-isolation";
  authenticatedAccountConfirmed: boolean;
  identityEvidence?: WiseResumeIdentityEvidence;
  totalResumeCount: number;
  fixtureResumeCount: number;
  nonFixtureResumeCount: number;
  fixtureIsolated: boolean;
  privacyShieldActive: boolean;
  mutationScopeLockedToFixture: boolean;
  personalDataMarkersFound: boolean;
  reasons: string[];
  auditedAt: string;
};

export class LiveAccountSafetyError extends Error {
  readonly audit: LiveAccountSafetyAudit;

  constructor(audit: LiveAccountSafetyAudit) {
    super(`Live account safety audit is ${audit.status}.`);
    this.name = "LiveAccountSafetyError";
    this.audit = audit;
  }
}

export function classifyAuthenticatedMap(input: {
  credentialSavedAt: string | null | undefined;
  authenticatedMapUpdatedAt: string | null | undefined;
}): AuthenticatedMapState {
  const credentialTime = input.credentialSavedAt ? Date.parse(input.credentialSavedAt) : NaN;
  const mapTime = input.authenticatedMapUpdatedAt
    ? Date.parse(input.authenticatedMapUpdatedAt)
    : NaN;
  if (!Number.isFinite(mapTime)) return "pending-live-account-safety-audit";
  if (Number.isFinite(credentialTime) && credentialTime > mapTime) return "stale";
  return "authoritative";
}

export function preSessionSafetyState(
  mapState: AuthenticatedMapState,
): "ready" | "pending-live-account-safety-audit" {
  return mapState === "authoritative" ? "ready" : "pending-live-account-safety-audit";
}

export function assertLiveAccountMutationAllowed(
  audit: LiveAccountSafetyAudit | undefined,
): asserts audit is LiveAccountSafetyAudit {
  if (!audit || audit.status !== "safe") {
    throw new LiveAccountSafetyError(
      audit ?? {
        status: "inconclusive",
        mode: "fixture-isolation",
        authenticatedAccountConfirmed: false,
        totalResumeCount: 0,
        fixtureResumeCount: 0,
        nonFixtureResumeCount: 0,
        fixtureIsolated: false,
        privacyShieldActive: false,
        mutationScopeLockedToFixture: false,
        personalDataMarkersFound: false,
        reasons: ["Live account safety audit did not complete."],
        auditedAt: new Date().toISOString(),
      },
    );
  }
}

export function serializeLiveAccountSafetyAudit(audit: LiveAccountSafetyAudit) {
  return {
    status: audit.status,
    mode: audit.mode,
    authenticatedAccountConfirmed: audit.authenticatedAccountConfirmed,
    identityEvidence: audit.identityEvidence
      ? {
          source: audit.identityEvidence.source,
          sourceAvailable: audit.identityEvidence.sourceAvailable,
          authenticatedAccountConfirmed: audit.identityEvidence.authenticatedAccountConfirmed,
          confidence: audit.identityEvidence.confidence,
          mismatchCategory: audit.identityEvidence.mismatchCategory,
        }
      : {
          source: "unavailable",
          sourceAvailable: false,
          authenticatedAccountConfirmed: false,
          confidence: 0,
          mismatchCategory: "identity-source-unavailable",
        },
    totalResumeCount: audit.totalResumeCount,
    fixtureResumeCount: audit.fixtureResumeCount,
    nonFixtureResumeCount: audit.nonFixtureResumeCount,
    fixtureIsolated: audit.fixtureIsolated,
    privacyShieldActive: audit.privacyShieldActive,
    mutationScopeLockedToFixture: audit.mutationScopeLockedToFixture,
    personalDataMarkersFound: audit.personalDataMarkersFound,
    reasons: audit.reasons.map(sanitizeLiveAccountSafetyReason),
    auditedAt: audit.auditedAt,
  };
}

function sanitizeLiveAccountSafetyReason(reason: string): string {
  return reason
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi, "[redacted-id]")
    .slice(0, 240);
}
