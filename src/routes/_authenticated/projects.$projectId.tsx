import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink, Film, KeyRound, Loader2, Map, Play, RefreshCw, Save, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createDemoJob,
  getDemoStatus,
  getProjectWorkspace,
  runDemoScenes,
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
  const runScenes = useServerFn(runDemoScenes);
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
        } catch {
          /* ignore transient errors */
        }
        setTimeout(tick, 3000);
      };
      setTimeout(tick, 2500);
    },
    [fetchDemoStatus],
  );

  // Resume polling for any in-flight demos when workspace loads
  useEffect(() => {
    if (!workspace) return;
    for (const demo of workspace.demos) {
      if (demo.status === "starting" || demo.status === "recording") {
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

function DemoRow({
  demo,
  renderedVideo,
  isRendering,
  onRender,
}: {
  demo: Demo;
  renderedVideo?: RenderedVideo;
  isRendering: boolean;
  onRender: () => void;
}) {
  return (
      <article className="rounded-lg border border-border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-[1fr_280px] md:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-sm border border-border px-2 py-0.5 font-mono-tight text-xs uppercase text-muted-foreground">
              {demo.status}
            </span>
            <span className="text-sm text-muted-foreground">{demo.progress_pct}%</span>
          </div>
          <h3 className="mt-2 break-words font-semibold">{demo.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{demo.feature_prompt}</p>
          <div className="mt-2 text-sm text-muted-foreground">{demo.current_step ?? "Queued"}</div>
        </div>
        <div className="flex flex-col gap-2">
          {renderedVideo ? (
            <video
              src={renderedVideo.url}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-md border border-border bg-background object-cover"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              {isRendering ? <Loader2 className="animate-spin" /> : <Film className="h-7 w-7" />}
            </div>
          )}
          {renderedVideo ? (
            <Button onClick={() => downloadVideo(renderedVideo, demo.title)}>
              <Download />
              Download video
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
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const screenshot = await loadImage(`/api/public/screenshot?url=${encodeURIComponent(project.base_url)}&width=1280`).catch(() => null);
  const pageModel = buildPageModel(project.name, project.base_url, project.description, project.site_map_md);
  const scriptItems: unknown[] = Array.isArray(demo.scene_script) ? demo.scene_script : [];
  const beats = [
    { text: project.name, subtext: project.description ?? project.base_url, duration: 2800, motion: "intro" as const },
    { text: demo.title, subtext: demo.feature_prompt, duration: 4200, motion: "down" as const },
    ...scriptItems.slice(0, 3).map((item) => ({
      text: getSceneShot(item),
      subtext: project.base_url,
      duration: 4600,
      motion: sceneMotion(getSceneShot(item)),
    })),
    { text: "Ready to share", subtext: "Recorded from the real website URL", duration: 3200, motion: "up" as const },
  ];

  const done = new Promise<RenderedVideo>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("The browser video recorder failed while encoding the demo."));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      if (blob.size < 10_000) {
        reject(new Error("The browser produced an empty video. Try rendering again."));
        return;
      }
      resolve({ url: URL.createObjectURL(blob), blob, mimeType: "video/webm" });
    };
  });

  drawFrame(ctx, screenshot, pageModel, beats[0].text, beats[0].subtext, 0, beats[0].motion);
  recorder.start(500);
  for (const beat of beats) {
    await animateBeat(ctx, screenshot, pageModel, beat.text, beat.subtext, beat.duration, beat.motion);
  }
  if (recorder.state === "recording") {
    recorder.requestData();
    recorder.stop();
  }
  return done;
}

function downloadVideo(video: RenderedVideo, title: string) {
  const fileName = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "demo"}-demoforge.webm`;
  const anchor = document.createElement("a");
  anchor.href = video.url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  if (!("download" in HTMLAnchorElement.prototype)) {
    window.open(video.url, "_blank", "noopener,noreferrer");
  }
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

function getSceneShot(item: unknown) {
  if (typeof item === "object" && item !== null && "shot" in item) {
    const shot = (item as { shot?: unknown }).shot;
    if (typeof shot === "string" && shot.trim().length > 0) return shot;
  }
  return "Real product moment";
}

type PageModel = {
  title: string;
  baseUrl: string;
  description: string;
  headings: string[];
  pages: string[];
  actions: string[];
};

type DemoMotion = "intro" | "down" | "up";

async function animateBeat(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  pageModel: PageModel,
  text: string,
  subtext: string,
  duration: number,
  motion: DemoMotion,
) {
  const start = performance.now();
  const end = start + duration;

  while (performance.now() < end) {
    const now = performance.now();
    const progress = Math.min(1, (now - start) / duration);
    const eased = easeInOut(progress);
    drawFrame(ctx, image, pageModel, text, subtext, eased, motion);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  pageModel: PageModel,
  text: string,
  subtext: string,
  progress: number,
  motion: DemoMotion,
) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.fillStyle = "#090706";
  ctx.fillRect(0, 0, width, height);

  drawBrowserChrome(ctx, 70, 52, width - 140, height - 118);
  const viewport = { x: 94, y: 108, width: width - 188, height: height - 196 };
  ctx.save();
  ctx.beginPath();
  ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.clip();

  const scroll = motion === "down" ? progress : motion === "up" ? 1 - progress : 0.12 + progress * 0.15;
  if (image) {
    drawCapturedPage(ctx, image, viewport, scroll);
  }
  drawScannedPage(ctx, pageModel, viewport, scroll, image ? 0.72 : 1);
  ctx.restore();
  ctx.globalAlpha = 1;

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(9,7,6,0.12)");
  gradient.addColorStop(0.55, "rgba(9,7,6,0.08)");
  gradient.addColorStop(1, "rgba(9,7,6,0.94)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cursorX = viewport.x + 130 + progress * (viewport.width - 260);
  const cursorY = viewport.y + 100 + Math.sin(progress * Math.PI) * (viewport.height - 210);
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

function drawBrowserChrome(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = "rgba(245,245,245,0.94)";
  roundRect(ctx, x, y, width, height, 22);
  ctx.fill();
  ctx.fillStyle = "rgba(16,14,12,0.92)";
  roundRect(ctx, x + 18, y + 16, width - 36, 38, 14);
  ctx.fill();
  ["#ff5a1f", "#f2b84b", "#2ac769"].forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 38 + index * 22, y + 35, 7, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawCapturedPage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  viewport: { x: number; y: number; width: number; height: number },
  scroll: number,
) {
  ctx.globalAlpha = 1;
  const coverScale = Math.max(viewport.width / image.naturalWidth, viewport.height / image.naturalHeight);
  const drawWidth = image.naturalWidth * coverScale;
  const drawHeight = image.naturalHeight * coverScale * 1.55;
  const y = viewport.y - Math.max(0, drawHeight - viewport.height) * scroll;
  ctx.drawImage(image, viewport.x - (drawWidth - viewport.width) / 2, y, drawWidth, drawHeight);
}

function drawScannedPage(
  ctx: CanvasRenderingContext2D,
  page: PageModel,
  viewport: { x: number; y: number; width: number; height: number },
  scroll: number,
  alpha: number,
) {
  const pageHeight = viewport.height * 2.25;
  const offsetY = -Math.max(0, pageHeight - viewport.height) * scroll;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#f7f2ec";
  ctx.fillRect(viewport.x, viewport.y + offsetY, viewport.width, pageHeight);

  ctx.fillStyle = "#15110f";
  ctx.font = "800 50px Inter, Arial, sans-serif";
  wrapText(ctx, page.title, viewport.x + 56, viewport.y + offsetY + 106, viewport.width - 360, 58, 2);
  ctx.fillStyle = "rgba(21,17,15,0.72)";
  ctx.font = "500 24px Inter, Arial, sans-serif";
  wrapText(ctx, page.description, viewport.x + 56, viewport.y + offsetY + 228, viewport.width - 420, 34, 3);
  ctx.fillStyle = "#ff5a1f";
  roundRect(ctx, viewport.x + 56, viewport.y + offsetY + 360, 190, 48, 10);
  ctx.fill();
  ctx.fillStyle = "#fffaf6";
  ctx.font = "800 18px Inter, Arial, sans-serif";
  ctx.fillText("Primary CTA", viewport.x + 90, viewport.y + offsetY + 391);

  const sections = [
    { title: "Pages discovered", items: page.pages },
    { title: "Visible sections", items: page.headings },
    { title: "Actions to film", items: page.actions },
  ];
  sections.forEach((section, sectionIndex) => {
    const sectionY = viewport.y + offsetY + 510 + sectionIndex * 330;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    roundRect(ctx, viewport.x + 44, sectionY, viewport.width - 88, 250, 18);
    ctx.fill();
    ctx.fillStyle = "#ff5a1f";
    ctx.font = "800 20px Inter, Arial, sans-serif";
    ctx.fillText(section.title, viewport.x + 82, sectionY + 48);
    ctx.fillStyle = "#211b17";
    ctx.font = "600 22px Inter, Arial, sans-serif";
    section.items.slice(0, 4).forEach((item, itemIndex) => {
      ctx.fillText(`• ${item}`, viewport.x + 82, sectionY + 92 + itemIndex * 38);
    });
  });
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function buildPageModel(title: string, baseUrl: string, description: string | null, siteMapMd: string | null): PageModel {
  const map = siteMapMd ?? "";
  return {
    title,
    baseUrl,
    description: description ?? `Public product experience captured from ${baseUrl}.`,
    headings: extractBulletsAfter(map, "Important visible sections", ["Hero section", "Product value", "Social proof", "Call to action"]),
    pages: extractBulletsAfter(map, "Real pages discovered", [baseUrl]),
    actions: extractBulletsAfter(map, "Clicks and calls to action to film", ["Scroll landing page", "Show primary CTA", "End on value proof"]),
  };
}

function extractBulletsAfter(markdown: string, heading: string, fallback: string[]) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start === -1) return fallback;
  const rest = markdown.slice(start + marker.length).split("\n## ")[0] ?? "";
  const items = rest
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.replace(/^https?:\/\//, "").slice(0, 72));
  return items.length > 0 ? items : fallback;
}

function detectLoginUrlFromMap(siteMapMd: string | null) {
  const match = siteMapMd?.match(/Detected login page:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.replace(/[).,]+$/, "") ?? null;
}

function sceneMotion(text: string): DemoMotion {
  return /back up|scroll back|close/i.test(text) ? "up" : "down";
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