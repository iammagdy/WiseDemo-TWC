export type AuthenticatedMapState = "authoritative" | "stale" | "pending-live-account-safety-audit";

export type LiveAccountSafetyAudit = {
  status: "safe" | "unsafe" | "inconclusive";
  authenticatedAccountConfirmed: boolean;
  resumeCount: number;
  fixtureResumeCount: number;
  nonFixtureResumeCount: number;
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
        authenticatedAccountConfirmed: false,
        resumeCount: 0,
        fixtureResumeCount: 0,
        nonFixtureResumeCount: 0,
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
    authenticatedAccountConfirmed: audit.authenticatedAccountConfirmed,
    resumeCount: audit.resumeCount,
    fixtureResumeCount: audit.fixtureResumeCount,
    nonFixtureResumeCount: audit.nonFixtureResumeCount,
    personalDataMarkersFound: audit.personalDataMarkersFound,
    reasons: audit.reasons.map((reason) => reason.slice(0, 240)),
    auditedAt: audit.auditedAt,
  };
}
