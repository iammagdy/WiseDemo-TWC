import { z } from "zod";

export const recordingLocaleSchema = z.enum(["english", "arabic", "auto"]);

export type RecordingLocale = z.infer<typeof recordingLocaleSchema>;

export type RecordingLocaleDiagnostic = {
  requestedCategory: RecordingLocale;
  initializationMode: "initialize" | "verify";
  result:
    | "applied"
    | "already-effective"
    | "already-active-verified"
    | "not-required"
    | "conflict"
    | "failed";
  effectiveLocaleCategory: "english" | "arabic" | "other" | "unknown";
  verified: boolean;
};

export const DEFAULT_RECORDING_LOCALE: RecordingLocale = "english";

export type LocaleProfile = {
  locale: string;
  acceptLanguage: string;
  languageCode: "en" | "ar";
};

export function localeProfile(locale: RecordingLocale): LocaleProfile | null {
  if (locale === "auto") return null;
  return locale === "arabic"
    ? { locale: "ar_EG", acceptLanguage: "ar-EG,ar;q=0.9,en;q=0.5", languageCode: "ar" }
    : { locale: "en_US", acceptLanguage: "en-US,en;q=0.9", languageCode: "en" };
}

export function recordingLocaleCategory(
  value: string | null | undefined,
): RecordingLocaleDiagnostic["effectiveLocaleCategory"] {
  if (!value) return "unknown";
  if (/^en(?:[-_]|$)/i.test(value)) return "english";
  if (/^ar(?:[-_]|$)/i.test(value)) return "arabic";
  return "other";
}

export type ApplicationLocaleState = {
  pathname: string;
  documentLanguage: string;
  navigatorLanguage: string;
  navigatorLanguages: string[];
  navigationLabels: string[];
  localeCookies: Array<{ key: string; value: string }>;
  localeStorage: Array<{ key: string; value: string }>;
  urlLocale: string | null;
  languageControls: Array<{ kind: string; label: string; values: string[] }>;
};

const ARABIC_TEXT = /[\u0600-\u06ff]/;
const ENGLISH_NAVIGATION =
  /\b(dashboard|resume|resumes|editor|templates|settings|profile|jobs|applications|workspace|tools|account|home)\b/i;

export function verifyApplicationLocale(
  state: ApplicationLocaleState,
  locale: RecordingLocale,
): { verified: boolean; reason: string } {
  if (locale === "auto") return { verified: true, reason: "automatic locale accepted" };

  const labels = state.navigationLabels.filter(Boolean);
  const combinedLabels = labels.join(" ");
  if (locale === "arabic") {
    const verified =
      /^ar(?:[-_]|$)/i.test(state.documentLanguage) ||
      /^ar(?:[-_]|$)/i.test(state.navigatorLanguage) ||
      ARABIC_TEXT.test(combinedLabels);
    return {
      verified,
      reason: verified ? "Arabic application UI verified" : "Arabic application UI not verified",
    };
  }

  const navigatorEnglish = /^en(?:[-_]|$)/i.test(state.navigatorLanguage);
  const documentEnglish = /^en(?:[-_]|$)/i.test(state.documentLanguage);
  const hasArabicNavigation = ARABIC_TEXT.test(combinedLabels);
  const hasEnglishNavigation = ENGLISH_NAVIGATION.test(combinedLabels);
  const verified =
    navigatorEnglish &&
    !hasArabicNavigation &&
    labels.length > 0 &&
    (documentEnglish || hasEnglishNavigation);
  return {
    verified,
    reason: verified
      ? "English application UI verified"
      : hasArabicNavigation
        ? "Arabic navigation labels remain visible"
        : "English application navigation could not be verified",
  };
}

export function localePersistenceSources(state: ApplicationLocaleState): string[] {
  const sources: string[] = [];
  if (state.localeCookies.length) sources.push("cookie");
  if (state.localeStorage.length) sources.push("localStorage");
  if (state.urlLocale) sources.push("URL");
  if (/^(en|ar)(?:[-_]|$)/i.test(state.documentLanguage)) sources.push("document");
  if (/^(en|ar)(?:[-_]|$)/i.test(state.navigatorLanguage)) sources.push("browser");
  return sources;
}
