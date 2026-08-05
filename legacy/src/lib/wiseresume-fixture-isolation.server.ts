import {
  assertLiveAccountMutationAllowed,
  type LiveAccountSafetyAudit,
} from "./live-account-safety.server.ts";
import {
  wiseResumeAccountFingerprint,
  wiseResumeAccountFingerprintFormat,
  type WiseResumeAccountFingerprintFormat,
} from "./wiseresume-account-fingerprint.server.ts";

export { wiseResumeAccountFingerprint } from "./wiseresume-account-fingerprint.server.ts";

export type WiseResumeFixtureReference = {
  version: 1;
  accountFingerprint: string;
  accountFingerprintFormat: WiseResumeAccountFingerprintFormat;
  resumeRecordId: string;
  fixtureKind: "smart-tailoring";
  fixtureSignature: string;
  createdByWiseDemo: boolean;
  lastValidatedAt: string;
};

export type WiseResumeFinalVisibleSafety = {
  fixtureActive: boolean;
  activeRecordMatchesFixture: boolean;
  fixtureMarkerVisible: boolean;
  unrelatedResumeTitlesVisible: boolean;
  accountEmailVisible: boolean;
  personalDataVisible: boolean;
};

export type WiseResumeFixtureInventory = {
  authenticatedAccountConfirmed: boolean;
  totalResumeCount: number | null;
  fixtureRecordIds: readonly string[];
  storedFixture?: WiseResumeFixtureReference | null;
  privacyShieldActive: boolean;
};

export const WISE_RESUME_FIXTURE_TITLE = "[WiseDemo Fixture] Smart Tailoring Demo";
export const WISE_RESUME_FIXTURE_SIGNATURE = "wisedemo-smart-tailoring-v1";

