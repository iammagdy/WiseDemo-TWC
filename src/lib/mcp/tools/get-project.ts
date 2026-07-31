import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseWorkspace } from "../supabase";

export default defineTool({
  name: "get_project",
  title: "Get project details",
  description:
    "Get one WiseDemo project including its AI-generated product/site map markdown and its recorded demos.",
  inputSchema: { project_id: z.string().uuid().describe("The project id from list_projects.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id }) => {
    const supabase = supabaseWorkspace();
    const { data: project, error } = await supabase
      .from("projects")
      .select("id, name, base_url, description, site_map_md, site_map_source, site_map_updated_at, created_at")
      .eq("id", project_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!project) return { content: [{ type: "text", text: "Project not found." }], isError: true };

    const { data: demos } = await supabase
      .from("demos")
      .select("id, title, status, progress_pct, current_step, duration_seconds, recording_url, created_at")
      .eq("project_id", project_id)
      .order("created_at", { ascending: false });

    const payload = { project, demos: demos ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});