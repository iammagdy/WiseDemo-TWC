import { serverEnv } from "./server-env.server.ts";

type ScanLink = {
  label: string;
  url: string;
};

export type WebsiteScan = {
  title: string;
  description: string;
  siteMapMd: string;
  links: ScanLink[];
  authUrl: string | null;
};

export function normalizePublicUrl(input: string): string {
  const candidate = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const url = new URL(candidate);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Enter a public http or https website URL.");
  }

  url.hash = "";
  if (url.pathname === "/") url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

export async function scanWebsite(url: string, projectName: string): Promise<WebsiteScan> {
  const normalizedUrl = normalizePublicUrl(url);

  try {
    const firecrawlScan = await scanWithFirecrawl(normalizedUrl, projectName);
    if (firecrawlScan) return firecrawlScan;

    const html = await fetchHtml(normalizedUrl, 9000);
    const textOnly = stripHtml(html);
    const title = getTagText(html, "title") || getHeading(html, 1) || projectName;
    const description =
      getMetaContent(html, "description") ||
      getMetaContent(html, "og:description") ||
      sentenceFromText(textOnly) ||
      `${projectName} product experience.`;
    const homeLinks = collectLinks(html, normalizedUrl);
    const sitemapLinks = await discoverSitemapLinks(normalizedUrl);
    const candidateLinks = prioritizeLinks([...homeLinks, ...sitemapLinks], normalizedUrl).slice(0, 8);
    const scannedPages = await Promise.all(
      candidateLinks.map(async (link) => {
        try {
          return { link, html: link.url === normalizedUrl ? html : await fetchHtml(link.url, 5500) };
        } catch {
          return { link, html: "" };
        }
      }),
    );

    const headings = unique(scannedPages.flatMap((page) => (page.html ? collectHeadings(page.html) : [page.link.label]))).slice(0, 18);
    const actions = unique(scannedPages.flatMap((page) => (page.html ? collectActions(page.html) : []))).slice(0, 16);
    const features = unique(scannedPages.flatMap((page) => collectFeatureSignals(page.html, page.link.label))).slice(0, 14);
    const links = mergeScanLinks([{ label: "Start page", url: normalizedUrl }, ...homeLinks, ...sitemapLinks, ...candidateLinks]).slice(0, 24);
    const authUrl = await detectAuthUrl(html, links, normalizedUrl);

    return {
      title: cleanText(title).slice(0, 120),
      description: cleanText(description).slice(0, 700),
      links,
      authUrl,
      siteMapMd: buildSiteMap({ projectName, normalizedUrl, title, description, headings, actions, features, links, authUrl }),
    };
  } catch {
    return buildFallbackScan(normalizedUrl, projectName);
  }
}

async function scanWithFirecrawl(baseUrl: string, projectName: string): Promise<WebsiteScan | null> {
  const connectionKey = serverEnv("FIRECRAWL_API_KEY");
  if (!connectionKey) return null;

  try {
    const [mapResult, scrapeResult] = await Promise.all([
      callFirecrawl<{ success?: boolean; links?: string[]; data?: { links?: string[] } }>("/map", {
        url: baseUrl,
        limit: 40,
        includeSubdomains: false,
      }),
      callFirecrawl<{
        success?: boolean;
        markdown?: string;
        summary?: string;
        metadata?: { title?: string; description?: string; sourceURL?: string };
        data?: { markdown?: string; summary?: string; metadata?: { title?: string; description?: string; sourceURL?: string } };
      }>("/scrape", {
        url: baseUrl,
        formats: ["markdown", "summary", "links"],
        onlyMainContent: true,
        waitFor: 1500,
      }),
    ]);

    const metadata = scrapeResult.metadata ?? scrapeResult.data?.metadata;
    const markdown = scrapeResult.markdown ?? scrapeResult.data?.markdown ?? "";
    const summary = scrapeResult.summary ?? scrapeResult.data?.summary ?? "";
    const title = metadata?.title || firstMarkdownHeading(markdown) || projectName;
    const description = metadata?.description || summary || sentenceFromText(markdown) || `${projectName} product experience.`;
    const mappedLinks = (mapResult.links ?? mapResult.data?.links ?? [])
      .map((link) => toSameOriginLink(link, baseUrl))
      .filter((link): link is ScanLink => Boolean(link));
    const inlineLinks = extractMarkdownLinks(markdown, baseUrl);
    const links = prioritizeLinks([{ label: "Start page", url: baseUrl }, ...mappedLinks, ...inlineLinks], baseUrl).slice(0, 24);
    const headings = extractMarkdownHeadings(markdown);
    const actions = extractMarkdownActions(markdown);
    const features = extractMarkdownFeatures(markdown, description);
    const authUrl = links.find((link) => isAuthCandidate(`${link.label} ${link.url}`))?.url ?? (await detectAuthUrl("", links, baseUrl));

    return {
      title: cleanText(title).slice(0, 120),
      description: cleanText(description).slice(0, 700),
      links: mergeScanLinks([{ label: "Start page", url: baseUrl }, ...links]).slice(0, 24),
      authUrl,
      siteMapMd: buildSiteMap({ projectName, normalizedUrl: baseUrl, title, description, headings, actions, features, links, authUrl }),
    };
  } catch (error) {
    console.warn("Firecrawl scan failed; using direct scanner fallback", error instanceof Error ? error.message : error);
    return null;
  }
}

