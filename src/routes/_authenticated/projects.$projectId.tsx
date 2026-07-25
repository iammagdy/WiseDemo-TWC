import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Download, ExternalLink, Film, KeyRound, Loader2, Map, Play, RefreshCw, Save, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createDemoJob,
  getProjectWorkspace,
  scanProjectSite,
  saveProjectCredential,
  saveProjectMap,
} from "@/lib/studio.functions";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
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
  const [renderingDemoId, setRenderingDemoId] = useState<string | null>(null);
  const [renderedVideos, setRenderedVideos] = useState<Record<string, string>>({});
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
      setNotice("Demo script created. Rendering real browser-capture video…");
      await handleRenderDemo(demo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not queue the demo.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRenderDemo(demo: Demo) {
    if (!workspace?.project) return;
    setRenderingDemoId(demo.id);
    setNotice(null);
    setError(null);
    try {
      const videoUrl = await renderDemoVideo({ project: workspace.project, demo });
      setRenderedVideos((current) => ({ ...current, [demo.id]: videoUrl }));
      setNotice("Real demo video rendered. Download it from the demo queue.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not render the browser-capture video.");
    } finally {
      setRenderingDemoId(null);
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
                    <DemoRow
                      key={demo.id}
                      demo={demo}
                      videoUrl={renderedVideos[demo.id]}
                      isRendering={renderingDemoId === demo.id}
                      onRender={() => handleRenderDemo(demo)}
                    />
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

function DemoRow({
  demo,
  videoUrl,
  isRendering,
  onRender,
}: {
  demo: Demo;
  videoUrl?: string;
  isRendering: boolean;
  onRender: () => void;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-sm border border-border px-2 py-0.5 font-mono-tight text-xs uppercase text-muted-foreground">
              {demo.status}
            </span>
            <span className="text-sm text-muted-foreground">{demo.progress_pct}%</span>
          </div>
          <h3 className="mt-2 font-semibold">{demo.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{demo.feature_prompt}</p>
          <div className="mt-2 text-sm text-muted-foreground">{demo.current_step ?? "Queued"}</div>
        </div>
        <div className="flex flex-col gap-2">
          {demo.thumbnail_url && (
            <img
              src={demo.thumbnail_url}
              alt={`${demo.title} captured website frame`}
              className="aspect-video w-full rounded-md border border-border object-cover"
              loading="lazy"
            />
          )}
          {videoUrl ? (
            <Button asChild>
              <a href={videoUrl} download={`${demo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-demoforge.webm`}>
                <Download />
                Download video
              </a>
            </Button>
          ) : (
            <Button variant="outline" onClick={onRender} disabled={isRendering}>
              {isRendering ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {isRendering ? "Rendering…" : "Render video"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

async function renderDemoVideo({ project, demo }: { project: Workspace["project"]; demo: Demo }) {
  if (typeof window === "undefined") throw new Error("Video rendering only runs in the browser.");
  if (typeof MediaRecorder === "undefined") throw new Error("Your browser does not support video rendering here.");

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not start the video renderer.");

  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const screenshot = await loadImage(`/api/public/screenshot?url=${encodeURIComponent(project.base_url)}&width=1280`);
  const script = Array.isArray(demo.scene_script) ? demo.scene_script : [];
  const beats = [
    { text: project.name, subtext: project.description ?? project.base_url, duration: 2600 },
    { text: demo.title, subtext: demo.feature_prompt, duration: 4200 },
    ...script.slice(0, 3).map((item) => ({
      text: typeof item === "object" && item && "shot" in item ? String(item.shot) : "Real product moment",
      subtext: project.base_url,
      duration: 4200,
    })),
    { text: "Ready to share", subtext: "Recorded from the real website URL", duration: 3000 },
  ];

  const done = new Promise<string>((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      resolve(URL.createObjectURL(blob));
    };
  });

  recorder.start();
  for (const beat of beats) {
    await animateBeat(ctx, screenshot, beat.text, beat.subtext, beat.duration);
  }
  recorder.stop();
  return done;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the real website capture."));
    image.src = src;
  });
}

async function animateBeat(ctx: CanvasRenderingContext2D, image: HTMLImageElement, text: string, subtext: string, duration: number) {
  const start = performance.now();
  const end = start + duration;

  while (performance.now() < end) {
    const now = performance.now();
    const progress = Math.min(1, (now - start) / duration);
    const eased = easeInOut(progress);
    drawFrame(ctx, image, text, subtext, eased);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function drawFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement, text: string, subtext: string, progress: number) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  const zoom = 1.02 + progress * 0.08;
  const imageWidth = width * zoom;
  const imageHeight = height * zoom;
  ctx.globalAlpha = 0.78;
  ctx.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
  ctx.globalAlpha = 1;

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(10,10,10,0.18)");
  gradient.addColorStop(0.58, "rgba(10,10,10,0.18)");
  gradient.addColorStop(1, "rgba(10,10,10,0.92)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cursorX = 220 + progress * 820;
  const cursorY = 230 + Math.sin(progress * Math.PI) * 180;
  ctx.fillStyle = "#ff5a1f";
  ctx.beginPath();
  ctx.arc(cursorX, cursorY, 18 + Math.sin(progress * Math.PI * 4) * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = "#ff5a1f";
  ctx.fillRect(72, 70, 86, 6);
  ctx.fillStyle = "#f5f5f5";
  ctx.font = "700 44px Inter, Arial, sans-serif";
  wrapText(ctx, text, 72, 560, 860, 50, 2);
  ctx.fillStyle = "rgba(245,245,245,0.72)";
  ctx.font = "500 24px Inter, Arial, sans-serif";
  wrapText(ctx, subtext, 72, 622, 900, 31, 2);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let lines = 0;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = word;
      lines += 1;
      if (lines >= maxLines) return;
    } else {
      line = testLine;
    }
  }

  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
}

function easeInOut(value: number) {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function defaultFeaturePrompt(name: string) {
  return `Show the main ${name} product experience from the homepage, including the clearest call to action and final value screen.`;
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