import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type PasswordCredentials = {
  loginUrl: string;
  username: string;
  secret: string;
};

export class CredentialCryptoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CredentialCryptoError";
    this.code = code;
  }
}

function credentialKey(keySecret?: string): Buffer {
  const source = keySecret ?? process.env.WISEDEMO_CREDS_KEY ?? process.env.DEMOFORGE_CREDS_KEY;
  if (!source || source.length < 32) {
    throw new CredentialCryptoError(
      "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
      "Credential encryption is not configured yet.",
    );
  }
  return /^[\da-f]{64}$/i.test(source)
    ? Buffer.from(source, "hex")
    : createHash("sha256").update(source, "utf8").digest();
}

function parseCredentials(value: unknown): PasswordCredentials {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid credential payload.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.loginUrl !== "string" ||
    typeof candidate.username !== "string" ||
    typeof candidate.secret !== "string" ||
    !candidate.loginUrl ||
    !candidate.username ||
    !candidate.secret
  ) {
    throw new Error("Invalid credential payload.");
  }
  const loginUrl = new URL(candidate.loginUrl);
  if (!["http:", "https:"].includes(loginUrl.protocol)) {
    throw new Error("Invalid credential login URL.");
  }
  return {
    loginUrl: loginUrl.toString(),
    username: candidate.username,
    secret: candidate.secret,
  };
}

export function encryptProjectCredentials(
  credentials: PasswordCredentials,
  keySecret?: string,
): string {
  const normalized = parseCredentials(credentials);
  const key = credentialKey(keySecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(normalized), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptProjectCredentials(
  ciphertext: string,
  keySecret?: string,
): PasswordCredentials {
  try {
    const [ivB64, tagB64, dataB64, ...extra] = ciphertext.split(".");
    if (!ivB64 || !tagB64 || !dataB64 || extra.length) {
      throw new Error("Invalid credential envelope.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      credentialKey(keySecret),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return parseCredentials(JSON.parse(plaintext));
  } catch (error) {
    if (
      error instanceof CredentialCryptoError &&
      error.code === "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"
    ) {
      throw error;
    }
    throw new CredentialCryptoError(
      "STORED_CREDENTIAL_DECRYPT_FAILED",
      "Stored access could not be decrypted. Re-save the test credentials with the configured key.",
    );
  }
}

export function isSameOriginUrl(candidate: URL, baseUrl: string): boolean {
  try {
    return candidate.origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function maskCredentialIdentifier(value: string | null): string | null {
  if (!value) return null;
  const at = value.indexOf("@");
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    return `${local.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
  }
  if (value.length <= 2) return "**";
  return `${value.slice(0, 1)}${"*".repeat(Math.min(value.length - 2, 8))}${value.slice(-1)}`;
}
