import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/screenshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const target = requestUrl.searchParams.get("url") ?? "";
        const widthParam = Number(requestUrl.searchParams.get("width") ?? "1280");
        const width = Number.isFinite(widthParam) ? Math.min(Math.max(Math.round(widthParam), 640), 1600) : 1280;

        let targetUrl: URL;
        try {
          targetUrl = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`);
          if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") throw new Error("Unsupported protocol");
          if (targetUrl.toString().length > 500) throw new Error("URL too long");
        } catch {
          return svgFallback("Invalid website URL", 400);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const sources = [
          `https://image.thum.io/get/width/${width}/crop/720/noanimate/${encodeURI(targetUrl.toString())}`,
          `https://s.wordpress.com/mshots/v1/${encodeURIComponent(targetUrl.toString())}?w=${width}`,
        ];

        try {
          for (const source of sources) {
            const response = await fetch(source, { signal: controller.signal });
            const contentType = response.headers.get("content-type") ?? "";
            if (response.ok && contentType.startsWith("image/")) {
              return new Response(response.body, {
                headers: {
                  "content-type": contentType,
                  "cache-control": "public, max-age=900",
                },
              });
            }
          }
        } catch {
          return svgFallback(`Could not capture ${targetUrl.hostname}`, 200);
        } finally {
          clearTimeout(timeout);
        }

        return svgFallback(`Could not capture ${targetUrl.hostname}`, 200);
      },
    },
  },
});

function svgFallback(message: string, status: number) {
  const safeMessage = message.replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#111"/><circle cx="640" cy="304" r="52" fill="#ff5a1f" opacity="0.9"/><text x="640" y="400" text-anchor="middle" fill="#f5f5f5" font-family="Arial, sans-serif" font-size="34" font-weight="700">DemoForge capture</text><text x="640" y="448" text-anchor="middle" fill="#b8b8b8" font-family="Arial, sans-serif" font-size="22">${safeMessage}</text></svg>`;
  return new Response(svg, {
    status,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}