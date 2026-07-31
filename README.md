# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS


## WiseDemo (this app)

Agentic demo-video studio: point it at a SaaS URL, it scans the site, plans a
shot list with AI, drives a real cloud browser (Steel.dev) through the product,
records it, and returns an MP4 you can share.

### No authentication (experimental)

Login was removed on purpose. Every visitor works in one **shared, public
workspace**. All database access happens server-side with the service-role key;
browser clients have no direct database access. Do not put real production
credentials in a publicly deployed instance.

### Routes

- `/` — landing page
- `/dashboard` — project list + create project
- `/projects/:projectId` — project studio (product map, access, demo brief, player)
- `/mcp` — open MCP server for AI agents (`list_projects`, `get_project`, `list_demos`, `update_project_map`)
- `/api/public/*` — public HTTP endpoints

### Key server modules

- `src/lib/studio.functions.ts` — server functions (projects, credentials, demo jobs, orchestration)
- `src/lib/studio-scanner.server.ts` — site scan / site-map builder
- `src/lib/steel-recon.server.ts` — agentic login + DOM recon pass
- `src/lib/scene-planner.server.ts` — AI shot-list planner
- `src/lib/steel-recorder.server.ts` — CDP driver + recording retrieval
- `src/lib/mcp/*` — MCP server and tools

### Local development

```sh
cp .env.example .env   # fill in the values
npm i
npm run dev            # http://localhost:8080
```

### Deploying to Vercel

The build uses Nitro (Cloudflare Workers preset by default). For Vercel, set the
Nitro preset to `vercel` in `vite.config.ts`:

```ts
export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  nitro: { preset: "vercel" },
  vite: { plugins: [mcpPlugin()] },
});
```

Then add every variable from `.env.example` in Vercel → Project → Settings →
Environment Variables and deploy. Note: the recording pipeline needs long-lived
requests — if a run times out on serverless, move `runDemoScenes` to a queue or
a long-running worker.
