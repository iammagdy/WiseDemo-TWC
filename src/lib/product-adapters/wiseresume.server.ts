import type { RecordingLocale } from "../recording-locale";

export type ProductLocaleAdapterContext = {
  evaluate: (expression: string) => Promise<unknown>;
  delay: (milliseconds: number) => Promise<unknown>;
  waitUntil: (expression: string, timeoutMs: number) => Promise<boolean>;
  goto: (url: string, settleMs: number) => Promise<void>;
};

async function isWiseResume(context: ProductLocaleAdapterContext): Promise<boolean> {
  const host = await context.evaluate("location.hostname");
  return typeof host === "string" && /(^|\.)wiseresume\.app$/i.test(host);
}

export async function openWiseResumeLanguageSettings(
  context: ProductLocaleAdapterContext,
): Promise<boolean> {
  if (!(await isWiseResume(context))) return false;

  const clicked = await context.evaluate(
    `(() => {
      const visible = (element) => { const rect = element.getBoundingClientRect(); return rect.width > 4 && rect.height > 4; };
      const label = (element) => String(element.innerText || element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
      const settings = Array.from(document.querySelectorAll("a[href], button, [role=button], [role=menuitem]"))
        .find((element) => visible(element) && (/settings|الإعدادات/i.test(label(element)) || /settings/i.test(element.getAttribute("href") || "")));
      if (!settings) return false;
      settings.click();
      return true;
    })()`,
  );
  if (clicked === true) await context.delay(900);
  const selectorReady = await context.waitUntil(
    `Array.from(document.querySelectorAll("select")).some((select) => Array.from(select.options).some((option) => /english|^en([-_]|$)/i.test(option.text + " " + option.value)))`,
    12_000,
  );
  if (selectorReady) return true;

  const origin = await context.evaluate("location.origin");
  if (typeof origin !== "string") return false;
  await context.goto(new URL("/settings", origin).toString(), 1_500);
  return context.waitUntil(
    `Array.from(document.querySelectorAll("select")).some((select) => Array.from(select.options).some((option) => /english|^en([-_]|$)/i.test(option.text + " " + option.value)))`,
    15_000,
  );
}

export async function applyWiseResumeProfileLocale(
  context: ProductLocaleAdapterContext,
  locale: Exclude<RecordingLocale, "auto">,
): Promise<boolean> {
  if (!(await isWiseResume(context))) return false;
  const language = locale === "english" ? "en" : "ar";
  const updated = await context.evaluate(
    `(async () => {
      const endpoint = "https://fra.cloud.appwrite.io/v1";
      const project = "69fd362b001eb325a192";
      const headers = { "X-Appwrite-Project": project, "Content-Type": "application/json" };
      const accountResponse = await fetch(endpoint + "/account", { credentials: "include", headers });
      if (!accountResponse.ok) return false;
      const account = await accountResponse.json();
      if (!account || typeof account.$id !== "string") return false;
      const query = encodeURIComponent(JSON.stringify({ method: "equal", attribute: "user_id", values: [account.$id] }));
      const listResponse = await fetch(endpoint + "/databases/main/collections/user_preferences/documents?queries[]=" + query, { credentials: "include", headers });
      if (!listResponse.ok) return false;
      const list = await listResponse.json();
      const documentId = list?.documents?.[0]?.$id;
      if (typeof documentId !== "string") return false;
      const updateResponse = await fetch(endpoint + "/databases/main/collections/user_preferences/documents/" + encodeURIComponent(documentId), {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({ data: { language: ${JSON.stringify(language)} } }),
      });
      if (!updateResponse.ok) return false;
      localStorage.setItem("wiseresume-locale", ${JSON.stringify(language)});
      location.reload();
      return true;
    })()`,
  );
  if (updated !== true) return false;
  await context.delay(1_500);
  await context.waitUntil(
    'document.readyState === "interactive" || document.readyState === "complete"',
    12_000,
  );
  return true;
}