async function callFirecrawl<T>(path: "/map" | "/scrape", body: Record<string, unknown>): Promise<T> {
  const connectionKey = serverEnv("FIRECRAWL_API_KEY");
  const lovableKey = serverEnv("LOVABLE_API_KEY");
  if (!connectionKey) throw new Error("Firecrawl is not connected.");
  const isDirectProviderKey = connectionKey.startsWith("fc-");
  if (!isDirectProviderKey && !lovableKey) throw new Error("Firecrawl gateway is not configured.");
  const endpoint = isDirectProviderKey
    ? `https://api.firecrawl.dev/v2${path}`
    : `https://connector-gateway.lovable.dev/firecrawl/v2${path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${isDirectProviderKey ? connectionKey : lovableKey}`,
  };
  if (!isDirectProviderKey) headers["x-connection-api-key"] = connectionKey;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Firecrawl request failed [${response.status}]: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

function toSameOriginLink(value: string, base: string): ScanLink | null {
  try {
    const baseUrl = new URL(base);
    const url = new URL(value, baseUrl);
    if (url.origin !== baseUrl.origin) return null;
    url.hash = "";
    return { label: labelFromPath(url.pathname), url: url.toString().replace(/\/$/, "") };
  } catch {
    return null;
  }
}

function firstMarkdownHeading(markdown: string) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

function extractMarkdownLinks(markdown: string, base: string) {
  const links: ScanLink[] = [];
  for (const match of markdown.matchAll(/\[([^\]]{1,90})\]\(([^)]+)\)/g)) {
    const link = toSameOriginLink(match[2], base);
    if (link) links.push({ ...link, label: cleanText(match[1]) || link.label });
  }
  return mergeScanLinks(links);
}

