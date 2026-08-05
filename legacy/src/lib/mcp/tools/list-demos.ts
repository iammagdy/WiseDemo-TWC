import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { appwriteWorkspace } from "../appwrite";

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
    const data = (await appwriteWorkspace().listDemos(project_id))
      .filter((demo) => !status || demo.status === status)
      .map((demo) => ({
        id: demo.id,
        project_id: demo.project_id,
        title: demo.title,
        feature_prompt: demo.feature_prompt,
        status: demo.status,
        progress_pct: demo.progress_pct,
        current_step: demo.current_step,
        duration_seconds: demo.duration_seconds,
        recording_url: demo.recording_url,
        live_view_url: demo.live_view_url,
        error_message: demo.error_message,
        created_at: demo.created_at,
      }));
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { demos: data },
    };
  },
});
