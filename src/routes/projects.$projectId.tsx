import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Download,
  ExternalLink,
  Film,
  KeyRound,
  Loader2,
  Map,
  Play,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GenericVideoStudio } from "@/components/video-studio/generic-video-studio";
import { autoComposeDirectedDemo } from "@/lib/composition.functions";
import {
  analyzePublicProduct,
  captureStoryboardDemo,
  captureDirectedDemo,
  createDirectedDemo,
  finalizeDemoRecording,
  getDemoStatus,
  getProjectWorkspace,
  retryDemoFinalization,
  runDemoScenes,
  scanProjectSite,
  saveProjectCredential,
  saveProjectMap,
} from "@/lib/studio.functions";
import { getDemoPlaybackState, safeRecordingFilename, stableRecordingUrl } from "@/lib/demo-state";
import type { RecordingLocale } from "@/lib/recording-locale";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project Studio — WiseDemo" },
      {
        name: "description",
        content:
          "Map a SaaS product, add secure access, and queue real browser demo recordings in WiseDemo.",
      },
      { property: "og:title", content: "Project Studio — WiseDemo" },
      {
        property: "og:description",
        content:
          "Map a SaaS product, add secure access, and queue real browser demo recordings in WiseDemo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GenericProjectStudio,
});

type Workspace = Awaited<ReturnType<typeof getProjectWorkspace>>;
type Demo = Workspace["demos"][number];

function GenericProjectStudio() {
  const { projectId } = Route.useParams();
  return <GenericVideoStudio projectId={projectId} />;
}

