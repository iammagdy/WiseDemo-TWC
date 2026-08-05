import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/composition-exports/$exportId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const exportId = params.exportId;
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            exportId,
          )
        ) {
          return new Response("Composition export not found.", { status: 404 });
        }

        const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
        const record = await appwriteWorkspace()
          .getCompositionExport(exportId)
          .catch(() => null);
        if (record?.render_status !== "ready" || !record.final_recording_file_id) {
          return new Response("Composition export not found.", { status: 404 });
        }

        const { appwriteServer } = await import("@/integrations/appwrite/client.server");
        const { fetchAppwriteRecording } = await import("@/integrations/appwrite/storage.server");
        let upstream: Response;
        try {
          upstream = await fetchAppwriteRecording(
            appwriteServer().config,
            record.final_recording_file_id,
            { range: request.headers.get("range"), signal: request.signal },
          );
        } catch {
          return new Response("Could not load the composition export.", { status: 503 });
        }

        if (![200, 206, 416].includes(upstream.status)) {
          await upstream.body?.cancel().catch(() => undefined);
          return new Response("Could not load the composition export.", {
            status: upstream.status === 404 ? 404 : 503,
          });
        }

        const headers = new Headers({
          "accept-ranges": upstream.headers.get("accept-ranges") ?? "bytes",
          "cache-control": "private, no-store",
          "content-type": upstream.headers.get("content-type") ?? "video/mp4",
          "cross-origin-resource-policy": "same-origin",
          "referrer-policy": "no-referrer",
        });
        for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
          const value = upstream.headers.get(name);
          if (value) headers.set(name, value);
        }
        if (new URL(request.url).searchParams.get("download") === "1") {
          headers.set(
            "content-disposition",
            `attachment; filename="wisedemo-composition-${exportId.slice(0, 8)}.mp4"`,
          );
        }
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});
