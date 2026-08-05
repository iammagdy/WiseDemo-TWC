import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { appwriteWorkspace } from "../appwrite";

export default defineTool({
  name: "update_project_map",
  title: "Update project product map",
  description:
    "Replace a project's product/site map markdown (and optionally its description) so demo scripts use better context.",
  inputSchema: {
    project_id: z.string().uuid().describe("The project id from list_projects."),
    site_map_md: z.string().describe("Markdown product map: pages, features, flows, auth notes."),
    description: z.string().optional().describe("Short product description."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ project_id, site_map_md, description }) => {
    const map = site_map_md.trim();
    if (map.length < 10) {
      return { content: [{ type: "text", text: "site_map_md is too short." }], isError: true };
    }
    const repository = appwriteWorkspace();
    const existing = await repository.getProject(project_id);
    if (!existing)
      return { content: [{ type: "text", text: "Project not found." }], isError: true };
    const data = await repository.updateProject(project_id, {
      site_map_md: map,
      site_map_source: "manual",
      site_map_updated_at: new Date().toISOString(),
      ...(description ? { description: description.trim() } : {}),
    });
    return {
      content: [{ type: "text", text: `Updated product map for ${data.name}.` }],
      structuredContent: { project: data },
    };
  },
});
