import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Download, ExternalLink, Film, KeyRound, Loader2, Map, Play, RefreshCw, Save, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createDemoJob,
  finalizeDemoRecording,
  getDemoStatus,
  getProjectWorkspace,
  runDemoScenes,
  scanProjectSite,
  saveProjectCredential,
  saveProjectMap,
} from "@/lib/studio.functions";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project Studio — DemoForge" },
      { name: "description", content: "Map a SaaS product, add secure access, and queue real browser demo recordings in DemoForge." },
      { property: "og:title", content: "Project Studio — DemoForge" },
      { property: "og:description", content: "Map a SaaS product, add secure access, and queue real browser demo recordings in DemoForge." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
  const scanSite = useServerFn(scanProjectSite);
  const runScenes = useServerFn(runDemoScenes);
  const finalizeRecording = useServerFn(finalizeDemoRecording);
  const fetchDemoStatus = useServerFn(getDemoStatus);

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
  const [busyAction, setBusyAction] = useState<"map" | "creds" | "demo" | "scan" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollingRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWorkspace({ data: { projectId } });
      setWorkspace(next);
      setMapText(next.project.site_map_md ?? starterMap(next.project.name, next.project.base_url));
      setDescription(next.project.description ?? "");
      setLoginUrl(next.credentials?.login_url ?? detectLoginUrlFromMap(next.project.site_map_md) ?? "");
      setUsername(next.credentials?.username_hint ?? "");
      if (!demoTitle) setDemoTitle(`${next.project.name} product demo`);
      if (!featurePrompt) setFeaturePrompt(defaultFeaturePrompt(next.project.name));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load this project.");
    } finally {
      setLoading(false);
    }
  }, [demoTitle, featurePrompt, fetchWorkspace, projectId]);

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

  async function handleScanSite() {
    setBusyAction("scan");
    setNotice(null);
    setError(null);
    try {
      const scanned = await scanSite({ data: { projectId } });
      setWorkspace((current) => (current ? { ...current, project: scanned } : current));
      setMapText(scanned.site_map_md ?? "");
      setDescription(scanned.description ?? "");
      if (!workspace?.credentials?.login_url) setLoginUrl(detectLoginUrlFromMap(scanned.site_map_md) ?? "");
      setNotice("Real site scanned and product map updated.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not scan this site.");
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
    if (featurePrompt.trim().length < 10) {
      setError("Describe the feature in at least 10 characters.");
      return;
    }
    setBusyAction("demo");
    setNotice(null);
    setError(null);
    try {
      const demo = await createDemo({ data: { projectId, title: demoTitle, featurePrompt } });
      setWorkspace((current) => (current ? { ...current, demos: [demo, ...current.demos] } : current));
      setNotice("Real cloud browser launched. Watch it drive your site live below.");
      // Kick off scene execution in the background, then poll
      void runScenes({ data: { demoId: demo.id } })
        .then((result) => {
          setWorkspace((current) => {
            if (!current) return current;
            return {
              ...current,
              demos: current.demos.map((d) =>
                d.id === demo.id ? { ...d, ...result } : d,
              ),
            };
          });
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Recording finished with an error.");
        });
      startPolling(demo.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not queue the demo.");
    } finally {
      setBusyAction(null);
    }
  }

  const startPolling = useCallback(
    (demoId: string) => {
      if (pollingRef.current.has(demoId)) return;
      pollingRef.current.add(demoId);
      const tick = async () => {
        try {
          const status = await fetchDemoStatus({ data: { demoId } });
          setWorkspace((current) => {
            if (!current) return current;
            return {
              ...current,
              demos: current.demos.map((d) =>
                d.id === demoId ? { ...d, ...status } : d,
              ),
            };
          });
          if (status.status === "ready" || status.status === "failed") {
            pollingRef.current.delete(demoId);
            return;
          }
          if (status.status === "rendering") {
            const finalized = await finalizeRecording({ data: { demoId } });
            setWorkspace((current) => {
              if (!current) return current;
              return {
                ...current,
                demos: current.demos.map((d) => (d.id === demoId ? { ...d, ...finalized } : d)),
              };
            });
            if (finalized?.status === "ready") {
              pollingRef.current.delete(demoId);
              return;
            }
          }
        } catch {
          /* ignore transient errors */
        }
        setTimeout(tick, 3000);
      };
      setTimeout(tick, 2500);
    },
    [fetchDemoStatus, finalizeRecording],
  );

  // Resume polling for any in-flight demos when workspace loads
  useEffect(() => {
    if (!workspace) return;
    for (const demo of workspace.demos) {
      if (demo.status === "starting" || demo.status === "recording" || demo.status === "rendering") {
        startPolling(demo.id);
      }
    }
  }, [startPolling, workspace]);

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
              <div className="min-w-0">
                <p className="font-mono-tight text-xs uppercase text-primary">/// Project reel</p>
                <h1 className="mt-2 break-words text-2xl font-semibold sm:text-3xl md:text-5xl">{project.name}</h1>
                <p className="mt-3 max-w-2xl break-all text-sm text-muted-foreground md:text-base">{project.base_url}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-2">
                {status.map((item) => (
                  <div key={item.label} className="rounded-md bg-background px-2 py-2 text-center text-sm sm:px-3">
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
                  <Button variant="outline" onClick={handleScanSite} disabled={busyAction === "scan"}>
                    {busyAction === "scan" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Scan real site
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
                    <Input value={loginUrl} onChange={(event) => setLoginUrl(event.target.value)} placeholder="Login URL, if the demo needs sign-in" className="bg-background" />
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
                      Create + render demo
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
  const videoUrl = demo.mp4_url ?? demo.recording_url ?? null;
  const isLive = demo.status === "starting" || demo.status === "recording";
  const isReady = demo.status === "ready" && Boolean(videoUrl);
  const liveUrl = isLive ? (demo.live_view_url ?? demo.session_viewer_url) : null;
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-[1fr_360px] md:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-sm border border-border px-2 py-0.5 font-mono-tight text-xs uppercase text-muted-foreground">
              {demo.status}
            </span>
            <span className="text-sm text-muted-foreground">{demo.progress_pct}%</span>
            {isLive ? (
              <span className="flex items-center gap-1.5 rounded-sm bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                LIVE
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 break-words font-semibold">{demo.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{demo.feature_prompt}</p>
          <div className="mt-2 text-sm text-muted-foreground">{demo.current_step ?? "Queued"}</div>
          {demo.error_message ? (
            <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {demo.error_message}
            </div>
          ) : null}
          {(liveUrl ?? demo.session_viewer_url) ? (
            <a
              href={(liveUrl ?? demo.session_viewer_url) as string}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {isLive ? "Open live session in new tab" : "Open session replay"}
            </a>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          {isReady && videoUrl ? (
            <>
              <video
                src={videoUrl}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full rounded-md border border-border bg-black"
              />
              <Button asChild variant="outline" size="sm">
                <a href={videoUrl} download={`${demo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp4`}>
                  <Download />
                  Download MP4
                  {demo.duration_seconds ? ` (${demo.duration_seconds}s)` : ""}
                </a>
              </Button>
            </>
          ) : liveUrl ? (
            <iframe
              src={liveUrl}
              title={demo.title}
              className="aspect-video w-full rounded-md border border-border bg-background"
              allow="clipboard-read; clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              {demo.status === "rendering" || isLive ? <Loader2 className="h-6 w-6 animate-spin" /> : <Film className="h-7 w-7" />}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function detectLoginUrlFromMap(siteMapMd: string | null) {
  const match = siteMapMd?.match(/Detected login page:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.replace(/[).,]+$/, "") ?? null;
}

function starterMap(name: string, baseUrl: string) {
  return `# ${name} — product map\n\nBase URL: ${baseUrl}\n\n## Real pages discovered\n- ${baseUrl}\n\n## Important visible sections\n- Hero\n- Product value\n- Call to action\n\n## Clicks and calls to action to film\n- Scroll the landing page\n- Highlight primary CTA\n- End on value proof\n`;
}

function defaultFeaturePrompt(name: string) {
  return `Show how a new user experiences ${name}: land on the site, scroll the value props, and end on the main call to action.`;
}
