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
};

type WiseResumeIdentityAttempt = {
  source: "appwrite-account" | "scoped-account-control";
  sourceAvailable: boolean;
  liveAccountFingerprint: string | null;
};

function fingerprintExpression(): string {
  return `const fingerprint = (value) => {
    let hash = 2166136261;
    for (const character of value.trim().toLowerCase()) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };`;
}

export function wiseResumeAppwriteAccountIdentityExpression(): string {
  return `(async () => {
    ${fingerprintExpression()}
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
    ${fingerprintExpression()}
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
    };
  }
  const authenticatedAccountConfirmed =
    attempt.liveAccountFingerprint !== null &&
    attempt.liveAccountFingerprint === input.expectedAccountFingerprint;
  return {
    source: attempt.source,
    sourceAvailable: true,
    authenticatedAccountConfirmed,
    confidence: attempt.source === "appwrite-account" ? 1 : 0.84,
  };
}

export function classifyWiseResumeIdentityEvidence(
  evidence: WiseResumeIdentityEvidence,
): "safe" | "unsafe" | "inconclusive" {
  if (!evidence.sourceAvailable) return "inconclusive";
  return evidence.authenticatedAccountConfirmed ? "safe" : "unsafe";
}