function extractMarkdownHeadings(markdown: string) {
  return unique(
    Array.from(markdown.matchAll(/^#{1,3}\s+(.+)$/gm))
      .map((match) => cleanText(match[1]))
      .filter((text) => text.length > 2 && text.length < 120),
  ).slice(0, 18);
}

function extractMarkdownActions(markdown: string) {
  return unique(
    markdown
      .split(/\n+/)
      .map((line) => cleanText(line.replace(/^[-*#\s]+/, "")))
      .filter((text) => text.length > 2 && text.length < 90)
      .filter((text) => /start|try|demo|sign|login|create|book|join|launch|get|export|dashboard|pricing|learn|contact|download|share|publish/i.test(text)),
  ).slice(0, 16);
}

function extractMarkdownFeatures(markdown: string, description: string) {
  return unique(
    [description, ...markdown.split(/\n+/)]
      .map((line) => cleanText(line.replace(/^[-*#\s]+/, "")))
      .filter((text) => text.length >= 8 && text.length <= 130)
      .filter((text) => /ai|agent|demo|video|record|export|dashboard|workflow|automate|analytics|campaign|builder|editor|template|collaborat|integrat|report|publish|share|create|generate|feature|product|customer|team|brand|content/i.test(text)),
  ).slice(0, 14);
}

function buildFallbackScan(url: string, projectName: string): WebsiteScan {
  return {
    title: projectName,
    description: `${projectName} product experience captured from ${url}.`,
    links: [{ label: "Start page", url }],
    authUrl: null,
    siteMapMd: buildSiteMap({
      projectName,
      normalizedUrl: url,
      title: projectName,
      description: `${projectName} product experience captured from ${url}.`,
      headings: [],
      actions: ["Open product", "Review main call to action", "Show result"],
      features: ["Main product experience", "Primary call to action", "Final value screen"],
      links: [{ label: "Start page", url }],
      authUrl: null,
    }),
  };
}

function buildSiteMap(input: {
  projectName: string;
  normalizedUrl: string;
  title: string;
  description: string;
  headings: string[];
  actions: string[];
  features: string[];
  links: ScanLink[];
  authUrl: string | null;
}) {
  const pageLines = (input.links.length > 0 ? input.links : [{ label: "Start page", url: input.normalizedUrl }])
    .slice(0, 12)
    .map((link) => `- ${link.label}: ${link.url}`)
    .join("\n");
  const headingLines = input.headings.slice(0, 10).map((heading) => `- ${heading}`).join("\n") || "- Main product screen";
  const featureLines = input.features.slice(0, 12).map((feature) => `- ${feature}`).join("\n") || "- Main product experience";
  const actionLines = input.actions.slice(0, 10).map((action) => `- ${action}`).join("\n") || "- Open the product\n- Show the primary call to action\n- End on the most visual proof screen";

  return `# ${input.projectName} product map

Base URL: ${input.normalizedUrl}
Detected title: ${cleanText(input.title)}

## Product description
${cleanText(input.description)}

## Real pages discovered
${pageLines}

## Important visible sections
${headingLines}

## Features and product signals
${featureLines}

## Clicks and calls to action to film
${actionLines}

## Authentication
${input.authUrl ? `- Detected login page: ${input.authUrl}` : "- No dedicated login page detected from the public scan. Record the landing page unless the user adds credentials."}

## Demo direction
1. Open the real site and establish what the product is.
2. If credentials are saved and a login page is detected, sign in through the detected login page.
3. If no credentials are saved, record the public landing page with scroll down and scroll back up.
4. Move through the clearest page or call to action discovered above.
5. Highlight the result, export, dashboard, or proof screen.
6. Keep the final video under 69 seconds and avoid invented product states.
`;
}

async function fetchHtml(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; WiseDemoBot/1.0; +https://lovable.dev)",
      },
    });

    if (!response.ok) throw new Error(`The site returned ${response.status}.`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/html|xml|text/i.test(contentType)) throw new Error("The URL did not return readable page content.");
    return (await response.text()).slice(0, 700_000);
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverSitemapLinks(base: string): Promise<ScanLink[]> {
  const baseUrl = new URL(base);
  const sitemapUrls = [new URL("/sitemap.xml", baseUrl).toString(), new URL("/sitemap_index.xml", baseUrl).toString()];
  const links: ScanLink[] = [];

  for (const sitemapUrl of sitemapUrls) {
    try {
      const xml = await fetchHtml(sitemapUrl, 4500);
      for (const match of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const loc = decodeEntities(match[1]);
        const url = new URL(loc, baseUrl);
        if (url.origin !== baseUrl.origin) continue;
        url.hash = "";
        const normalized = url.toString().replace(/\/$/, "");
        links.push({ label: labelFromPath(url.pathname), url: normalized });
        if (links.length >= 28) break;
      }
    } catch {
      // Many apps do not expose a sitemap; home-page links still work.
    }
  }

  return mergeScanLinks(links);
}

function prioritizeLinks(links: ScanLink[], base: string): ScanLink[] {
  const baseUrl = new URL(base);
  return mergeScanLinks(links)
    .filter((link) => {
      try {
        const url = new URL(link.url);
        return url.origin === baseUrl.origin && !/\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|webm)$/i.test(url.pathname);
      } catch {
        return false;
      }
    })
    .sort((a, b) => linkScore(b) - linkScore(a));
}

function linkScore(link: ScanLink) {
  const value = `${link.label} ${link.url}`.toLowerCase();
  let score = 0;
  if (/feature|product|solution|use-case|workflow|dashboard|app|demo|pricing|customer|case|integrations/.test(value)) score += 30;
  if (/auth|login|signin|sign-in|account/.test(value)) score += 18;
  if (/blog|privacy|terms|legal|cookie|status|docs\/api|changelog/.test(value)) score -= 30;
  score -= Math.min(12, new URL(link.url).pathname.split("/").filter(Boolean).length * 2);
  return score;
}

function mergeScanLinks(links: ScanLink[]) {
  const seen = new Set<string>();
  const merged: ScanLink[] = [];

  for (const link of links) {
    const normalized = link.url.replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push({ label: cleanText(link.label || labelFromPath(new URL(normalized).pathname)).slice(0, 80), url: normalized });
  }

  return merged;
}

function stripHtml(html: string) {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function getTagText(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function getHeading(html: string, level: number) {
  return getTagText(html, `h${level}`);
}

function getMetaContent(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return "";
}

function collectHeadings(html: string) {
  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((match) => cleanText(decodeEntities(match[1].replace(/<[^>]+>/g, " "))))
    .filter(Boolean);
  return unique(headings).slice(0, 12);
}

function collectActions(html: string) {
  const actions = Array.from(html.matchAll(/<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi))
    .map((match) => cleanText(decodeEntities(match[1].replace(/<[^>]+>/g, " "))))
    .filter((text) => text.length > 1 && text.length < 70)
    .filter((text) => /start|try|demo|sign|login|create|book|join|launch|get|export|dashboard|pricing|learn|contact/i.test(text));
  return unique(actions).slice(0, 12);
}

function collectFeatureSignals(html: string, fallbackLabel: string) {
  if (!html) return [fallbackLabel];

  const textCandidates = [
    ...Array.from(html.matchAll(/<(?:h[1-4]|strong|b|span|p|li)[^>]*>([\s\S]*?)<\/(?:h[1-4]|strong|b|span|p|li)>/gi)).map((match) =>
      cleanText(decodeEntities(match[1].replace(/<[^>]+>/g, " "))),
    ),
    ...Array.from(html.matchAll(/(?:aria-label|title|alt)=["']([^"']{8,120})["']/gi)).map((match) => cleanText(decodeEntities(match[1]))),
  ];

  return unique(
    textCandidates
      .filter((text) => text.length >= 8 && text.length <= 120)
      .filter((text) => /ai|agent|demo|video|record|export|dashboard|workflow|automate|analytics|campaign|builder|editor|template|collaborat|integrat|report|publish|share|create|generate|feature|product/i.test(text)),
  ).slice(0, 8);
}

function collectLinks(html: string, base: string): ScanLink[] {
  const baseUrl = new URL(base);
  const links: ScanLink[] = [];

  for (const match of html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[1]);
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;

    try {
      const url = new URL(href, baseUrl);
      if (url.origin !== baseUrl.origin) continue;
      url.hash = "";
      const label = cleanText(decodeEntities(match[2].replace(/<[^>]+>/g, " "))) || labelFromPath(url.pathname);
      const normalized = url.toString().replace(/\/$/, "");
      if (!links.some((link) => link.url === normalized)) links.push({ label: label.slice(0, 80), url: normalized });
      if (links.length >= 14) break;
    } catch {
      // Ignore malformed links from the target page.
    }
  }

  if (!links.some((link) => link.url === base)) links.unshift({ label: "Start page", url: base });
  return links.slice(0, 14);
}

async function detectAuthUrl(html: string, links: ScanLink[], base: string) {
  const found = links.find((link) => isAuthCandidate(`${link.label} ${link.url}`));
  if (found) return found.url;

  const inlineHref = Array.from(html.matchAll(/href=["']([^"']+)["']/gi))
    .map((match) => match[1])
    .find((href) => isAuthCandidate(href));
  if (inlineHref) {
    try {
      return new URL(decodeEntities(inlineHref), base).toString().replace(/\/$/, "");
    } catch {
      // Ignore malformed auth links.
    }
  }

  const baseUrl = new URL(base);
  const commonPaths = ["/auth", "/login", "/signin", "/sign-in", "/log-in", "/users/sign_in", "/account/login"];
  const scored: { url: string; score: number }[] = [];

  for (const path of commonPaths) {
    try {
      const url = new URL(path, baseUrl).toString().replace(/\/$/, "");
      const body = (await fetchHtml(url, 3500)).slice(0, 80_000);
      const text = stripHtml(body).toLowerCase();
      const title = getTagText(body, "title").toLowerCase();
      let score = commonPaths.length - commonPaths.indexOf(path);
      if (/sign\s*in|log\s*in|continue with|password|email/.test(`${title} ${text}`)) score += 40;
      if (path === "/auth") score += 8;
      if (/not found|404/.test(`${title} ${text}`)) score -= 50;
      scored.push({ url, score });
    } catch {
      // Continue probing other common auth routes.
    }
  }

  return scored.sort((a, b) => b.score - a.score)[0]?.url ?? null;
}

function isAuthCandidate(value: string) {
  return /(^|[\s/._-])(auth|login|log-in|signin|sign-in|sign_in|account)([\s/._-]|$)/i.test(value);
}

function sentenceFromText(text: string) {
  const sentence = text.split(/(?<=[.!?])\s+/).find((item) => item.length > 50 && item.length < 240);
  return sentence ?? text.slice(0, 180);
}

function labelFromPath(pathname: string) {
  const segment = pathname.split("/").filter(Boolean).at(-1) ?? "Start page";
  return segment.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function unique(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanText(value: string) {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
