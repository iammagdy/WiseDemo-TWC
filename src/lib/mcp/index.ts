import { defineMcp } from "@lovable.dev/mcp-js";

import getProjectTool from "./tools/get-project";
import listDemosTool from "./tools/list-demos";
import listProjectsTool from "./tools/list-projects";
import updateProjectMapTool from "./tools/update-project-map";

export default defineMcp({
  name: "wisedemo",
  title: "WiseDemo",
  version: "0.1.0",
  instructions:
    "Tools for WiseDemo, a studio that records real product demo videos of a SaaS. Use `list_projects` to find a product, `get_project` for its product map and demos, `list_demos` to check recording status and playback URLs, and `update_project_map` to improve the product map used for demo scripting.",
  // Authentication was removed for the experimental stage, so the MCP server
  // is open and serves the same shared workspace as the web app.
  tools: [listProjectsTool, getProjectTool, listDemosTool, updateProjectMapTool],
});
