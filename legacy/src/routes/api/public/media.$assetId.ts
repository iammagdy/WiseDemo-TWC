import { createFileRoute } from "@tanstack/react-router";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/media/$assetId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!uuidPattern.test(params.assetId))
          return new Response("Media not found.", { status: 404 });
        try {
          const { appwriteWorkspace } = await import("@/integrations/appwrite/repository.server");
          const asset = await appwriteWorkspace().getDirectorArtifact(params.assetId);
          const source =
            asset?.artifact_kind === "media-asset" &&
            typeof asset.payload_json === "object" &&
            asset.payload_json !== null &&
            !Array.isArray(asset.payload_json) &&
            typeof asset.payload_json.source === "object" &&
            asset.payload_json.source !== null &&
            !Array.isArray(asset.payload_json.source) &&
            typeof asset.payload_json.source.fileId === "string"
              ? asset.payload_json.source.fileId
              : null;
          if (!source || !uuidPattern.test(source))
            return new Response("Media not found.", { status: 404 });
          const [{ appwriteServer }, { fetchAppwriteRecording }] = await Promise.all([
            import("@/integrations/appwrite/client.server"),
            import("@/integrations/appwrite/storage.server"),
          ]);
          const upstream = await fetchAppwriteRecording(appwriteServer().config, source, {
            range: request.headers.get("range"),
            signal: request.signal,
          });
          if (![200, 206, 416].includes(upstream.status)) {
            await upstream.body?.cancel().catch(() => undefined);
            return new Response("Media not found.", {
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
          return new Response(upstream.body, { status: upstream.status, headers });
        } catch {
          return new Response("Media unavailable.", { status: 503 });
        }
      },
    },
  },
});
