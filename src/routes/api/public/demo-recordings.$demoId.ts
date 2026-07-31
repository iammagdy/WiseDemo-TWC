import { createFileRoute } from "@tanstack/react-router";

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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: demo, error } = await supabaseAdmin
          .from("demos")
          .select("title, status, recording_object_path")
          .eq("id", demoId)
          .maybeSingle();

        if (error) {
          console.error("[WiseDemo] recording URL lookup failed", {
            demoId,
            code: error.code,
          });
          return new Response("Could not load the recording.", { status: 503 });
        }
        if (demo?.status !== "ready" || !demo.recording_object_path) {
          return new Response("Recording not found.", { status: 404 });
        }

        const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
        const signed = await supabaseAdmin.storage
          .from("demo-recordings")
          .createSignedUrl(
            demo.recording_object_path,
            5 * 60,
            wantsDownload ? { download: safeRecordingFilename(demo.title) } : undefined,
          );
        if (signed.error || !signed.data?.signedUrl) {
          console.error("[WiseDemo] recording signing failed", {
            demoId,
            code: signed.error?.name ?? "SIGNED_URL_MISSING",
          });
          return new Response("Could not sign the recording URL.", { status: 503 });
        }

        return new Response(null, {
          status: 302,
          headers: {
            location: signed.data.signedUrl,
            "cache-control": "private, no-store",
            "referrer-policy": "no-referrer",
          },
        });
      },
    },
  },
});