function ProjectStudio() {
  const { projectId } = Route.useParams();
  const fetchWorkspace = useServerFn(getProjectWorkspace);
  const saveMap = useServerFn(saveProjectMap);
  const saveCredential = useServerFn(saveProjectCredential);
  const createDemo = useServerFn(createDirectedDemo);
  const analyzeIntelligence = useServerFn(analyzePublicProduct);
  const captureDirected = useServerFn(captureDirectedDemo);
  const autoCompose = useServerFn(autoComposeDirectedDemo);
  const captureStoryboard = useServerFn(captureStoryboardDemo);
  const scanSite = useServerFn(scanProjectSite);
  const runScenes = useServerFn(runDemoScenes);
  const finalizeRecording = useServerFn(finalizeDemoRecording);
  const retryFinalization = useServerFn(retryDemoFinalization);
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
  const [recordingLocale, setRecordingLocale] = useState<RecordingLocale>("english");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "map" | "creds" | "demo" | "scan" | "intelligence" | "capture" | "directed-retry" | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollingRef = useRef<Set<string>>(new Set());
  const executionRef = useRef<Set<string>>(new Set());
  const compositionRef = useRef<Set<string>>(new Set());
  const directedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWorkspace({ data: { projectId } });
      setWorkspace(next);
      setMapText(next.project.site_map_md ?? starterMap(next.project.name, next.project.base_url));
      setDescription(next.project.description ?? "");
      setLoginUrl(
        next.credentials?.login_url ?? detectLoginUrlFromMap(next.project.site_map_md) ?? "",
      );
      // The browser receives only a masked hint; require the real identifier
      // again whenever access is replaced so a masked value is never encrypted.
      setUsername("");
      setDemoTitle((current) => current || `${next.project.name} product demo`);
      setFeaturePrompt((current) => current || defaultFeaturePrompt(next.project.name));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load this project.");
    } finally {
      setLoading(false);
    }
  }, [fetchWorkspace, projectId]);

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

  const ensureExecution = useCallback(
    (demoId: string) => {
      if (executionRef.current.has(demoId)) return;
      executionRef.current.add(demoId);
      void runScenes({ data: { demoId } })
        .then((result) => {
          setWorkspace((current) =>
            current
              ? {
                  ...current,
                  demos: current.demos.map((demo: Demo) =>
                    demo.id === demoId ? { ...demo, ...result } : demo,
                  ),
                }
              : current,
          );
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Recording execution failed.");
        })
        .finally(() => executionRef.current.delete(demoId));
    },
    [runScenes],
  );

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
      if (!workspace?.credentials?.login_url)
        setLoginUrl(detectLoginUrlFromMap(scanned.site_map_md) ?? "");
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
      const saved = await saveCredential({
        data: { projectId, kind: "password", loginUrl, username, secret },
      });
      setWorkspace((current) => (current ? { ...current, credentials: saved } : current));
      setUsername("");
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
      const directed = await createDemo({
        data: {
          projectId,
          title: demoTitle,
          featureBrief: featurePrompt,
          recordingLocale,
        },
      });
      directedRef.current.add(directed.demo.id);
      setWorkspace((current) =>
        current ? { ...current, demos: [directed.demo, ...current.demos] } : current,
      );
      setNotice(
        `Creative brief ready for ${directed.brief.selectedFeature.name}. Starting one-session capture automatically.`,
      );
      const captured = await captureDirected({ data: { demoId: directed.demo.id } });
      setWorkspace((current) =>
        current
          ? {
              ...current,
              demos: current.demos.map((demo: Demo) =>
                demo.id === captured.id ? { ...demo, ...captured } : demo,
              ),
            }
          : current,
      );
      startPolling(directed.demo.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not queue the demo.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRetryDirectedCapture(demoId: string) {
    setBusyAction("directed-retry");
    setNotice(null);
    setError(null);
    try {
      directedRef.current.add(demoId);
      const captured = await captureDirected({ data: { demoId, retryFailed: true } });
      setWorkspace((current) =>
        current
          ? {
              ...current,
              demos: current.demos.map((demo: Demo) =>
                demo.id === captured.id ? { ...demo, ...captured } : demo,
              ),
            }
          : current,
      );
      startPolling(demoId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not retry the directed capture.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAnalyzeIntelligence() {
    setBusyAction("intelligence");
    setNotice(null);
    setError(null);
    try {
      const result = await analyzeIntelligence({ data: { projectId, forceRefresh: false } });
      await load();
      setNotice(
        result.source === "context"
          ? "Public product intelligence is ready for automatic feature selection."
          : "Public product intelligence is incomplete; automatic capture will not start until Context.dev is available.",
      );
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Could not analyze product workflows.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCaptureStoryboard(demoId: string) {
    setBusyAction("capture");
    setError(null);
    setNotice(null);
    try {
      const updated = await captureStoryboard({ data: { demoId } });
      setWorkspace((current) =>
        current
          ? {
              ...current,
              demos: current.demos.map((demo: Demo) =>
                demo.id === demoId ? { ...demo, ...updated } : demo,
              ),
            }
          : current,
      );
      setNotice(
        "Scene capture started. WiseDemo will finalize the raw source, then you can compose the story cut.",
      );
      startPolling(demoId);
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "Could not start storyboard scene capture.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRetryFinalization(demoId: string) {
    setError(null);
    setNotice(null);
    try {
      const rendering = await retryFinalization({ data: { demoId } });
      setWorkspace((current) =>
        current
          ? {
              ...current,
              demos: current.demos.map((demo: Demo) =>
                demo.id === demoId ? { ...demo, ...rendering } : demo,
              ),
            }
          : current,
      );
      setNotice("Video finalization retry started.");
      startPolling(demoId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not retry video finalization.");
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
              demos: current.demos.map((d: Demo) => (d.id === demoId ? { ...d, ...status } : d)),
            };
          });
          if (status.status === "ready" || status.status === "failed") {
            if (status.status === "ready" && directedRef.current.has(demoId)) {
              if (!compositionRef.current.has(demoId)) {
                compositionRef.current.add(demoId);
                await autoCompose({ data: { projectId, demoId } }).catch(
                  (composeError: unknown) => {
                    setError(
                      composeError instanceof Error
                        ? composeError.message
                        : "Automatic composition could not start.",
                    );
                  },
                );
              }
            }
            pollingRef.current.delete(demoId);
            return;
          }
          if (
            ["pending", "starting", "scanning", "planning", "recording"].includes(status.status) &&
            !status.current_step?.includes("one-session")
          ) {
            ensureExecution(demoId);
          }
          if (status.status === "rendering") {
            const finalized = await finalizeRecording({ data: { demoId } });
            setWorkspace((current) => {
              if (!current) return current;
              return {
                ...current,
                demos: current.demos.map((d: Demo) =>
                  d.id === demoId ? { ...d, ...finalized } : d,
                ),
              };
            });
            if (finalized?.status === "ready") {
              if (directedRef.current.has(demoId) && !compositionRef.current.has(demoId)) {
                compositionRef.current.add(demoId);
                await autoCompose({ data: { projectId, demoId } }).catch(
                  (composeError: unknown) => {
                    setError(
                      composeError instanceof Error
                        ? composeError.message
                        : "Automatic composition could not start.",
                    );
                  },
                );
              }
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
    [autoCompose, ensureExecution, fetchDemoStatus, finalizeRecording, projectId],
  );

  // Resume both execution and polling for in-flight demos after a refresh.
  useEffect(() => {
    if (!workspace) return;
    for (const demo of workspace.demos) {
      if (
        ["pending", "starting", "scanning", "planning", "recording"].includes(demo.status) &&
        !demo.storyboard_id &&
        !demo.current_step?.includes("one-session")
      ) {
        ensureExecution(demo.id);
      }
      if (
        ["pending", "starting", "scanning", "planning", "recording", "rendering"].includes(
          demo.status,
        )
      ) {
        startPolling(demo.id);
      }
    }
  }, [ensureExecution, startPolling, workspace]);

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
                <h1 className="mt-2 break-words text-2xl font-semibold sm:text-3xl md:text-5xl">
                  {project.name}
                </h1>
                <p className="mt-3 max-w-2xl break-all text-sm text-muted-foreground md:text-base">
                  {project.base_url}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-2">
                {status.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-md bg-background px-2 py-2 text-center text-sm sm:px-3"
                  >
                    <div className={item.done ? "text-primary" : "text-muted-foreground"}>
                      {item.done ? "Ready" : "Open"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
            </section>

            {(error || notice) && (
              <div className="mt-6 rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <span className={error ? "text-destructive-foreground" : "text-primary"}>
                  {error ?? notice}
                </span>
              </div>
            )}

            <section className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-5 lg:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                        <BrainCircuit className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="font-semibold">Product intelligence</h2>
                        <p className="text-sm text-muted-foreground">
                          Public evidence informs the creative director before one-session capture.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      {[
                        "Understand public value",
                        "Choose the strongest feature",
                        "Capture one verified take",
                      ].map((label, index) => (
                        <div
                          key={label}
                          className="rounded border border-border bg-background/70 px-3 py-2"
                        >
                          <span className="mr-2 text-primary">{index + 1}.</span>
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button
                    onClick={handleAnalyzeIntelligence}
                    disabled={busyAction === "intelligence"}
                  >
                    {busyAction === "intelligence" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <BrainCircuit />
                    )}
                    Analyze public product
                  </Button>
                </div>
                {workspace.intelligence ? (
                  <FeatureRecommendations
                    intelligence={workspace.intelligence.intelligence_json}
                    selectedFeatureId={selectedFeatureId}
                    onSelect={setSelectedFeatureId}
                  />
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Analyze the public site to generate the evidence-backed creative brief
                    automatically.
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                    <Map className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-semibold">Product map</h2>
                    <p className="text-sm text-muted-foreground">
                      The agent uses this to choose the real pages and clicks.
                    </p>
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
                  <Button
                    variant="outline"
                    onClick={handleScanSite}
                    disabled={busyAction === "scan"}
                  >
                    {busyAction === "scan" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Scan real site
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setMapText(starterMap(project.name, project.base_url))}
                  >
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
                        {workspace.credentials?.kind === "password"
                          ? `Saved for ${workspace.credentials.username_hint}`
                          : "Add access when the demo needs sign-in."}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    <Input
                      value={loginUrl}
                      onChange={(event) => setLoginUrl(event.target.value)}
                      placeholder="Login URL, if the demo needs sign-in"
                      className="bg-background"
                    />
                    <Input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="Email or username"
                      className="bg-background"
                    />
                    <Input
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                      placeholder="Password or access code"
                      type="password"
                      className="bg-background"
                    />
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
                      <p className="text-sm text-muted-foreground">
                        Queue a real-browser run for a video up to 69 seconds.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    <Input
                      value={demoTitle}
                      onChange={(event) => setDemoTitle(event.target.value)}
                      placeholder="Demo title"
                      className="bg-background"
                    />
                    <Textarea
                      value={featurePrompt}
                      onChange={(event) => setFeaturePrompt(event.target.value)}
                      placeholder="Show how a founder creates a campaign, reviews the result, and exports it for social media."
                      className="min-h-32 bg-background"
                    />
                    <label className="grid gap-1.5 text-sm font-medium">
                      Recording language
                      <select
                        value={recordingLocale}
                        onChange={(event) =>
                          setRecordingLocale(event.target.value as RecordingLocale)
                        }
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="english">English (default)</option>
                        <option value="arabic">Arabic</option>
                        <option value="auto">Auto-detect</option>
                      </select>
                      <span className="font-normal text-muted-foreground">
                        English is verified inside the authenticated app before recording continues.
                      </span>
                    </label>
                    <Button onClick={handleCreateDemo} disabled={busyAction === "demo"}>
                      {busyAction === "demo" ? <Loader2 className="animate-spin" /> : <Play />}
                      Create advertisement automatically
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-8">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-xl font-semibold">Demo queue</h2>
                <span className="text-sm text-muted-foreground">
                  {workspace.demos.length} total
                </span>
              </div>
              {workspace.demos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
                  No demos queued yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {workspace.demos.map((demo: Demo) => (
                    <DemoRow
                      key={demo.id}
                      demo={demo}
                      projectId={projectId}
                      onRetryFinalization={handleRetryFinalization}
                      onRetryDirectedCapture={handleRetryDirectedCapture}
                      storyboard={
                        workspace.storyboards.find(
                          (storyboard) => storyboard.id === demo.storyboard_id,
                        ) ?? null
                      }
                      scenes={workspace.scenes.filter((scene) => scene.demo_id === demo.id)}
                      qualityReview={
                        workspace.qualityReviews.find((review) => review.demo_id === demo.id) ??
                        null
                      }
                      onCaptureStoryboard={handleCaptureStoryboard}
                      capturing={busyAction === "capture"}
                      retryingDirectedCapture={busyAction === "directed-retry"}
                      directedRetryEligible={workspace.directedRetryEligibleDemoIds.includes(
                        demo.id,
                      )}
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
  projectId,
  onRetryFinalization,
  onRetryDirectedCapture,
  storyboard,
  scenes,
  qualityReview,
  onCaptureStoryboard,
  capturing,
  retryingDirectedCapture,
  directedRetryEligible,
}: {
  demo: Demo;
  projectId: string;
  onRetryFinalization: (demoId: string) => void;
  onRetryDirectedCapture: (demoId: string) => void;
  storyboard: Workspace["storyboards"][number] | null;
  scenes: Workspace["scenes"];
  qualityReview: Workspace["qualityReviews"][number] | null;
  onCaptureStoryboard: (demoId: string) => void;
  capturing: boolean;
  retryingDirectedCapture: boolean;
  directedRetryEligible: boolean;
}) {
  const { videoUrl, isLive, isReady, liveUrl } = getDemoPlaybackState(demo);
  const downloadUrl = demo.recording_file_id ? stableRecordingUrl(demo.id, true) : videoUrl;
  const canRetryFinalization =
    demo.status === "failed" &&
    Boolean(demo.steel_session_id) &&
    Boolean(
      demo.error_code &&
      /(FINAL|HLS|MP4|SEGMENT|UPLOAD|SIGNED_URL|PLAYBACK|RECORDING_UNAVAILABLE)/i.test(
        demo.error_code,
      ),
    );
  const canRetryDirectedCapture =
    directedRetryEligible &&
    demo.status === "failed" &&
    demo.error_code === "DIRECTOR_CAPTURE_FAILED";
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
          <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
            {demo.recording_locale} recording
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{demo.feature_prompt}</p>
          <div className="mt-2 text-sm text-muted-foreground">{demo.current_step ?? "Queued"}</div>
          {storyboard ? (
            <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" /> Storyboard v{storyboard.version}
              </div>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                {storyboard.storyboard_json.scenes.map((scene, index) => (
                  <div key={scene.id}>
                    <span className="mr-2 text-primary">{index + 1}.</span>
                    {scene.purpose}: {scene.caption}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {scenes.filter((scene) => scene.capture_json.status === "captured").length}/
                {storyboard.storyboard_json.scenes.length} scenes captured
              </div>
            </div>
          ) : null}
          {qualityReview ? (
            <div className="mt-2 rounded-md border border-border bg-background/60 p-2 text-xs text-muted-foreground">
              Quality review:{" "}
              <span className="font-semibold text-foreground">
                {qualityReview.score}/100, {qualityReview.status}
              </span>
            </div>
          ) : null}
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
              {isLive ? "Open live session in new tab" : "Open Steel replay diagnostics"}
            </a>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          {isReady && videoUrl ? (
            <>
              <video
                key={videoUrl}
                src={videoUrl}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full rounded-md border border-border bg-black"
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <Button asChild size="sm">
                  <Link
                    to="/projects/$projectId/demos/$demoId/editor"
                    params={{ projectId, demoId: demo.id }}
                  >
                    <Sparkles />
                    Compose
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={downloadUrl ?? videoUrl} download={safeRecordingFilename(demo.title)}>
                    <Download />
                    Download MP4
                    {demo.duration_seconds ? ` (${demo.duration_seconds}s)` : ""}
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={videoUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    Open / share
                  </a>
                </Button>
              </div>
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
              {demo.status === "rendering" || isLive ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Film className="h-7 w-7" />
              )}
            </div>
          )}
          {canRetryFinalization ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRetryFinalization(demo.id)}
            >
              <RefreshCw />
              Retry video finalization
            </Button>
          ) : null}
          {canRetryDirectedCapture ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-demo-id={demo.id}
              onClick={() => onRetryDirectedCapture(demo.id)}
              disabled={retryingDirectedCapture}
            >
              {retryingDirectedCapture ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Retry directed capture with cached brief
            </Button>
          ) : null}
          {storyboard && demo.status === "pending" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onCaptureStoryboard(demo.id)}
              disabled={capturing}
            >
              <Play /> {capturing ? "Starting capture…" : "Capture storyboard scenes"}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function FeatureRecommendations({
  intelligence,
  selectedFeatureId,
  onSelect,
}: {
  intelligence: NonNullable<Workspace["intelligence"]>["intelligence_json"];
  selectedFeatureId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!intelligence.featureCandidates.length) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No safe, meaningful workflow has enough evidence yet. Add a safe demo state and analyze
        again.
      </p>
    );
  }
  return (
    <div className="mt-5 grid gap-3 lg:grid-cols-3">
      {intelligence.featureCandidates.map((candidate, index) => {
        const screenshot = candidate.evidence.find(
          (evidence) => evidence.type === "screenshot" && evidence.value.startsWith("/api/"),
        );
        return (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onSelect(candidate.id)}
            className={`rounded-lg border p-4 text-left transition ${
              selectedFeatureId === candidate.id
                ? "border-primary bg-primary/10"
                : "border-border bg-background/70 hover:border-primary/50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-tight text-[11px] text-primary">#{index + 1}</span>
              <span className="text-xs text-muted-foreground">
                {Math.round(candidate.confidenceScore * 100)}% confidence
              </span>
            </div>
            <h3 className="mt-2 font-semibold">{candidate.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{candidate.userBenefit}</p>
            <p className="mt-3 text-xs text-muted-foreground">Shows: {candidate.expectedResult}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Est. {candidate.estimatedDurationSeconds}s,{" "}
              {candidate.requiredPreparation.length
                ? candidate.requiredPreparation.join(" ")
                : "No extra preparation"}
            </p>
            {screenshot ? (
              <img
                src={screenshot.value}
                alt="Workflow evidence"
                className="mt-3 aspect-video w-full rounded border border-border object-cover"
              />
            ) : null}
          </button>
        );
      })}
    </div>
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
