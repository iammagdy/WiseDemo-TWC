import { defineTool } from "@lovable.dev/mcp-js";
import { appwriteWorkspace } from "../appwrite";

export default defineTool({
  name: "list_projects",
  title: "List demo projects",
  description: "List the WiseDemo projects (name, website URL, description, last scan time).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const data = (await appwriteWorkspace().listProjects()).map((project) => ({
      id: project.id,
      name: project.name,
      base_url: project.base_url,
      description: project.description,
      site_map_updated_at: project.site_map_updated_at,
      created_at: project.created_at,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { projects: data },
    };
  },
});
