// AI scene planner: turns a real recon of the product into a shot list of
// browser actions with narration, capped to a 69 second demo.

import type { ReconResult } from "./steel-recon.server";
import type { CdpAction } from "./steel-recorder.server";
import { serverEnv } from "./server-env.server.ts";

export type PlannedAction = CdpAction;

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
    const timeoutMs = Math.min(Math.max(Number(item.timeoutMs) || 15_000, 1_000), 30_000);
    const expectedRaw =
      item.expected && typeof item.expected === "object"
        ? (item.expected as Record<string, unknown>)
        : null;
    const expected = expectedRaw
      ? {
          selector:
            typeof expectedRaw.selector === "string"
              ? expectedRaw.selector.slice(0, 500)
              : undefined,
          urlIncludes:
            typeof expectedRaw.urlIncludes === "string"
              ? expectedRaw.urlIncludes.slice(0, 300)
              : undefined,
        }
      : undefined;
    const fallbacks = Array.isArray(item.fallbackSelectors)
      ? item.fallbackSelectors
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.slice(0, 500))
          .slice(0, 5)
      : undefined;
    if (type === "goto" && typeof item.url === "string") {
      try {
        const url = new URL(item.url, origin);
        if (url.origin !== origin) continue;
        scenes.push({
          action: {
            type: "goto",
            url: url.toString(),
            waitMs: 1_000,
            timeoutMs,
            expected,
          },
          narration,
        });
      } catch {
        /* skip */
      }
    } else if (type === "click" && typeof item.selector === "string") {
      scenes.push({
        action: {
          type: "click",
          selector: item.selector.slice(0, 500),
          fallbackSelectors: fallbacks,
          timeoutMs,
          expected,
        },
        narration,
      });
    } else if (type === "type" && typeof item.selector === "string") {
      scenes.push({
        action: {
          type: "type",
          selector: item.selector.slice(0, 500),
          fallbackSelectors: fallbacks,
          text: String(item.text ?? "").slice(0, 300),
          timeoutMs,
          expected,
        },
        narration,
      });
    } else if (type === "scroll") {
      scenes.push({
        action: { type: "scroll", deltaY: Number(item.deltaY) || 600, timeoutMs, expected },
        narration,
      });
    } else if (type === "wait") {
      scenes.push({
        action: {
          type: "wait",
          ms: Math.min(Number(item.ms) || 1_500, 10_000),
          selector: typeof item.selector === "string" ? item.selector.slice(0, 500) : undefined,
          timeoutMs,
          expected,
        },
        narration,
      });
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
}): Promise<{ scenes: PlannedScene[]; source: "ai" | "heuristic" }> {
  const apiKey = serverEnv("LOVABLE_API_KEY");
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
                'You are a product demo director driving a real Chromium browser. Return JSON only: {"scenes":[{"type":"goto|click|type|scroll|wait","url":"","selector":"","fallbackSelectors":[],"text":"","deltaY":600,"ms":1500,"timeoutMs":15000,"expected":{"selector":"","urlIncludes":""},"narration":""}]}. Use ONLY selectors and same-origin URLs from the supplied recon. Prefer valid CSS or exact selectors from recon. Each click or type must include an observable expected selector or URL when possible. Between 6 and 12 scenes. Start on a real page, show the requested feature with genuine clicks, and end on a value screen. Never invent selectors and never request or include credentials.',
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
    {
      action: { type: "goto", url: input.baseUrl, waitMs: 3500 },
      narration: `Opening ${new URL(origin).hostname}`,
    },
    { action: { type: "scroll", deltaY: 600 }, narration: "Showing the product value" },
    { action: { type: "scroll", deltaY: 700 }, narration: "Scrolling the proof section" },
  ];
  const pages = input.recon?.pages ?? [];
  for (const page of pages.slice(1, 4)) {
    scenes.push({
      action: { type: "goto", url: page.url, waitMs: 3000 },
      narration: page.title || page.url,
    });
    scenes.push({ action: { type: "scroll", deltaY: 500 }, narration: "Reviewing this screen" });
  }
  scenes.push({ action: { type: "wait", ms: 2000 }, narration: input.featurePrompt.slice(0, 120) });
  return scenes;
}
