import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink, Film, KeyRound, Loader2, Map, Play, Save, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createDemoJob,
  getProjectWorkspace,
  saveProjectCredential,
  saveProjectMap,
} from "@/lib/studio.functions";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project Studio — DemoForge" },
      { name: "description", content: "Map a SaaS product, add secure access, and queue real browser demo recordings in DemoForge." },
      { property: "og:title", content: "Project Studio — DemoForge" },
      { property: "og:description", content: "Map a SaaS product, add secure access, and queue real browser demo recordings in DemoForge." },
    ],
  }),
  component: ProjectStudio,
});

type Workspace = Awaited<ReturnType<typeof getProjectWorkspace>>;
type Demo = Workspace["demos"][number];

function ProjectStudio() {
  const { projectId } = Route.useParams();
  const fetchWorkspace = useServerFn(getProjectWorkspace);
  const saveMap = useServerFn(saveProjectMap);
  const saveCredential = useServerFn(saveProjectCredential);
  const createDemo = useServerFn(createDemoJob);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapText, setMapText] = useState("");
  const [description, setDescription] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [demoTitle, setDemoTitle] = useState("");
  const [featurePrompt, setFeaturePrompt] = useState("");
  const [busyAction, setBusyAction] = useState<"map" | "creds" | "demo" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWorkspace({ data: { projectId } });
      setWorkspace(next);
      setMapText(next.project.site_map_md ?? starterMap(next.project.name, next.project.base_url));
      setDescription(next.project.description ?? "");
      setLoginUrl(next.credentials?.login_url ?? `${next.project.base_url}/login`);
      setUsername(next.credentials?.username_hint ?? "");
      if (!demoTitle) setDemoTitle(`${next.project.name} product demo`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load this project.");
    } finally {
      setLoading(false);
    }
  }, [demoTitle, fetchWorkspace, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const project = workspace?.project;
  const status = useMemo(() => {
    if (!workspace) return [];
    return [
      { label: "Map", done: Boolean(workspace.project.site_map_md) },
      { label: "Access", done: workspace.credentials?.kind === "password" },
      { label: "Demos", done: workspace.demos.length > 0 },
    ];
  }, [workspace]);

  async function handleSaveMap() {
    setBusyAction("map");
    setNotice(null);
    setError(null);
    try {
      const saved = await saveMap({ data: { projectId, description, siteMapMd: mapText } });
      setWorkspace((current) => (current ? { ...current, project: saved } : current));
      setNotice("Product map saved.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save the product map.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveCredentials() {
    setBusyAction("creds");
    setNotice(null);
    setError(null);
    try {
      const saved = await saveCredential({ data: { projectId, kind: "password", loginUrl, username, secret } });
      setWorkspace((current) => (current ? { ...current, credentials: saved } : current));
      setSecret("");
      setNotice("Access saved.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save access.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateDemo() {
    setBusyAction("demo");
    setNotice(null);
    setError(null);
    try {
      const demo = await createDemo({ data: { projectId, title: demoTitle, featurePrompt } });
      setWorkspace((current) => (current ? { ...current, demos: [demo, ...current.demos] } : current));
      setFeaturePrompt("");
      setNotice("Demo queued.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not queue the demo.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard">
              <ArrowLeft />
              Productions
            </Link>
          </Button>
          {project && (
            <Button variant="outline" size="sm" asChild>
              <a href={project.base_url} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open site
              </a>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 animate-spin" /> Loading project…
          </div>
        ) : error && !workspace ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive-foreground">
            {error}
          </div>
        ) : project && workspace ? (
          <>
            <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
              <div>
                <p className="font-mono-tight text-xs uppercase text-primary">/// Project reel</p>
                <h1 className="mt-2 text-3xl font-semibold md:text-5xl">{project.name}</h1>
                <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">{project.base_url}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-2">
                {status.map((item) => (
                  <div key={item.label} className="rounded-md bg-background px-3 py-2 text-center">
                    <div className={item.done ? "text-primary" : "text-muted-foreground"}>{item.done ? "Ready" : "Open"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
            </section>

            {(error || notice) && (
              <div className="mt-6 rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <span className={error ? "text-destructive-foreground" : "text-primary"}>{error ?? notice}</span>
              </div>
            )}

            <section className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                    <Map className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-semibold">Product map</h2>
                    <p className="text-sm text-muted-foreground">The agent uses this to choose the real pages and clicks.</p>
                  </div>
                </div>
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Short product description"
                  className="mt-5 bg-background"
                />
                <Textarea
                  value={mapText}
                  onChange={(event) => setMapText(event.target.value)}
                  className="mt-3 min-h-64 bg-background font-mono text-xs leading-relaxed"
                  placeholder="# Product map"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={handleSaveMap} disabled={busyAction === "map"}>
                    {busyAction === "map" ? <Loader2 className="animate-spin" /> : <Save />}
                    Save map
                  </Button>
                  <Button variant="outline" onClick={() => setMapText(starterMap(project.name, project.base_url))}>
                    <Sparkles />
                    Starter map
                  </Button>
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="font-semibold">Access</h2>
                      <p className="text-sm text-muted-foreground">
                        {workspace.credentials?.kind === "password" ? `Saved for ${workspace.credentials.username_hint}` : "Add access when the demo needs sign-in."}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    <Input value={loginUrl} onChange={(event) => setLoginUrl(event.target.value)} placeholder="Login URL" className="bg-background" />
                    <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Email or username" className="bg-background" />
                    <Input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Password or access code" type="password" className="bg-background" />
                    <Button onClick={handleSaveCredentials} disabled={busyAction === "creds"}>
                      {busyAction === "creds" ? <Loader2 className="animate-spin" /> : <Save />}
                      Save access
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                      <Film className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="font-semibold">Demo brief</h2>
                      <p className="text-sm text-muted-foreground">Queue a real-browser run for a video up to 69 seconds.</p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    <Input value={demoTitle} onChange={(event) => setDemoTitle(event.target.value)} placeholder="Demo title" className="bg-background" />
                    <Textarea
                      value={featurePrompt}
                      onChange={(event) => setFeaturePrompt(event.target.value)}
                      placeholder="Show how a founder creates a campaign, reviews the result, and exports it for social media."
                      className="min-h-32 bg-background"
                    />
                    <Button onClick={handleCreateDemo} disabled={busyAction === "demo"}>
                      {busyAction === "demo" ? <Loader2 className="animate-spin" /> : <Play />}
                      Queue demo
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-8">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-xl font-semibold">Demo queue</h2>
                <span className="text-sm text-muted-foreground">{workspace.demos.length} total</span>
              </div>
              {workspace.demos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
                  No demos queued yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {workspace.demos.map((demo) => (
                    <DemoRow key={demo.id} demo={demo} />
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function DemoRow({ demo }: { demo: Demo }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-sm border border-border px-2 py-0.5 font-mono-tight text-xs uppercase text-muted-foreground">
              {demo.status}
            </span>
            <span className="text-sm text-muted-foreground">{demo.progress_pct}%</span>
          </div>
          <h3 className="mt-2 font-semibold">{demo.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{demo.feature_prompt}</p>
        </div>
        <div className="text-sm text-muted-foreground">{demo.current_step ?? "Queued"}</div>
      </div>
    </article>
  );
}

function starterMap(name: string, baseUrl: string) {
  return `# ${name} product map

Base URL: ${baseUrl}

## Pages
- Home / dashboard
- Sign in
- Main product workspace
- Feature result or export page

## Primary demo flow
1. Open the product and establish the problem.
2. Sign in if needed.
3. Navigate to the feature that should be demonstrated.
4. Perform the real clicks a founder would take.
5. Show the final outcome clearly.

## Notes for the filming agent
- Keep the final edit under 69 seconds.
- Avoid fake data unless it already exists in the product.
- Prefer the most visual proof screen as the ending shot.
`;
}