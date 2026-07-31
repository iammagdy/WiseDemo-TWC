import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseWorkspace } from "../supabase";

export default defineTool({
  name: "list_demos",
  title: "List demo videos",
  description:
    "List the demo recordings with status, progress and playback URLs. Optionally filter by project.",
  inputSchema: {
    project_id: z.string().uuid().optional().describe("Only return demos for this project."),
    status: z
      .string()
      .optional()
      .describe("Only return demos in this status, e.g. queued, recording, ready, failed."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id, status }) => {
    const supabase = supabaseWorkspace();
    let query = supabase
      .from("demos")
      .select(
        "id, project_id, title, feature_prompt, status, progress_pct, current_step, duration_seconds, recording_url, live_view_url, error_message, created_at",
      )
      .order("created_at", { ascending: false });
    if (project_id) query = query.eq("project_id", project_id);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { demos: data ?? [] },
    };
  },
});