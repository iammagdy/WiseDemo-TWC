import { z } from "zod";

const scoreSchema = z.number().min(0).max(100);
const nullableText = z.string().trim().min(1).max(1_000).nullable();
const publicUrlSchema = z.string().url().max(2_048);

export const publicFeatureSchema = z.object({
  id: z.string().min(1).max(96),
  name: z.string().min(1).max(160),
  description: z.string().min(1).max(1_000),
  userBenefit: z.string().min(1).max(600),
  userProblem: z.string().min(1).max(600),
  publicEvidenceUrls: z.array(publicUrlSchema).min(1).max(12),
  visualDemoPotential: scoreSchema,
  marketingPriority: scoreSchema,
  likelyAuthenticated: z.boolean(),
});

export const publicProductIntelligenceSchema = z.object({
  version: z.literal(1),
  sourceUrl: publicUrlSchema,
  canonicalDomain: z.string().min(1).max(253),
  analyzedAt: z.string().datetime(),
  brand: z.object({
    name: z.string().min(1).max(200),
    description: nullableText,
    slogan: nullableText,
    logoUrl: publicUrlSchema.nullable(),
    primaryLanguage: z.string().min(2).max(32).nullable(),
    colors: z.array(z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), role: nullableText })).max(20),
  }),
  audience: z.array(z.object({ name: z.string().min(1).max(200), problem: z.string().min(1).max(600), desiredOutcome: z.string().min(1).max(600) })).max(12),
  valuePropositions: z.array(z.object({ claim: z.string().min(1).max(1_000), evidenceUrl: publicUrlSchema, confidence: z.number().min(0).max(1) })).max(20),
  features: z.array(publicFeatureSchema).max(30),
  useCases: z.array(z.object({ name: z.string().min(1).max(200), audience: z.string().min(1).max(300), outcome: z.string().min(1).max(600) })).max(20),
  publicCallsToAction: z.array(z.string().min(1).max(240)).max(30),
  visualIdentity: z.object({
    mode: z.enum(["light", "dark", "unknown"]),
    accentColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(16),
    backgroundColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(16),
    textColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(16),
    headingFont: nullableText,
    bodyFont: nullableText,
    spacing: z.record(z.union([z.number(), z.string().max(80)])).default({}),
    shadows: z.record(z.string().max(240)).default({}),
  }),
  screenshots: z.object({ desktopUrl: publicUrlSchema.nullable(), narrowViewportUrl: publicUrlSchema.nullable() }),
  sourceEvidence: z.array(z.object({ url: publicUrlSchema, type: z.enum(["brand", "extract", "styleguide", "screenshot", "crawl"]) })).max(80),
  warnings: z.array(z.string().min(1).max(500)).max(30),
});

export type PublicProductIntelligence = z.infer<typeof publicProductIntelligenceSchema>;

export const contextExtractJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["audience", "valuePropositions", "features", "useCases", "callsToAction"],
  properties: {
    name: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    slogan: { type: ["string", "null"] },
    primaryLanguage: { type: ["string", "null"] },
    audience: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["name", "problem", "desiredOutcome"], properties: { name: { type: "string" }, problem: { type: "string" }, desiredOutcome: { type: "string" } } } },
    valuePropositions: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["claim", "evidenceUrl", "confidence"], properties: { claim: { type: "string" }, evidenceUrl: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 } } } },
    features: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["name", "description", "userBenefit", "userProblem", "publicEvidenceUrls", "visualDemoPotential", "marketingPriority", "likelyAuthenticated"], properties: { name: { type: "string" }, description: { type: "string" }, userBenefit: { type: "string" }, userProblem: { type: "string" }, publicEvidenceUrls: { type: "array", items: { type: "string" } }, visualDemoPotential: { type: "number", minimum: 0, maximum: 100 }, marketingPriority: { type: "number", minimum: 0, maximum: 100 }, likelyAuthenticated: { type: "boolean" } } } },
    useCases: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["name", "audience", "outcome"], properties: { name: { type: "string" }, audience: { type: "string" }, outcome: { type: "string" } } } },
    callsToAction: { type: "array", maxItems: 30, items: { type: "string" } },
  },
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 1_000): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function url(value: unknown): string | null {
  const valueText = text(value, 2_048);
  if (!valueText) return null;
  try {
    const parsed = new URL(valueText);
    return /^https?:$/.test(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function colour(value: unknown): string | null {
  const candidate = text(value, 16);
  if (!candidate) return null;
  const normalized = candidate.startsWith("#") ? candidate : `#${candidate}`;
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizedScore(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, number <= 1 ? number * 100 : number));
}

function safeEvidenceUrls(value: unknown, fallback: string): string[] {
  const urls = array(value).map(url).filter((entry): entry is string => Boolean(entry));
  return [...new Set(urls)].slice(0, 12).length ? [...new Set(urls)].slice(0, 12) : [fallback];
}

function compactObject(value: unknown): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(record(value))
      .filter(([, item]) => typeof item === "string" || typeof item === "number")
      .slice(0, 20),
  ) as Record<string, string | number>;
}

