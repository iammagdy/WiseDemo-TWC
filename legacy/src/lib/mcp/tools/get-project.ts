import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { appwriteWorkspace } from "../appwrite";

export default defineTool({
  name: "get_project",
  title: "Get project details",
  description:
    "Get one WiseDemo project including its AI-generated product/site map markdown and its recorded demos.",
  inputSchema: { project_id: z.string().uuid().describe("The project id from list_projects.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id }) => {
    const repository = appwriteWorkspace();
    const project = await repository.getProject(project_id);
    if (!project) return { content: [{ type: "text", text: "Project not found." }], isError: true };

    const demos = (await repository.listDemos(project_id)).map((demo) => ({
      id: demo.id,
      title: demo.title,
      status: demo.status,
      progress_pct: demo.progress_pct,
      current_step: demo.current_step,
      duration_seconds: demo.duration_seconds,
      recording_url: demo.recording_url,
      created_at: demo.created_at,
    }));

    const payload = { project, demos };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