function fingerprint(value: string, prefix: string): string {
  let hash = 2166136261;
  for (const character of value.trim().toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`;
}

export function wiseResumeFixtureSignature(resumeRecordId: string): string {
  return `${WISE_RESUME_FIXTURE_SIGNATURE}-${fingerprint(resumeRecordId, "record")}`;
}

export function createWiseResumeFixtureReference(input: {
  accountFingerprint: string;
  resumeRecordId: string;
  createdByWiseDemo: boolean;
  lastValidatedAt?: string;
}): WiseResumeFixtureReference {
  if (
    wiseResumeAccountFingerprintFormat(input.accountFingerprint) !== "canonical-v1" ||
    !input.resumeRecordId
  )
    throw new Error("WiseResume fixture identity requires an account fingerprint and record ID.");
  return {
    version: 1,
    accountFingerprint: input.accountFingerprint,
    accountFingerprintFormat: "canonical-v1",
    resumeRecordId: input.resumeRecordId,
    fixtureKind: "smart-tailoring",
    fixtureSignature: wiseResumeFixtureSignature(input.resumeRecordId),
    createdByWiseDemo: input.createdByWiseDemo,
    lastValidatedAt: input.lastValidatedAt ?? new Date().toISOString(),
  };
}

export function parseWiseResumeFixtureReference(value: unknown): WiseResumeFixtureReference | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.fixtureKind !== "smart-tailoring" ||
    typeof record.accountFingerprint !== "string" ||
    typeof record.resumeRecordId !== "string" ||
    typeof record.fixtureSignature !== "string" ||
    typeof record.createdByWiseDemo !== "boolean" ||
    typeof record.lastValidatedAt !== "string"
  ) {
    return null;
  }
  const fingerprintFormat = wiseResumeAccountFingerprintFormat(record.accountFingerprint);
  if (!fingerprintFormat) return null;
  const reference = record as Omit<WiseResumeFixtureReference, "accountFingerprintFormat">;
  return reference.fixtureSignature === wiseResumeFixtureSignature(reference.resumeRecordId)
    ? { ...reference, accountFingerprintFormat: fingerprintFormat }
    : null;
}

export function serializeWiseResumeFixtureReference(reference: WiseResumeFixtureReference) {
  return {
    version: reference.version,
    accountFingerprint: reference.accountFingerprint,
    resumeRecordId: reference.resumeRecordId,
    fixtureKind: reference.fixtureKind,
    fixtureSignature: reference.fixtureSignature,
    createdByWiseDemo: reference.createdByWiseDemo,
    lastValidatedAt: reference.lastValidatedAt,
  };
}

export function migrateLegacyWiseResumeFixtureReference(input: {
  reference: WiseResumeFixtureReference;
  authenticatedAccountConfirmed: boolean;
  expectedAccountFingerprint: string;
  legacyExpectedAccountFingerprint: string;
}): WiseResumeFixtureReference | null {
  if (input.reference.accountFingerprintFormat !== "legacy-v0") return input.reference;
  if (
    !input.authenticatedAccountConfirmed ||
    input.reference.accountFingerprint !== input.legacyExpectedAccountFingerprint
  ) {
    return null;
  }
  return {
    ...input.reference,
    accountFingerprint: input.expectedAccountFingerprint,
    accountFingerprintFormat: "canonical-v1",
  };
}

export function createWiseResumeFixtureIsolationAudit(
  input: WiseResumeFixtureInventory,
): LiveAccountSafetyAudit {
  const fixtureRecordIds = [...new Set(input.fixtureRecordIds.filter(Boolean))];
  const totalResumeCount =
    typeof input.totalResumeCount === "number"
      ? Math.max(0, Math.trunc(input.totalResumeCount))
      : null;
  const fixtureResumeCount = fixtureRecordIds.length;
  const nonFixtureResumeCount =
    totalResumeCount === null ? null : Math.max(0, totalResumeCount - fixtureResumeCount);
  const storedFixture = input.storedFixture ?? null;
  const fixtureAmbiguous = fixtureResumeCount > 1;
  const storedFixtureMissing =
    storedFixture !== null && !fixtureRecordIds.includes(storedFixture.resumeRecordId);
  const reasons: string[] = [];
  if (!input.authenticatedAccountConfirmed)
    reasons.push("Authenticated account identity could not be confirmed.");
  if (!input.privacyShieldActive)
    reasons.push("The privacy shield was not active before account inspection.");
  if (fixtureAmbiguous) reasons.push("The WiseDemo fixture could not be uniquely identified.");
  if (storedFixtureMissing) reasons.push("The persisted WiseDemo fixture could not be resolved.");
  if (nonFixtureResumeCount !== null && nonFixtureResumeCount > 0)
    reasons.push("Existing resumes coexist outside the isolated WiseDemo fixture.");
  return {
    status:
      !input.privacyShieldActive || fixtureAmbiguous
        ? "unsafe"
        : !input.authenticatedAccountConfirmed || storedFixtureMissing
          ? "inconclusive"
          : "safe",
    mode:
      nonFixtureResumeCount !== null && nonFixtureResumeCount > 0
        ? "fixture-isolation"
        : "empty-account",
    authenticatedAccountConfirmed: input.authenticatedAccountConfirmed,
    totalResumeCount,
    fixtureResumeCount,
    nonFixtureResumeCount,
    fixtureIsolated: !fixtureAmbiguous && !storedFixtureMissing,
    privacyShieldActive: input.privacyShieldActive,
    mutationScopeLockedToFixture:
      storedFixture !== null &&
      fixtureRecordIds.length === 1 &&
      fixtureRecordIds[0] === storedFixture.resumeRecordId,
    personalDataMarkersFound: false,
    reasons,
    auditedAt: new Date().toISOString(),
  };
}

export function assertWiseResumeFixtureCreationAllowed(
  audit: LiveAccountSafetyAudit | undefined,
): void {
  assertLiveAccountMutationAllowed(audit);
  if (!audit?.fixtureIsolated || !audit.privacyShieldActive)
    throw new Error("WiseResume fixture isolation has not been verified.");
}

export function assertWiseResumeFixtureMutationAllowed(input: {
  audit: LiveAccountSafetyAudit | undefined;
  fixture: WiseResumeFixtureReference;
  targetResumeId: string | null | undefined;
  operation: string;
}): void {
  assertLiveAccountMutationAllowed(input.audit);
  if (!input.audit?.fixtureIsolated || !input.audit.privacyShieldActive)
    throw new Error("WiseResume fixture isolation has not been verified.");
  if (
    /\b(first|latest)\s+resume\b|broad\s+resume\s+selection|\b(delete|remove)\b/i.test(
      input.operation,
    )
  )
    throw new Error("Broad WiseResume resume selection is rejected.");
  if (!input.targetResumeId)
    throw new Error("WiseResume mutation requires a fixture resume record ID.");
  if (input.targetResumeId !== input.fixture.resumeRecordId)
    throw new Error("WiseResume mutation targets a non-fixture resume.");
}

export function assertWiseResumeFinalVisibleContentSafe(
  safety: WiseResumeFinalVisibleSafety,
): void {
  if (
    !safety.fixtureActive ||
    !safety.activeRecordMatchesFixture ||
    !safety.fixtureMarkerVisible ||
    safety.unrelatedResumeTitlesVisible ||
    safety.accountEmailVisible ||
    safety.personalDataVisible
  ) {
    throw new Error("WiseResume final visible capture region is not fixture-safe.");
  }
}
