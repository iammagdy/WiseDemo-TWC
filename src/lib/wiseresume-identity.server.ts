import {
  classifyWiseResumeAccountFingerprintMismatch,
  wiseResumeAccountFingerprintRuntimeExpression,
} from "./wiseresume-account-fingerprint.server.ts";

export type WiseResumeIdentityEvidence = {
  source:
    | "appwrite-account"
    | "wiseresume-profile-api"
    | "appwrite-profile-document"
    | "scoped-account-control"
    | "unavailable";
  sourceAvailable: boolean;
  authenticatedAccountConfirmed: boolean;
  confidence: number;
  mismatchCategory:
    | "canonical-format-mismatch"
    | "confirmed-different-account"
    | "identity-source-unavailable"
    | null;
};

type WiseResumeIdentityAttempt = {
  source: "appwrite-account" | "scoped-account-control";
  sourceAvailable: boolean;
  liveAccountFingerprint: string | null;
};

export function createWiseResumeIdentityAttemptEvidence(input: {
  source: WiseResumeIdentityEvidence["source"];
  sourceAvailable: boolean;
  liveAccountFingerprint: string | null;
  expectedAccountFingerprint: string;
}): WiseResumeIdentityEvidence {
  const authenticatedAccountConfirmed =
    input.sourceAvailable &&
    input.liveAccountFingerprint !== null &&
    input.liveAccountFingerprint === input.expectedAccountFingerprint;
  return {
    source: input.source,
    sourceAvailable: input.sourceAvailable,
    authenticatedAccountConfirmed,
    confidence: input.sourceAvailable ? (input.source === "appwrite-account" ? 1 : 0.84) : 0,
    mismatchCategory: input.sourceAvailable
      ? classifyWiseResumeAccountFingerprintMismatch({
          expectedAccountFingerprint: input.expectedAccountFingerprint,
          liveAccountFingerprint: input.liveAccountFingerprint,
        })
      : "identity-source-unavailable",
  };
}

export function wiseResumeAppwriteAccountIdentityExpression(): string {
  return `(async () => {
    ${wiseResumeAccountFingerprintRuntimeExpression()}
    try {
      const accountResponse = await fetch("https://fra.cloud.appwrite.io/v1/account", {
        credentials: "include",
        headers: { "X-Appwrite-Project": "69fd362b001eb325a192" },
      });
      if (!accountResponse.ok)
        return { sourceAvailable: false, liveAccountFingerprint: null };
      const account = await accountResponse.json();
      const identifier = typeof account.email === "string" ? account.email : "";
      return {
        sourceAvailable: identifier.length > 0,
        liveAccountFingerprint: identifier ? fingerprint(identifier) : null,
      };
    } catch {
      return { sourceAvailable: false, liveAccountFingerprint: null };
    }
  })()`;
}

export function wiseResumeScopedAccountControlIdentityExpression(): string {
  return `(() => {
    ${wiseResumeAccountFingerprintRuntimeExpression()}
    const control = document.querySelector("[data-user-email]");
    const identifier = control?.getAttribute("data-user-email") || "";
    return {
      sourceAvailable: identifier.length > 0,
      liveAccountFingerprint: identifier ? fingerprint(identifier) : null,
    };
  })()`;
}

export function resolveWiseResumeIdentity(input: {
  expectedAccountFingerprint: string;
  primary: Omit<WiseResumeIdentityAttempt, "source">;
  fallback?: Omit<WiseResumeIdentityAttempt, "source">;
}): WiseResumeIdentityEvidence {
  const attempts: WiseResumeIdentityAttempt[] = [
    { source: "appwrite-account", ...input.primary },
    ...(input.primary.sourceAvailable || !input.fallback
      ? []
      : [{ source: "scoped-account-control" as const, ...input.fallback }]),
  ];
  const attempt = attempts.find((candidate) => candidate.sourceAvailable);
  if (!attempt) {
    return {
      source: "unavailable",
      sourceAvailable: false,
      authenticatedAccountConfirmed: false,
      confidence: 0,
      mismatchCategory: "identity-source-unavailable",
    };
  }
  return createWiseResumeIdentityAttemptEvidence({
    source: attempt.source,
    sourceAvailable: true,
    liveAccountFingerprint: attempt.liveAccountFingerprint,
    expectedAccountFingerprint: input.expectedAccountFingerprint,
  });
}

export function classifyWiseResumeIdentityEvidence(
  evidence: WiseResumeIdentityEvidence,
): "safe" | "unsafe" | "inconclusive" {
  if (!evidence.sourceAvailable) return "inconclusive";
  return evidence.authenticatedAccountConfirmed ? "safe" : "unsafe";
}