export function normalizePublicProductIntelligence(input: {
  sourceUrl: string;
  analyzedAt?: string;
  extract: unknown;
  brand?: unknown;
  styleguide?: unknown;
  desktopScreenshot?: unknown;
  narrowScreenshot?: unknown;
  crawlUrls?: string[];
  warnings?: string[];
}): PublicProductIntelligence {
  const source = new URL(input.sourceUrl);
  const extracted = record(record(input.extract).data ?? input.extract);
  const brand = record(record(input.brand).brand ?? input.brand);
  const styleguide = record(record(input.styleguide).styleguide ?? input.styleguide);
  const colors = array(brand.colors)
    .map((entry) => record(entry))
    .map((entry) => ({ hex: colour(entry.hex ?? entry.value), role: text(entry.type ?? entry.role, 120) }))
    .filter((entry): entry is { hex: string; role: string | null } => Boolean(entry.hex));
  const styleColors = record(styleguide.colors);
  const styleTypography = record(styleguide.typography);
  const headingTypography = record(styleTypography.heading);
  const bodyTypography = record(styleTypography.body);
  const evidenceUrls = array(record(input.extract).urls_analyzed).map(url).filter((entry): entry is string => Boolean(entry));
  const fallbackEvidence = evidenceUrls[0] ?? source.toString();
  const warnings = [...(input.warnings ?? [])];

  const features = array(extracted.features)
    .map((entry, index) => {
      const feature = record(entry);
      const name = text(feature.name, 160);
      const description = text(feature.description, 1_000);
      const benefit = text(feature.userBenefit, 600);
      const problem = text(feature.userProblem, 600);
      if (!name || !description || !benefit || !problem) return null;
      return {
        id: `public-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 72) || index + 1}`,
        name,
        description,
        userBenefit: benefit,
        userProblem: problem,
        publicEvidenceUrls: safeEvidenceUrls(feature.publicEvidenceUrls, fallbackEvidence),
        visualDemoPotential: normalizedScore(feature.visualDemoPotential),
        marketingPriority: normalizedScore(feature.marketingPriority),
        likelyAuthenticated: Boolean(feature.likelyAuthenticated),
      };
    })
    .filter((entry): entry is PublicProductIntelligence["features"][number] => Boolean(entry));
  const dedupedFeatures = features.filter((feature, index) => features.findIndex((candidate) => candidate.id === feature.id) === index);
  if (!dedupedFeatures.length) warnings.push("Context extraction did not return a sufficiently supported public feature.");

  const desktopUrl = url(record(input.desktopScreenshot).screenshot ?? input.desktopScreenshot);
  const narrowViewportUrl = url(record(input.narrowScreenshot).screenshot ?? input.narrowScreenshot);
  const allAccent = [...array(styleColors.primary), ...array(styleColors.accent), ...colors.map((entry) => entry.hex)]
    .map((entry) => colour(typeof entry === "object" ? record(entry).hex : entry))
    .filter((entry): entry is string => Boolean(entry));
  const visualMode = text(styleguide.mode, 24)?.toLowerCase();

  const result: PublicProductIntelligence = {
    version: 1,
    sourceUrl: source.toString(),
    canonicalDomain: source.hostname.toLowerCase(),
    analyzedAt: input.analyzedAt ?? new Date().toISOString(),
    brand: {
      name: text(brand.name ?? extracted.name, 200) ?? source.hostname,
      description: text(brand.description ?? extracted.description),
      slogan: text(brand.slogan ?? extracted.slogan),
      logoUrl: url(array(brand.logos)[0] && record(array(brand.logos)[0]).url),
      primaryLanguage: text(brand.language ?? extracted.primaryLanguage, 32),
      colors: colors.slice(0, 20),
    },
    audience: array(extracted.audience).map(record).map((entry) => ({ name: text(entry.name, 200), problem: text(entry.problem, 600), desiredOutcome: text(entry.desiredOutcome, 600) })).filter((entry): entry is PublicProductIntelligence["audience"][number] => Boolean(entry.name && entry.problem && entry.desiredOutcome)).slice(0, 12),
    valuePropositions: array(extracted.valuePropositions).map(record).map((entry) => ({ claim: text(entry.claim), evidenceUrl: url(entry.evidenceUrl), confidence: typeof entry.confidence === "number" ? Math.max(0, Math.min(1, entry.confidence)) : 0 })).filter((entry): entry is PublicProductIntelligence["valuePropositions"][number] => Boolean(entry.claim && entry.evidenceUrl)).slice(0, 20),
    features: dedupedFeatures.slice(0, 30),
    useCases: array(extracted.useCases).map(record).map((entry) => ({ name: text(entry.name, 200), audience: text(entry.audience, 300), outcome: text(entry.outcome, 600) })).filter((entry): entry is PublicProductIntelligence["useCases"][number] => Boolean(entry.name && entry.audience && entry.outcome)).slice(0, 20),
    publicCallsToAction: array(extracted.callsToAction).map((entry) => text(entry, 240)).filter((entry): entry is string => Boolean(entry)).slice(0, 30),
    visualIdentity: {
      mode: visualMode === "light" || visualMode === "dark" ? visualMode : "unknown",
      accentColors: [...new Set(allAccent)].slice(0, 16),
      backgroundColors: array(styleColors.background).map((entry) => colour(typeof entry === "object" ? record(entry).hex : entry)).filter((entry): entry is string => Boolean(entry)).slice(0, 16),
      textColors: array(styleColors.text).map((entry) => colour(typeof entry === "object" ? record(entry).hex : entry)).filter((entry): entry is string => Boolean(entry)).slice(0, 16),
      headingFont: text(styleTypography.headingFont ?? headingTypography.fontFamily, 200),
      bodyFont: text(styleTypography.bodyFont ?? bodyTypography.fontFamily, 200),
      spacing: compactObject(styleguide.elementSpacing ?? styleguide.spacing),
      shadows: Object.fromEntries(Object.entries(compactObject(styleguide.shadows)).map(([key, value]) => [key, String(value)])),
    },
    screenshots: { desktopUrl, narrowViewportUrl },
    sourceEvidence: [
      ...evidenceUrls.map((evidenceUrl) => ({ url: evidenceUrl, type: "extract" as const })),
      ...(url(brand.website ?? `https://${source.hostname}`) ? [{ url: url(brand.website ?? `https://${source.hostname}`) as string, type: "brand" as const }] : []),
      ...(Object.keys(styleguide).length ? [{ url: source.toString(), type: "styleguide" as const }] : []),
      ...(desktopUrl || narrowViewportUrl ? [{ url: source.toString(), type: "screenshot" as const }] : []),
      ...(input.crawlUrls ?? []).map(url).filter((entry): entry is string => Boolean(entry)).map((crawlUrl) => ({ url: crawlUrl, type: "crawl" as const })),
    ].slice(0, 80),
    warnings: [...new Set(warnings)].slice(0, 30),
  };
  return publicProductIntelligenceSchema.parse(result);
}
