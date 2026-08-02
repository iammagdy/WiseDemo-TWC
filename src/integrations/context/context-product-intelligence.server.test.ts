import assert from "node:assert/strict";
import test from "node:test";

import { ContextProductIntelligenceProvider } from "./context-product-intelligence.server.ts";

function contextClient() {
  const calls: Array<{ kind: string; value: unknown }> = [];
  return {
    calls,
    client: {
      brand: {
        retrieve: async (value: unknown) => {
          calls.push({ kind: "brand", value });
          return {
            brand: {
              name: "Acme",
              colors: [{ hex: "0A66FF", type: "primary" }],
              logos: [{ url: "https://product.example.test/logo.svg" }],
            },
          };
        },
      },
      web: {
        extract: async (value: unknown) => {
          calls.push({ kind: "extract", value });
          return {
            data: {
              audience: [
                {
                  name: "Sales teams",
                  problem: "Manual follow-up",
                  desiredOutcome: "Faster pipeline",
                },
              ],
              valuePropositions: [
                {
                  claim: "Automate follow-up",
                  evidenceUrl: "https://product.example.test/features",
                  confidence: 0.9,
                },
              ],
              features: [
                {
                  name: "Smart sequences",
                  description: "Automated multistep outreach",
                  userBenefit: "Save selling time",
                  userProblem: "Manual follow-up",
                  publicEvidenceUrls: ["https://product.example.test/features"],
                  visualDemoPotential: 88,
                  marketingPriority: 92,
                  likelyAuthenticated: true,
                },
                {
                  name: "Smart sequences",
                  description: "Duplicate",
                  userBenefit: "Duplicate",
                  userProblem: "Duplicate",
                  publicEvidenceUrls: ["https://product.example.test/features"],
                  visualDemoPotential: 60,
                  marketingPriority: 60,
                  likelyAuthenticated: true,
                },
              ],
              useCases: [{ name: "Pipeline", audience: "Sales", outcome: "More follow-up" }],
              callsToAction: ["Start free"],
            },
            urls_analyzed: ["https://product.example.test/features"],
          };
        },
        extractStyleguide: async () => ({
          styleguide: {
            colors: { primary: ["#0A66FF"], background: ["#FFFFFF"], text: ["#111111"] },
            typography: { headingFont: "Manrope", bodyFont: "Inter" },
            mode: "light",
          },
        }),
        screenshot: async (value: { viewport: { width: number } }) => ({
          screenshot:
            value.viewport.width > 500
              ? "https://cdn.example.test/desktop.png"
              : "https://cdn.example.test/narrow.png",
        }),
        webCrawlMd: async () => ({ results: [] }),
      },
    },
  };
}

test("Context provider normalizes, deduplicates, and preserves public evidence", async () => {
  const mock = contextClient();
  const provider = new ContextProductIntelligenceProvider({
    client: mock.client as never,
    validateUrl: async () => new URL("https://product.example.test"),
    maxPages: 4,
  });
  const result = await provider.analyzePublicProduct({
    url: "https://product.example.test",
    forceRefresh: true,
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].publicEvidenceUrls[0], "https://product.example.test/features");
  assert.equal(result.visualIdentity.headingFont, "Manrope");
  assert.equal(result.screenshots.desktopUrl, "https://cdn.example.test/desktop.png");
  const extract = mock.calls.find((call) => call.kind === "extract")?.value as {
    maxAgeMs: number;
    factCheck: boolean;
  };
  assert.equal(extract.maxAgeMs, 0);
  assert.equal(extract.factCheck, true);
});
