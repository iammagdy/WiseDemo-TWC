const ACCOUNT_FINGERPRINT_SPEC = {
  prefix: "wr-account-v1",
  legacyPrefix: "wr-account",
  seed: 2166136261,
  prime: 16777619,
} as const;

export type WiseResumeAccountFingerprintFormat = "canonical-v1" | "legacy-v0";

export function normalizeWiseResumeAccountIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function fingerprintHash(normalizedIdentifier: string): string {
  let hash: number = ACCOUNT_FINGERPRINT_SPEC.seed;
  for (const character of normalizedIdentifier) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, ACCOUNT_FINGERPRINT_SPEC.prime);
  }
  return (hash >>> 0).toString(16);
}

export function wiseResumeAccountFingerprint(identifier: string): string {
  return `${ACCOUNT_FINGERPRINT_SPEC.prefix}-${fingerprintHash(
    normalizeWiseResumeAccountIdentifier(identifier),
  )}`;
}

export function wiseResumeLegacyAccountFingerprint(identifier: string): string {
  return `${ACCOUNT_FINGERPRINT_SPEC.legacyPrefix}-${fingerprintHash(
    normalizeWiseResumeAccountIdentifier(identifier),
  )}`;
}

export function wiseResumeAccountFingerprintFormat(
  fingerprint: string,
): WiseResumeAccountFingerprintFormat | null {
  if (new RegExp(`^${ACCOUNT_FINGERPRINT_SPEC.prefix}-[\\da-f]+$`).test(fingerprint))
    return "canonical-v1";
  if (new RegExp(`^${ACCOUNT_FINGERPRINT_SPEC.legacyPrefix}-[\\da-f]+$`).test(fingerprint))
    return "legacy-v0";
  return null;
}

export function wiseResumeAccountFingerprintRuntimeExpression(
  functionName = "fingerprint",
): string {
  return `const ${functionName} = (value) => {
    let hash = ${ACCOUNT_FINGERPRINT_SPEC.seed};
    for (const character of String(value || "").trim().toLowerCase()) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, ${ACCOUNT_FINGERPRINT_SPEC.prime});
    }
    return ${JSON.stringify(ACCOUNT_FINGERPRINT_SPEC.prefix)} + "-" + (hash >>> 0).toString(16);
  };`;
}

export function classifyWiseResumeAccountFingerprintMismatch(input: {
  expectedAccountFingerprint: string;
  liveAccountFingerprint: string | null;
}): "canonical-format-mismatch" | "confirmed-different-account" | null {
  if (
    !input.liveAccountFingerprint ||
    input.liveAccountFingerprint === input.expectedAccountFingerprint
  )
    return null;
  const expectedHash = input.expectedAccountFingerprint.match(
    /^(?:wr-account-v1|wr-account)-([\da-f]+)$/,
  )?.[1];
  if (expectedHash && input.liveAccountFingerprint === expectedHash) {
    return "canonical-format-mismatch";
  }
  return "confirmed-different-account";
}
