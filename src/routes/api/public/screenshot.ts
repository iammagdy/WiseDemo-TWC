import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/screenshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const target = requestUrl.searchParams.get("url") ?? "";
        const widthParam = Number(requestUrl.searchParams.get("width") ?? "1280");
        const width = Number.isFinite(widthParam)
          ? Math.min(Math.max(Math.round(widthParam), 640), 1600)
          : 1280;

        let targetUrl: URL;
        try {
          targetUrl = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`);
          if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:")
            throw new Error("Unsupported protocol");
          if (targetUrl.toString().length > 500) throw new Error("URL too long");
        } catch {
          return svgFallback("Invalid website URL", 400);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const sources = [
          `https://s.wordpress.com/mshots/v1/${encodeURIComponent(targetUrl.toString())}?w=${width}`,
          `https://image.thum.io/get/width/${width}/crop/720/noanimate/${encodeURI(targetUrl.toString())}`,
        ];

        try {
          for (const source of sources) {
            const response = await fetch(source, { signal: controller.signal });
            const contentType = response.headers.get("content-type") ?? "";
            if (response.ok && contentType.startsWith("image/")) {
              const body = await response.arrayBuffer();
              if (body.byteLength < 4000) continue;
              return new Response(body, {
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#100d0b"/><stop offset="0.58" stop-color="#24150f"/><stop offset="1" stop-color="#ff4f00"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg)"/><rect x="96" y="92" width="1088" height="536" rx="24" fill="#f7f2ec"/><rect x="96" y="92" width="1088" height="58" rx="24" fill="#16110e"/><circle cx="134" cy="121" r="9" fill="#ff4f00"/><circle cx="164" cy="121" r="9" fill="#f2b84b"/><circle cx="194" cy="121" r="9" fill="#2ac769"/><rect x="150" y="214" width="520" height="34" rx="10" fill="#16110e"/><rect x="150" y="282" width="830" height="20" rx="10" fill="#6f645e" opacity="0.45"/><rect x="150" y="326" width="720" height="20" rx="10" fill="#6f645e" opacity="0.35"/><rect x="150" y="394" width="210" height="58" rx="12" fill="#ff4f00"/><rect x="150" y="514" width="900" height="34" rx="12" fill="#ffffff" opacity="0.85"/><text x="640" y="578" text-anchor="middle" fill="#2a201b" font-family="Arial, sans-serif" font-size="28" font-weight="700">WiseDemo capture</text><text x="640" y="616" text-anchor="middle" fill="#6f645e" font-family="Arial, sans-serif" font-size="18">${safeMessage}</text></svg>`;
  return new Response(svg, {
    status,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
