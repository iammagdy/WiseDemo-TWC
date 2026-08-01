import { createFileRoute } from "@tanstack/react-router";

import type { DemoRecord } from "@/integrations/appwrite/types";
import { safeRecordingFilename } from "@/lib/demo-state";

export const Route = createFileRoute("/api/public/demo-recordings/$demoId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const demoId = params.demoId;
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(demoId)
        ) {
          return new Response("Recording not found.", { status: 404 });
        }

        const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
        let demo: DemoRecord | null;
        try {
          demo = await appwriteWorkspace().getDemo(demoId);
        } catch (error) {
          console.error("[WiseDemo] recording URL lookup failed", {
            demoId,
            code: error instanceof Error ? error.message : "APPWRITE_LOOKUP_FAILED",
          });
          return new Response("Could not load the recording.", { status: 503 });
        }
        if (demo?.status !== "ready" || !demo.recording_file_id) {
          return new Response("Recording not found.", { status: 404 });
        }

        const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
        const { appwriteServer } = await import("@/integrations/appwrite/client.server");
        const { fetchAppwriteRecording } = await import("@/integrations/appwrite/storage.server");
        let upstream: Response;
        try {
          upstream = await fetchAppwriteRecording(appwriteServer().config, demo.recording_file_id, {
            range: request.headers.get("range"),
            signal: request.signal,
          });
        } catch (error) {
          console.error("[WiseDemo] Appwrite recording fetch failed", {
            demoId,
            code: error instanceof Error ? error.name : "APPWRITE_FILE_FETCH_FAILED",
          });
          return new Response("Could not load the recording.", { status: 503 });
        }

        if (![200, 206, 416].includes(upstream.status)) {
          await upstream.body?.cancel().catch(() => undefined);
          return new Response(
            upstream.status === 404 ? "Recording not found." : "Could not load the recording.",
            { status: upstream.status === 404 ? 404 : 503 },
          );
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
        if (wantsDownload) {
          headers.set(
            "content-disposition",
            `attachment; filename="${safeRecordingFilename(demo.title)}"`,
          );
        }

        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});
