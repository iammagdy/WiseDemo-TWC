import { auth, defineMcp } from "@lovable.dev/mcp-js";

import getProjectTool from "./tools/get-project";
import listDemosTool from "./tools/list-demos";
import listProjectsTool from "./tools/list-projects";
import updateProjectMapTool from "./tools/update-project-map";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "founder-s-demo-genie",
  title: "Founder's Demo Genie",
  version: "0.1.0",
  instructions:
    "Tools for Founder's Demo Genie, a studio that records real product demo videos of a SaaS. Use `list_projects` to find a product, `get_project` for its product map and demos, `list_demos` to check recording status and playback URLs, and `update_project_map` to improve the product map used for demo scripting.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjectsTool, getProjectTool, listDemosTool, updateProjectMapTool],
});