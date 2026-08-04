import { createFileRoute } from "@tanstack/react-router";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/video-renders/$renderId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!uuidPattern.test(params.renderId))
          return new Response("Video render not found.", { status: 404 });
        try {
          const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
          const render = await appwriteWorkspace().getDirectorArtifact(params.renderId);
          const payload = render?.payload_json;
          const fileId =
            render?.artifact_kind === "video-render" &&
            typeof payload === "object" &&
            payload !== null &&
            !Array.isArray(payload) &&
            typeof payload.fileId === "string"
              ? payload.fileId
              : null;
          if (!fileId || !uuidPattern.test(fileId))
            return new Response("Video render not found.", { status: 404 });
          const [{ appwriteServer }, { fetchAppwriteRecording }] = await Promise.all([
            import("@/integrations/appwrite/client.server"),
            import("@/integrations/appwrite/storage.server"),
          ]);
          const upstream = await fetchAppwriteRecording(appwriteServer().config, fileId, {
            range: request.headers.get("range"),
            signal: request.signal,
          });
          if (![200, 206, 416].includes(upstream.status)) {
            await upstream.body?.cancel().catch(() => undefined);
            return new Response("Video render not found.", {
              status: upstream.status === 404 ? 404 : 503,
            });
          }
          const headers = new Headers({
            "accept-ranges": upstream.headers.get("accept-ranges") ?? "bytes",
            "cache-control": "private, no-store",
            "content-type": "video/mp4",
            "cross-origin-resource-policy": "same-origin",
          });
          for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
            const value = upstream.headers.get(name);
            if (value) headers.set(name, value);
          }
          if (new URL(request.url).searchParams.get("download") === "1") {
            headers.set(
              "content-disposition",
              `attachment; filename="wisedemo-video-${params.renderId.slice(0, 8)}.mp4"`,
            );
          }
          return new Response(upstream.body, { status: upstream.status, headers });
        } catch {
          return new Response("Video render unavailable.", { status: 503 });
        }
      },
    },
  },
});
