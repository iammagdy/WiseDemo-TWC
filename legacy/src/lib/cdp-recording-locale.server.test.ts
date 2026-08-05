import assert from "node:assert/strict";
import test from "node:test";

import {
  CdpRecordingLocaleError,
  configureCdpRecordingLocaleWithClient,
  recordingLocaleDiagnostic,
} from "./steel-recorder.server.ts";

type MockOptions = {
  initialLocale?: string;
  duplicateOverride?: boolean;
  duplicateLocale?: string;
  userAgentFailure?: boolean;
  overrideFailure?: boolean;
};

function mockLocaleClient(options: MockOptions = {}) {
  let effectiveLocale = options.initialLocale ?? "fr-FR";
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    if (method === "Runtime.evaluate") {
      return {
        result: {
          value: {
            language: effectiveLocale,
            languages: [effectiveLocale],
            intlLocale: effectiveLocale,
            userAgent: "Mock Chromium",
            platform: "Win32",
          },
        },
      };
    }
    if (method === "Emulation.setLocaleOverride") {
      if (options.overrideFailure) throw new Error("emulation unavailable");
      if (options.duplicateOverride) {
        effectiveLocale = options.duplicateLocale ?? "en-US";
        throw new Error("Another locale override is already in effect.");
      }
      effectiveLocale = String(params.locale).replace(/_/g, "-");
      return {};
    }
    if (method === "Network.setUserAgentOverride" && options.userAgentFailure)
      throw new Error("user agent override unsupported");
    return {};
  };
  return { call, calls, locale: () => effectiveLocale };
}

function count(calls: Array<{ method: string }>, method: string) {
  return calls.filter((entry) => entry.method === method).length;
}

test("first English and Arabic initialization applies and verifies the requested CDP locale", async () => {
  for (const [locale, expected] of [
    ["english", "en-us"],
    ["arabic", "ar-eg"],
  ] as const) {
    const mock = mockLocaleClient();
    const result = await configureCdpRecordingLocaleWithClient({
      call: mock.call,
      locale,
      mode: "initialize",
      connectionKey: `first-${locale}`,
    });
    assert.equal(result.localeOverride, "applied");
    assert.equal(result.verified, true);
    assert.equal(mock.locale().toLowerCase(), expected);
    assert.equal(count(mock.calls, "Emulation.setLocaleOverride"), 1);
    assert.ok(count(mock.calls, "Network.setExtraHTTPHeaders") >= 1);
    assert.ok(count(mock.calls, "Network.setUserAgentOverride") >= 1);
  }
});

test("later attachment verifies an effective locale without another emulation override", async () => {
  const mock = mockLocaleClient({ initialLocale: "en-US" });
  const result = await configureCdpRecordingLocaleWithClient({
    call: mock.call,
    locale: "english",
    mode: "verify",
    connectionKey: "same-target",
  });
  assert.equal(result.localeOverride, "already-effective");
  assert.equal(count(mock.calls, "Emulation.setLocaleOverride"), 0);
  assert.equal(count(mock.calls, "Network.setExtraHTTPHeaders"), 1);
  assert.equal(result.acceptLanguageApplied, true);
});

test("known duplicate locale override succeeds only after live verification", async () => {
  const matching = mockLocaleClient({ duplicateOverride: true, duplicateLocale: "en-US" });
  const result = await configureCdpRecordingLocaleWithClient({
    call: matching.call,
    locale: "english",
    mode: "initialize",
    connectionKey: "duplicate-matching",
  });
  assert.equal(result.localeOverride, "already-active-verified");
  assert.equal(result.verified, true);

  const conflict = mockLocaleClient({ duplicateOverride: true, duplicateLocale: "ar-EG" });
  await assert.rejects(
    configureCdpRecordingLocaleWithClient({
      call: conflict.call,
      locale: "english",
      mode: "initialize",
      connectionKey: "duplicate-conflict",
    }),
    (error) =>
      error instanceof CdpRecordingLocaleError && error.conflict && error.result.verified === false,
  );
});

test("auto preserves the detected locale and never enables emulation", async () => {
  const mock = mockLocaleClient({ initialLocale: "fr-FR" });
  const result = await configureCdpRecordingLocaleWithClient({
    call: mock.call,
    locale: "auto",
    mode: "initialize",
    connectionKey: "auto-target",
  });
  assert.equal(result.localeOverride, "not-required");
  assert.equal(result.verified, true);
  assert.equal(count(mock.calls, "Emulation.setLocaleOverride"), 0);
  assert.equal(count(mock.calls, "Network.setExtraHTTPHeaders"), 0);
});

test("user-agent failures do not erase independently verified locale or attachment headers", async () => {
  const mock = mockLocaleClient({ initialLocale: "en-US", userAgentFailure: true });
  const result = await configureCdpRecordingLocaleWithClient({
    call: mock.call,
    locale: "english",
    mode: "verify",
    connectionKey: "ua-failure",
  });
  assert.equal(result.verified, true);
  assert.equal(result.acceptLanguageApplied, true);
  assert.equal(result.userAgentLanguageApplied, false);
  assert.equal(count(mock.calls, "Network.setExtraHTTPHeaders"), 1);
});

test("verification failure aborts without creating an emulation override", async () => {
  const mock = mockLocaleClient({ initialLocale: "ar-EG" });
  await assert.rejects(
    configureCdpRecordingLocaleWithClient({
      call: mock.call,
      locale: "english",
      mode: "verify",
      connectionKey: "verify-conflict",
    }),
    CdpRecordingLocaleError,
  );
  assert.equal(count(mock.calls, "Emulation.setLocaleOverride"), 0);
});

test("concurrent initialization shares one override attempt and a failed session does not poison another", async () => {
  const concurrent = mockLocaleClient();
  const [first, second] = await Promise.all([
    configureCdpRecordingLocaleWithClient({
      call: concurrent.call,
      locale: "english",
      mode: "initialize",
      connectionKey: "concurrent-target",
    }),
    configureCdpRecordingLocaleWithClient({
      call: concurrent.call,
      locale: "english",
      mode: "initialize",
      connectionKey: "concurrent-target",
    }),
  ]);
  assert.equal(first.verified, true);
  assert.equal(second.verified, true);
  assert.equal(count(concurrent.calls, "Emulation.setLocaleOverride"), 1);

  const failed = mockLocaleClient({ overrideFailure: true });
  await assert.rejects(
    configureCdpRecordingLocaleWithClient({
      call: failed.call,
      locale: "english",
      mode: "initialize",
      connectionKey: "failed-target",
    }),
  );
  const later = mockLocaleClient();
  const laterResult = await configureCdpRecordingLocaleWithClient({
    call: later.call,
    locale: "english",
    mode: "initialize",
    connectionKey: "later-target",
  });
  assert.equal(laterResult.verified, true);
  assert.equal(count(later.calls, "Emulation.setLocaleOverride"), 1);
});

test("sanitized locale diagnostics exclude connection and browser identifiers", () => {
  const diagnostic = recordingLocaleDiagnostic(
    {
      requestedLocale: "english",
      effectiveLocale: "en-US",
      localeOverride: "already-active-verified",
      acceptLanguageApplied: true,
      userAgentLanguageApplied: false,
      verified: true,
    },
    "verify",
  );
  assert.deepEqual(diagnostic, {
    requestedCategory: "english",
    initializationMode: "verify",
    result: "already-active-verified",
    effectiveLocaleCategory: "english",
    verified: true,
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /ws:|session|target|user-agent/i);
});
