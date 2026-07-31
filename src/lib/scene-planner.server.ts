// AI scene planner: turns a real recon of the product into a shot list of
// browser actions with narration, capped to a 69 second demo.

import type { ReconResult } from "./steel-recon.server";

export type PlannedAction =
  | { type: "goto"; url: string; waitMs?: number }
  | { type: "wait"; ms: number }
  | { type: "scroll"; deltaY: number }
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "eval"; expression: string };

export type PlannedScene = { action: PlannedAction; narration: string };

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function safeActions(raw: unknown, origin: string): PlannedScene[] {
  if (!Array.isArray(raw)) return [];
  const scenes: PlannedScene[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const type = String(item.type ?? "");
    const narration = String(item.narration ?? "").slice(0, 160);
    if (type === "goto" && typeof item.url === "string") {
      try {
        const url = new URL(item.url, origin);
        scenes.push({ action: { type: "goto", url: url.toString(), waitMs: 3000 }, narration });
      } catch {
        /* skip */
      }
    } else if (type === "click" && typeof item.selector === "string") {
      scenes.push({ action: { type: "click", selector: item.selector }, narration });
    } else if (type === "type" && typeof item.selector === "string") {
      scenes.push({ action: { type: "type", selector: item.selector, text: String(item.text ?? "") }, narration });
    } else if (type === "scroll") {
      scenes.push({ action: { type: "scroll", deltaY: Number(item.deltaY) || 600 }, narration });
    } else if (type === "wait") {
      scenes.push({ action: { type: "wait", ms: Math.min(Number(item.ms) || 1500, 4000) }, narration });
    }
    if (scenes.length >= 14) break;
  }
  return scenes;
}

export async function planDemoScenes(input: {
  productName: string;
  baseUrl: string;
  featurePrompt: string;
  siteMapMd: string | null;
  recon: ReconResult | null;
  loginUrl?: string | null;
  credentials: { username: string; secret: string } | null;
}): Promise<{ scenes: PlannedScene[]; source: "ai" | "heuristic" }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  const origin = new URL(input.baseUrl).origin;

  if (apiKey) {
    const context = input.recon
      ? input.recon.pages
          .map((page) =>
            [
              `PAGE ${page.url} — ${page.title}`,
              `headings: ${page.headings.join(" | ")}`,
              `clickables: ${page.clickables.map((c) => `"${c.text}"=>${c.selector}`).join(" | ")}`,
              `inputs: ${page.inputs.map((i) => `${i.label}=>${i.selector}`).join(" | ")}`,
            ].join("\n"),
          )
          .join("\n\n")
          .slice(0, 12000)
      : (input.siteMapMd ?? "").slice(0, 8000);

    try {
      const res = await fetch(GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a product demo director driving a real Chromium browser. Return JSON only: {\"scenes\":[{\"type\":\"goto|click|type|scroll|wait\",\"url\":\"\",\"selector\":\"\",\"text\":\"\",\"deltaY\":600,\"ms\":1500,\"narration\":\"\"}]}. Use ONLY selectors and URLs that appear in the supplied recon. Between 6 and 12 scenes, roughly 5 seconds each so the whole demo stays under 69 seconds. Start on a real page, show the requested feature with genuine clicks, and end on a value screen. Never invent selectors.",
            },
            {
              role: "user",
              content: `Product: ${input.productName}\nBase URL: ${input.baseUrl}\nAuthenticated: ${input.recon?.loggedIn ? "yes" : "no"}\nFeature to demo: ${input.featurePrompt}\n\nRECON:\n${context}`,
            },
          ],
        }),
      });

      if (res.ok) {
        const payload = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content ?? "";
        const parsed = JSON.parse(content.replace(/^```json\s*|```$/g, "")) as { scenes?: unknown };
        const scenes = safeActions(parsed.scenes, origin);
        if (scenes.length >= 3) return { scenes, source: "ai" };
      }
    } catch {
      /* fall through to heuristic */
    }
  }

  return { scenes: heuristicScenes(input, origin), source: "heuristic" };
}

function heuristicScenes(
  input: {
    baseUrl: string;
    featurePrompt: string;
    recon: ReconResult | null;
  },
  origin: string,
): PlannedScene[] {
  const scenes: PlannedScene[] = [
    { action: { type: "goto", url: input.baseUrl, waitMs: 3500 }, narration: `Opening ${new URL(origin).hostname}` },
    { action: { type: "scroll", deltaY: 600 }, narration: "Showing the product value" },
    { action: { type: "scroll", deltaY: 700 }, narration: "Scrolling the proof section" },
  ];
  const pages = input.recon?.pages ?? [];
  for (const page of pages.slice(1, 4)) {
    scenes.push({ action: { type: "goto", url: page.url, waitMs: 3000 }, narration: page.title || page.url });
    scenes.push({ action: { type: "scroll", deltaY: 500 }, narration: "Reviewing this screen" });
  }
  scenes.push({ action: { type: "wait", ms: 2000 }, narration: input.featurePrompt.slice(0, 120) });
  return scenes;
}