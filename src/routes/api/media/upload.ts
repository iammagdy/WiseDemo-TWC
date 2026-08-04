import { createFileRoute } from "@tanstack/react-router";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveNumber(value: FormDataEntryValue | null, maximum: number): number | null {
  if (typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum ? number : null;
}

export const Route = createFileRoute("/api/media/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const projectId = requestUrl.searchParams.get("projectId") ?? "";
        if (!uuidPattern.test(projectId))
          return new Response("Project not found.", { status: 404 });
        const length = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES + 100_000) {
          return new Response("The upload is larger than 500 MB.", { status: 413 });
        }
        try {
          const form = await request.formData();
          const file = form.get("file");
          const durationSeconds = positiveNumber(form.get("durationSeconds"), 60 * 60);
          const width = positiveNumber(form.get("width"), 7680);
          const height = positiveNumber(form.get("height"), 7680);
          if (!(file instanceof File) || !durationSeconds || !width || !height) {
            return new Response("Upload valid MP4 video metadata.", { status: 400 });
          }
          if (file.size < 1_024 || file.size > MAX_UPLOAD_BYTES) {
            return new Response("The upload must be between 1 KB and 500 MB.", { status: 413 });
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (
            bytes.byteLength < 12 ||
            new TextDecoder().decode(bytes.slice(4, 12)).indexOf("ftyp") !== 0
          ) {
            return new Response("Only a valid MP4 video can be uploaded.", { status: 415 });
          }
          const [{ appwriteWorkspace }, { appwriteRecordingStorage }] = await Promise.all([
            import("@/integrations/appwrite/repository.server"),
            import("@/integrations/appwrite/storage.server"),
          ]);
          const repository = appwriteWorkspace();
          const project = await repository.getProject(projectId);
          if (!project) return new Response("Project not found.", { status: 404 });
          const fileId = crypto.randomUUID();
          await appwriteRecordingStorage().upsertRecording(fileId, bytes);
          const asset = await repository.createDirectorArtifact({
            project_id: project.id,
            demo_id: null,
            artifact_kind: "media-asset",
            cache_key: `upload:${fileId.slice(0, 8)}`,
            status: "ready",
            payload_json: {
              source: {
                kind: "uploaded",
                fileId,
                durationSeconds,
                width: Math.round(width),
                height: Math.round(height),
              },
            },
            expires_at: null,
            provider: "user-upload",
            model: null,
            duration_ms: null,
            revision: 1,
            failure_reason: null,
          });
          return Response.json({ assetId: asset.id });
        } catch (error) {
          console.error("[WiseDemo] upload failed", {
            category: error instanceof Error ? error.name : "unknown",
          });
          return new Response("The video could not be stored.", { status: 503 });
        }
      },
    },
  },
});
