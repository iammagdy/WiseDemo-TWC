import assert from "node:assert/strict";
import test from "node:test";

import {
  CredentialCryptoError,
  decryptProjectCredentials,
  encryptProjectCredentials,
  isSameOriginUrl,
  maskCredentialIdentifier,
} from "./credential-crypto.server.ts";

const key = "a-safe-test-key-that-is-at-least-thirty-two-characters";
const credentials = {
  loginUrl: "https://product.example.test/auth?mode=login",
  username: "tester@example.test",
  secret: "not-a-real-password",
};

test("encrypts credentials with authenticated random envelopes and decrypts them", () => {
  const first = encryptProjectCredentials(credentials, key);
  const second = encryptProjectCredentials(credentials, key);

  assert.notEqual(first, second);
  assert.equal(first.includes(credentials.username), false);
  assert.equal(first.includes(credentials.secret), false);
  assert.deepEqual(decryptProjectCredentials(first, key), credentials);
});

test("fails closed with sanitized errors for missing, wrong, or damaged keys", () => {
  assert.throws(
    () => encryptProjectCredentials(credentials, "too-short"),
    (error) =>
      error instanceof CredentialCryptoError &&
      error.code === "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
  );

  const ciphertext = encryptProjectCredentials(credentials, key);
  for (const candidate of [
    () => decryptProjectCredentials(ciphertext, `${key}-wrong`),
    () => decryptProjectCredentials(`${ciphertext}damaged`, key),
  ]) {
    assert.throws(candidate, (error) => {
      assert.ok(error instanceof CredentialCryptoError);
      assert.equal(error.code, "STORED_CREDENTIAL_DECRYPT_FAILED");
      assert.equal(error.message.includes(credentials.secret), false);
      assert.equal(error.message.includes(ciphertext), false);
      return true;
    });
  }
});

test("allows credential submission only to the project's exact origin", () => {
  assert.equal(
    isSameOriginUrl(new URL("https://product.example.test/auth"), "https://product.example.test"),
    true,
  );
  assert.equal(
    isSameOriginUrl(
      new URL("https://product.example.test.attacker.invalid/auth"),
      "https://product.example.test",
    ),
    false,
  );
  assert.equal(
    isSameOriginUrl(new URL("https://auth.example.test"), "https://product.example.test"),
    false,
  );
});

test("masks credential identifiers before returning them to the browser", () => {
  assert.equal(maskCredentialIdentifier("tester@example.test"), "t*****@example.test");
  assert.equal(maskCredentialIdentifier("account-name"), "a********e");
  assert.equal(maskCredentialIdentifier(null), null);
});
