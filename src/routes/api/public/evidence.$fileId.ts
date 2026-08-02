import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/evidence/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!/^[0-9a-f-]{20,96}$/i.test(params.fileId))
          return new Response("Evidence not found.", { status: 404 });
        try {
          const { fetchEvidenceScreenshot } =
            await import("@/integrations/appwrite/evidence-storage.server");
          const upstream = await fetchEvidenceScreenshot(params.fileId, { signal: request.signal });
          if (!upstream.ok)
            return new Response("Evidence not found.", {
              status: upstream.status === 404 ? 404 : 503,
            });
          return new Response(upstream.body, {
            headers: {
              "cache-control": "private, no-store",
              "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
              "cross-origin-resource-policy": "same-origin",
            },
          });
        } catch {
          return new Response("Evidence unavailable.", { status: 503 });
        }
      },
    },
  },
});
