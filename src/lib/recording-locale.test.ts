import assert from "node:assert/strict";
import test from "node:test";

import { localeProfile, verifyApplicationLocale } from "./recording-locale.ts";

const baseState = {
  pathname: "/dashboard",
  documentLanguage: "en",
  navigatorLanguage: "en-US",
  navigatorLanguages: ["en-US", "en"],
  navigationLabels: ["Dashboard", "Resume editor", "Settings"],
  localeCookies: [],
  localeStorage: [],
  urlLocale: null,
  languageControls: [],
};

test("English is the explicit CDP locale profile", () => {
  assert.deepEqual(localeProfile("english"), {
    locale: "en_US",
    acceptLanguage: "en-US,en;q=0.9",
    languageCode: "en",
  });
});

test("English verification rejects Arabic navigation even with an English browser locale", () => {
  const result = verifyApplicationLocale(
    { ...baseState, navigationLabels: ["لوحة التحكم", "الإعدادات"] },
    "english",
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /Arabic navigation/i);
});

test("English verification requires authenticated navigation evidence", () => {
  assert.equal(verifyApplicationLocale(baseState, "english").verified, true);
  assert.equal(
    verifyApplicationLocale({ ...baseState, navigationLabels: [] }, "english").verified,
    false,
  );
});
