import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseWorkspace } from "../supabase";

export default defineTool({
  name: "list_projects",
  title: "List demo projects",
  description: "List the WiseDemo projects (name, website URL, description, last scan time).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const supabase = supabaseWorkspace();
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, base_url, description, site_map_updated_at, created_at")
      .order("created_at", { ascending: false });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { projects: data ?? [] },
    };
  },
});