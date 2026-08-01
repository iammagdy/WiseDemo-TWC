import { Player, type PlayerRef } from "@remotion/player";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BadgeCheck,
  Captions,
  ChevronRight,
  CirclePlay,
  Download,
  Film,
  Frame,
  Image,
  Layers3,
  Loader2,
  Maximize2,
  MonitorUp,
  Music2,
  Pause,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Type,
  UploadCloud,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { CompositionScene } from "@/composition/CompositionScene";
import { FRAME_REGISTRY, frameHeight, getFrameDefinition } from "@/composition/frames";
import {
  cloneComposition,
  totalCompositionDuration,
  type CompositionDesign,
} from "@/composition/model";
import { COMPOSITION_TEMPLATES, compositionFromTemplate } from "@/composition/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { compositionExportUrl } from "@/lib/composition-state";
import {
  getCompositionWorkspace,
  renderCompositionExport,
  retryCompositionExport,
  saveCompositionDraft,
  suggestCompositionStyle,
} from "@/lib/composition.functions";

export const Route = createFileRoute("/projects/$projectId_/demos/$demoId/editor")({
  head: () => ({
    meta: [
      { title: "Composition Editor — WiseDemo" },
      {
        name: "description",
        content: "Style one real SaaS recording into multiple professional video exports.",
      },
    ],
  }),
  component: CompositionEditorRoute,
});

type Workspace = Awaited<ReturnType<typeof getCompositionWorkspace>>;
type LibraryTab = "templates" | "frames" | "backgrounds" | "captions" | "branding" | "audio";

const libraryTabs: Array<{ id: LibraryTab; label: string; icon: typeof Layers3 }> = [
  { id: "templates", label: "Templates", icon: Layers3 },
  { id: "frames", label: "Frames", icon: Frame },
  { id: "backgrounds", label: "Backgrounds", icon: Image },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "branding", label: "Branding", icon: Type },
  { id: "audio", label: "Audio", icon: Music2 },
];

function CompositionEditorRoute() {
  const { projectId, demoId } = Route.useParams();
  const fetchWorkspace = useServerFn(getCompositionWorkspace);
  const saveDraft = useServerFn(saveCompositionDraft);
  const suggestStyle = useServerFn(suggestCompositionStyle);
  const renderExport = useServerFn(renderCompositionExport);
  const retryExport = useServerFn(retryCompositionExport);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [composition, setComposition] = useState<CompositionDesign | null>(null);
  const [compositionId, setCompositionId] = useState<string | null>(null);
  const [activeLibrary, setActiveLibrary] = useState<LibraryTab>("templates");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "ai" | "render" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<PlayerRef>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWorkspace({ data: { projectId, demoId } });
      setWorkspace(next);
      const latest = next.compositions[0] ?? null;
      setComposition(latest ? latest.composition_json : next.defaultDesign);
      setCompositionId(latest?.id ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load the composition editor.",
      );
    } finally {
      setLoading(false);
    }
  }, [demoId, fetchWorkspace, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => setCurrentFrame(detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [composition]);

  const mutate = useCallback((recipe: (draft: CompositionDesign) => void) => {
    setComposition((current) => {
      if (!current) return current;
      const next = cloneComposition(current);
      recipe(next);
      return next;
    });
  }, []);

  async function handleSave() {
    if (!composition) return null;
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const saved = await saveDraft({
        data: { projectId, demoId, compositionId, composition },
      });
      setCompositionId(saved.id);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              compositions: [saved, ...current.compositions.filter((item) => item.id !== saved.id)],
            }
          : current,
      );
      setMessage(
        `Composition v${saved.composition_version} saved. The raw recording is unchanged.`,
      );
      return saved;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this composition.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleAiStyle() {
    if (!composition) return;
    setBusy("ai");
    setError(null);
    setMessage(null);
    try {
      const result = await suggestStyle({ data: { projectId, demoId, composition } });
      setComposition(result.composition);
      setMessage(
        `${result.source === "ai" ? "AI" : "Smart fallback"} direction applied from ${result.palette.join(", ")}. Every property remains editable.`,
      );
    } catch (styleError) {
      setError(
        styleError instanceof Error ? styleError.message : "Could not generate a style direction.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleRender() {
    if (!composition) return;
    setBusy("render");
    setError(null);
    setMessage("Saving the design before server rendering…");
    try {
      const saved = await saveDraft({
        data: { projectId, demoId, compositionId, composition },
      });
      setCompositionId(saved.id);
      setMessage("Rendering the shared React composition into a final MP4…");
      const rendered = await renderExport({ data: { compositionId: saved.id } });
      setWorkspace((current) =>
        current ? { ...current, exports: [rendered, ...current.exports] } : current,
      );
      if (rendered.render_status === "ready") {
        setMessage("Final MP4 is ready. No new Steel session was created.");
      } else {
        setError(rendered.render_error ?? "The render did not complete.");
      }
    } catch (renderError) {
      setError(
        renderError instanceof Error ? renderError.message : "Could not render this composition.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleRetry(exportId: string) {
    setBusy("render");
    setError(null);
    setMessage("Retrying this saved export. Steel will not run.");
    try {
      const rendered = await retryExport({ data: { exportId } });
      setWorkspace((current) =>
        current
          ? {
              ...current,
              exports: [rendered, ...current.exports.filter((item) => item.id !== rendered.id)],
            }
          : current,
      );
      if (rendered.render_status === "ready") {
        setMessage("Retried export is ready from the same immutable raw recording.");
      } else {
        setError(rendered.render_error ?? "The render retry did not complete.");
      }
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Could not retry this export.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090a0d] text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" /> Loading composition studio…
      </div>
    );
  }
  if (!workspace || !composition) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090a0d] px-6 text-center text-white">
        <div>
          <p className="text-lg font-semibold">Composition editor unavailable</p>
          <p className="mt-2 text-sm text-white/55">
            {error ?? "The raw recording could not be loaded."}
          </p>
          <Button asChild variant="outline" className="mt-5">
            <Link to="/projects/$projectId" params={{ projectId }}>
              Return to project
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const durationInFrames = Math.round(
    totalCompositionDuration(composition, workspace.rawDurationSeconds) * composition.canvas.fps,
  );
  const currentSeconds = currentFrame / composition.canvas.fps;

  return (
    <div className="flex h-screen overflow-hidden bg-[#090a0d] text-white flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 bg-[#0d0e12] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="text-white/65 hover:text-white">
            <Link to="/projects/$projectId" params={{ projectId }}>
              <ArrowLeft /> Project
            </Link>
          </Button>
          <div className="h-5 w-px bg-white/10" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{workspace.demo.title}</div>
            <div className="truncate text-[11px] text-white/40">
              {composition.canvas.width} × {composition.canvas.height} · {composition.canvas.fps}{" "}
              fps · raw locked
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleAiStyle} disabled={busy !== null}>
            {busy === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            AI style
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={busy !== null}>
            {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          <Button size="sm" onClick={handleRender} disabled={busy !== null}>
            {busy === "render" ? <Loader2 className="animate-spin" /> : <UploadCloud />}
            Render MP4
          </Button>
        </div>
      </header>

      {(message || error) && (
        <div
          className={`border-b px-4 py-2 text-xs ${error ? "border-red-500/20 bg-red-500/10 text-red-200" : "border-primary/20 bg-primary/8 text-orange-100"}`}
        >
          {error ?? message}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[76px_260px_minmax(460px,1fr)_292px]">
        <nav className="border-r border-white/8 bg-[#0d0e12] py-3">
          {libraryTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeLibrary === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveLibrary(tab.id)}
                className={`flex w-full flex-col items-center gap-1.5 px-1 py-3 text-[10px] transition ${active ? "bg-primary/12 text-primary" : "text-white/42 hover:bg-white/4 hover:text-white/75"}`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <aside className="min-h-0 overflow-y-auto border-r border-white/8 bg-[#111217]">
          <LibraryPanel
            active={activeLibrary}
            composition={composition}
            workspace={workspace}
            mutate={mutate}
            onTemplateApplied={() => setCompositionId(null)}
          />
        </aside>

        <main className="flex min-h-0 flex-col bg-[#08090c]">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-7">
            <CompositionStage
              composition={composition}
              rawVideoUrl={workspace.rawVideoUrl}
              rawDurationSeconds={workspace.rawDurationSeconds}
              durationInFrames={durationInFrames}
              playerRef={playerRef}
              mutate={mutate}
            />
          </div>
          <div className="border-t border-white/8 bg-[#0d0e12]">
            <Transport
              playerRef={playerRef}
              playing={playing}
              currentFrame={currentFrame}
              durationInFrames={durationInFrames}
              fps={composition.canvas.fps}
            />
            <CompositionTimeline
              composition={composition}
              rawDuration={workspace.rawDurationSeconds}
              currentSeconds={currentSeconds}
              onSeek={(seconds) =>
                playerRef.current?.seekTo(Math.round(seconds * composition.canvas.fps))
              }
            />
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto border-l border-white/8 bg-[#111217]">
          <Inspector composition={composition} mutate={mutate} />
          <ExportShelf exports={workspace.exports} onRetry={handleRetry} busy={busy === "render"} />
        </aside>
      </div>
    </div>
  );
}

function LibraryPanel({
  active,
  composition,
  workspace,
  mutate,
  onTemplateApplied,
}: {
  active: LibraryTab;
  composition: CompositionDesign;
  workspace: Workspace;
  mutate: (recipe: (draft: CompositionDesign) => void) => void;
  onTemplateApplied: () => void;
}) {
  return (
    <div className="p-4">
      <div className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
        {active}
      </div>
      {active === "templates" ? (
        <div className="space-y-3">
          {COMPOSITION_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                onTemplateApplied();
                const next = compositionFromTemplate(template.id);
                next.intro.title = `${workspace.project.name} walkthrough`;
                next.frame.addressText = new URL(workspace.project.base_url).hostname;
                mutate((draft) => Object.assign(draft, next));
              }}
              className={`w-full rounded-lg border p-3 text-left transition ${composition.templateId === template.id ? "border-primary bg-primary/8" : "border-white/8 bg-white/[0.025] hover:border-white/18"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{template.name}</span>
                <ChevronRight className="h-3.5 w-3.5 text-white/30" />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-white/42">
                {template.description}
              </p>
            </button>
          ))}
        </div>
      ) : null}

      {active === "frames" ? (
        <div className="grid grid-cols-2 gap-2">
          {FRAME_REGISTRY.map((frame) => (
            <button
              key={frame.id}
              type="button"
              onClick={() =>
                mutate((draft) => {
                  draft.frame.id = frame.id;
                  draft.frame.x = Math.round(draft.canvas.width * frame.defaultCanvasPlacement.x);
                  draft.frame.y = Math.round(draft.canvas.height * frame.defaultCanvasPlacement.y);
                  draft.frame.width = Math.round(
                    draft.canvas.width * frame.defaultCanvasPlacement.width,
                  );
                  draft.frame.chromeVisible = frame.browserChrome !== "none";
                })
              }
              className={`rounded-lg border p-2 text-left ${composition.frame.id === frame.id ? "border-primary bg-primary/8" : "border-white/8 bg-white/[0.025]"}`}
            >
              <div className="flex aspect-[4/3] items-center justify-center rounded bg-black/25 p-2">
                {frame.type === "raw" ? (
                  <Maximize2 className="h-7 w-7 text-white/35" />
                ) : (
                  <img src={frame.thumbnail} alt="" className="max-h-full max-w-full" />
                )}
              </div>
              <div className="mt-2 text-[10px] font-medium leading-tight text-white/72">
                {frame.label}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {active === "backgrounds" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                "solid",
                "linear-gradient",
                "radial-gradient",
                "mesh-gradient",
                "brand-blur",
                "texture",
              ] as const
            ).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => mutate((draft) => void (draft.background.type = type))}
                className={`rounded-md border px-2 py-2 text-[10px] capitalize ${composition.background.type === type ? "border-primary text-primary" : "border-white/8 text-white/55"}`}
              >
                {type.replace("-", " ")}
              </button>
            ))}
          </div>
          <FieldLabel label="Palette">
            {composition.background.colors.slice(0, 4).map((color, index) => (
              <input
                key={`${index}-${color}`}
                type="color"
                value={toColorInput(color)}
                onChange={(event) =>
                  mutate((draft) => void (draft.background.colors[index] = event.target.value))
                }
                className="h-9 w-full cursor-pointer rounded border border-white/10 bg-transparent"
              />
            ))}
          </FieldLabel>
          <RangeField
            label="Gradient angle"
            value={composition.background.angle}
            min={-180}
            max={180}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.background.angle = value))}
          />
          <TextField
            label="Image URL"
            value={composition.background.imageUrl ?? ""}
            placeholder="Optional licensed image"
            onChange={(value) =>
              mutate((draft) => {
                draft.background.imageUrl = value || null;
                draft.background.type = value ? "image" : draft.background.type;
              })
            }
          />
          <TextField
            label="Video URL"
            value={composition.background.videoUrl ?? ""}
            placeholder="Optional background video"
            onChange={(value) =>
              mutate((draft) => {
                draft.background.videoUrl = value || null;
                draft.background.type = value ? "video" : draft.background.type;
              })
            }
          />
        </div>
      ) : null}

      {active === "captions" ? (
        <div className="space-y-4">
          <ToggleRow
            label="Show captions"
            checked={composition.captions.enabled}
            onChange={(checked) => mutate((draft) => void (draft.captions.enabled = checked))}
          />
          <SelectField
            label="Position"
            value={composition.captions.position}
            options={["top", "bottom", "lower-third"]}
            onChange={(value) =>
              mutate(
                (draft) =>
                  void (draft.captions.position =
                    value as CompositionDesign["captions"]["position"]),
              )
            }
          />
          <div className="space-y-2">
            {composition.captions.items.map((caption, index) => (
              <div key={caption.id} className="rounded-lg border border-white/8 bg-black/15 p-2.5">
                <Input
                  aria-label={`Caption ${index + 1} text`}
                  value={caption.text}
                  onChange={(event) =>
                    mutate((draft) => void (draft.captions.items[index].text = event.target.value))
                  }
                  className="h-8 bg-black/20 text-xs"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <NumberField
                    label={`Caption ${index + 1} start`}
                    value={caption.start}
                    min={0}
                    step={0.1}
                    onChange={(value) =>
                      mutate((draft) => void (draft.captions.items[index].start = value))
                    }
                  />
                  <NumberField
                    label={`Caption ${index + 1} length`}
                    value={caption.duration}
                    min={0.4}
                    step={0.1}
                    onChange={(value) =>
                      mutate((draft) => void (draft.captions.items[index].duration = value))
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() =>
              mutate(
                (draft) =>
                  void draft.captions.items.push({
                    id: crypto.randomUUID(),
                    start: 4,
                    duration: 3,
                    text: "Add a short, purposeful caption.",
                  }),
              )
            }
          >
            <Plus /> Add caption
          </Button>
        </div>
      ) : null}

      {active === "branding" ? (
        <div className="space-y-4">
          <TextField
            label="Watermark text"
            value={composition.branding.watermarkText}
            onChange={(value) => mutate((draft) => void (draft.branding.watermarkText = value))}
          />
          <TextField
            label="Logo URL"
            value={composition.branding.logoUrl ?? ""}
            placeholder="Original or licensed logo"
            onChange={(value) => mutate((draft) => void (draft.branding.logoUrl = value || null))}
          />
          <SelectField
            label="Logo position"
            value={composition.branding.logoPosition}
            options={["top-left", "top-right", "bottom-left", "bottom-right"]}
            onChange={(value) =>
              mutate(
                (draft) =>
                  void (draft.branding.logoPosition =
                    value as CompositionDesign["branding"]["logoPosition"]),
              )
            }
          />
          <RangeField
            label="Opacity"
            value={composition.branding.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => mutate((draft) => void (draft.branding.opacity = value))}
          />
        </div>
      ) : null}

      {active === "audio" ? (
        <div className="space-y-4">
          <TextField
            label="Music URL"
            value={composition.audio.musicUrl ?? ""}
            placeholder="Licensed audio file"
            onChange={(value) => mutate((draft) => void (draft.audio.musicUrl = value || null))}
          />
          <RangeField
            label="Music volume"
            value={composition.audio.volume}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => mutate((draft) => void (draft.audio.volume = value))}
          />
          <NumberField
            label="Fade in"
            value={composition.audio.fadeIn}
            min={0}
            max={10}
            step={0.1}
            onChange={(value) => mutate((draft) => void (draft.audio.fadeIn = value))}
          />
          <NumberField
            label="Fade out"
            value={composition.audio.fadeOut}
            min={0}
            max={10}
            step={0.1}
            onChange={(value) => mutate((draft) => void (draft.audio.fadeOut = value))}
          />
          <p className="text-[11px] leading-relaxed text-white/35">
            Use original or properly licensed music. Audio remains a composition property and never
            alters the raw capture.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CompositionStage({
  composition,
  rawVideoUrl,
  rawDurationSeconds,
  durationInFrames,
  playerRef,
  mutate,
}: {
  composition: CompositionDesign;
  rawVideoUrl: string;
  rawDurationSeconds: number;
  durationInFrames: number;
  playerRef: React.RefObject<PlayerRef | null>;
  mutate: (recipe: (draft: CompositionDesign) => void) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    mode: "move" | "resize";
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    width: number;
    scale: number;
  } | null>(null);
  const [stageWidth, setStageWidth] = useState(800);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = stageWidth / composition.canvas.width;
  const stageHeight = composition.canvas.height * scale;
  const height = frameHeight(composition.frame.id, composition.frame.width);

  function startPointer(event: ReactPointerEvent, mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: composition.frame.x,
      y: composition.frame.y,
      width: composition.frame.width,
      scale,
    };
  }

  function movePointer(event: ReactPointerEvent) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = (event.clientX - active.clientX) / active.scale;
    const dy = (event.clientY - active.clientY) / active.scale;
    mutate((draft) => {
      if (active.mode === "move") {
        draft.frame.x = Math.round(active.x + dx);
        draft.frame.y = Math.round(active.y + dy);
      } else {
        draft.frame.width = Math.max(120, Math.round(active.width + dx));
      }
    });
  }

  return (
    <div className="w-full max-w-[980px]">
      <div className="mb-3 flex items-center justify-between text-[11px] text-white/40">
        <span>Accurate preview · output coordinates</span>
        <span>{Math.round(scale * 100)}% view</span>
      </div>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-sm bg-black shadow-[0_28px_90px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
        style={{ height: stageHeight }}
      >
        <Player
          ref={playerRef}
          component={CompositionScene}
          inputProps={{ composition, rawVideoUrl, rawVideoIsStatic: false, rawDurationSeconds }}
          durationInFrames={durationInFrames}
          compositionWidth={composition.canvas.width}
          compositionHeight={composition.canvas.height}
          fps={composition.canvas.fps}
          controls={false}
          clickToPlay={false}
          spaceKeyToPlayOrPause
          acknowledgeRemotionLicense
          style={{ width: "100%", height: "100%" }}
        />
        <div className="pointer-events-none absolute inset-[5%] border border-dashed border-white/18" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-full border-l border-dashed border-white/10" />
        <div className="pointer-events-none absolute left-0 top-1/2 w-full border-t border-dashed border-white/10" />
        <div
          role="presentation"
          onPointerDown={(event) => startPointer(event, "move")}
          onPointerMove={movePointer}
          onPointerUp={() => void (drag.current = null)}
          className="absolute cursor-move border border-primary/90 shadow-[0_0_0_1px_rgba(255,79,0,0.2)]"
          style={{
            left: composition.frame.x * scale,
            top: composition.frame.y * scale,
            width: composition.frame.width * scale,
            height: height * scale,
            transform: `rotate(${composition.frame.rotation}deg)`,
          }}
        >
          <span className="absolute -left-px -top-5 bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-white">
            FRAME
          </span>
          <button
            type="button"
            aria-label="Resize frame"
            onPointerDown={(event) => startPointer(event, "resize")}
            onPointerMove={movePointer}
            onPointerUp={() => void (drag.current = null)}
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-primary"
          />
        </div>
      </div>
    </div>
  );
}

function Transport({
  playerRef,
  playing,
  currentFrame,
  durationInFrames,
  fps,
}: {
  playerRef: React.RefObject<PlayerRef | null>;
  playing: boolean;
  currentFrame: number;
  durationInFrames: number;
  fps: number;
}) {
  return (
    <div className="flex h-11 items-center gap-3 border-b border-white/8 px-4">
      <button
        type="button"
        aria-label={playing ? "Pause preview" : "Play preview"}
        onClick={() => playerRef.current?.toggle()}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
      </button>
      <span className="w-24 font-mono text-[11px] text-white/55">
        {formatTime(currentFrame / fps)} / {formatTime(durationInFrames / fps)}
      </span>
      <input
        aria-label="Composition current time"
        type="range"
        min={0}
        max={Math.max(1, durationInFrames - 1)}
        value={Math.min(currentFrame, durationInFrames - 1)}
        onChange={(event) => playerRef.current?.seekTo(Number(event.target.value))}
        className="h-1 flex-1 accent-orange-500"
      />
    </div>
  );
}

function CompositionTimeline({
  composition,
  rawDuration,
  currentSeconds,
  onSeek,
}: {
  composition: CompositionDesign;
  rawDuration: number;
  currentSeconds: number;
  onSeek: (seconds: number) => void;
}) {
  const intro = composition.intro.enabled ? composition.intro.duration : 0;
  const outro = composition.outro.enabled ? composition.outro.duration : 0;
  const total = intro + rawDuration + outro;
  const tracks = [
    {
      label: "VIDEO",
      items: [
        { id: "intro", start: 0, duration: intro, color: "bg-violet-500" },
        { id: "recording", start: intro, duration: rawDuration, color: "bg-blue-500" },
        { id: "outro", start: intro + rawDuration, duration: outro, color: "bg-violet-500" },
      ],
    },
    {
      label: "ZOOM",
      items: composition.animation.zoomEvents.map((item) => ({
        id: item.id,
        start: intro + item.start,
        duration: item.duration,
        color: "bg-orange-500",
      })),
    },
    {
      label: "CAPTIONS",
      items: composition.captions.items.map((item) => ({
        id: item.id,
        start: intro + item.start,
        duration: item.duration,
        color: "bg-emerald-500",
      })),
    },
    {
      label: "MUSIC",
      items: composition.audio.musicUrl
        ? [{ id: "music", start: 0, duration: total, color: "bg-fuchsia-500" }]
        : [],
    },
  ];
  return (
    <div
      className="relative px-4 py-3"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * total);
      }}
    >
      <div
        className="pointer-events-none absolute bottom-3 top-3 w-px bg-white/80"
        style={{ left: `calc(1rem + ${(currentSeconds / total) * (100 - 4)}%)` }}
      />
      <div className="space-y-1.5">
        {tracks.map((track) => (
          <div key={track.label} className="grid grid-cols-[64px_1fr] items-center gap-2">
            <div className="font-mono text-[9px] text-white/25">{track.label}</div>
            <div className="relative h-5 rounded bg-white/[0.035]">
              {track.items
                .filter((item) => item.duration > 0)
                .map((item) => (
                  <div
                    key={item.id}
                    className={`absolute top-0.5 h-4 rounded-sm opacity-80 ${item.color}`}
                    style={{
                      left: `${(item.start / total) * 100}%`,
                      width: `${Math.max(0.5, (item.duration / total) * 100)}%`,
                    }}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Inspector({
  composition,
  mutate,
}: {
  composition: CompositionDesign;
  mutate: (recipe: (draft: CompositionDesign) => void) => void;
}) {
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Inspector
      </div>
      <InspectorSection title="Canvas">
        <div className="grid grid-cols-2 gap-2">
          {[
            [1920, 1080, "16:9"],
            [1080, 1080, "1:1"],
            [1080, 1350, "4:5"],
            [1080, 1920, "9:16"],
          ].map(([width, height, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => resizeCanvas(composition, Number(width), Number(height), mutate)}
              className={`rounded border px-2 py-2 text-[10px] ${composition.canvas.width === width && composition.canvas.height === height ? "border-primary text-primary" : "border-white/8 text-white/45"}`}
            >
              {label}
              <span className="mt-0.5 block text-[8px] opacity-60">
                {width}×{height}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            value={composition.canvas.width}
            min={320}
            max={4096}
            step={2}
            onChange={(value) =>
              resizeCanvas(composition, value, composition.canvas.height, mutate)
            }
          />
          <NumberField
            label="Height"
            value={composition.canvas.height}
            min={320}
            max={4096}
            step={2}
            onChange={(value) => resizeCanvas(composition, composition.canvas.width, value, mutate)}
          />
        </div>
      </InspectorSection>

      <InspectorSection title="Frame transform">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Position X"
            value={composition.frame.x}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.frame.x = value))}
          />
          <NumberField
            label="Position Y"
            value={composition.frame.y}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.frame.y = value))}
          />
          <NumberField
            label="Width"
            value={composition.frame.width}
            min={120}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.frame.width = value))}
          />
          <NumberField
            label="Rotation"
            value={composition.frame.rotation}
            min={-45}
            max={45}
            step={0.5}
            onChange={(value) => mutate((draft) => void (draft.frame.rotation = value))}
          />
        </div>
        <SelectField
          label="Variant"
          value={composition.frame.variant}
          options={["dark", "light"]}
          onChange={(value) =>
            mutate((draft) => void (draft.frame.variant = value as "dark" | "light"))
          }
        />
        <ToggleRow
          label="Browser chrome"
          checked={composition.frame.chromeVisible}
          onChange={(checked) => mutate((draft) => void (draft.frame.chromeVisible = checked))}
        />
        <TextField
          label="Address bar text"
          value={composition.frame.addressText}
          onChange={(value) => mutate((draft) => void (draft.frame.addressText = value))}
        />
      </InspectorSection>

      <InspectorSection title="Recording crop & fit">
        <SelectField
          label="Recorded language"
          value={composition.recording.locale}
          options={["english", "arabic", "auto"]}
          onChange={(value) =>
            mutate(
              (draft) =>
                void (draft.recording.locale = value as CompositionDesign["recording"]["locale"]),
            )
          }
        />
        <SelectField
          label="Fit"
          value={composition.recording.fit}
          options={["contain", "cover", "fill"]}
          onChange={(value) =>
            mutate(
              (draft) =>
                void (draft.recording.fit = value as CompositionDesign["recording"]["fit"]),
            )
          }
        />
        <RangeField
          label="Recording zoom"
          value={composition.recording.zoom}
          min={0.5}
          max={3}
          step={0.01}
          onChange={(value) => mutate((draft) => void (draft.recording.zoom = value))}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Offset X"
            value={composition.recording.offsetX}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.recording.offsetX = value))}
          />
          <NumberField
            label="Offset Y"
            value={composition.recording.offsetY}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.recording.offsetY = value))}
          />
        </div>
      </InspectorSection>

      <InspectorSection title="Source viewport normalization">
        <div className="rounded border border-white/8 bg-white/[0.025] p-2 text-[11px] leading-5 text-white/50">
          Detected page viewport: {composition.recording.sourceViewport.contentWidth}×
          {composition.recording.sourceViewport.contentHeight} at (
          {composition.recording.sourceViewport.contentX},{" "}
          {composition.recording.sourceViewport.contentY}) inside{" "}
          {composition.recording.sourceViewport.videoWidth}×
          {composition.recording.sourceViewport.videoHeight} video.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Source crop top"
            value={composition.recording.sourceCropTop}
            min={0}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.recording.sourceCropTop = value))}
          />
          <NumberField
            label="Source crop bottom"
            value={composition.recording.sourceCropBottom}
            min={0}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.recording.sourceCropBottom = value))}
          />
          <NumberField
            label="Source crop left"
            value={composition.recording.sourceCropLeft}
            min={0}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.recording.sourceCropLeft = value))}
          />
          <NumberField
            label="Source crop right"
            value={composition.recording.sourceCropRight}
            min={0}
            step={1}
            onChange={(value) => mutate((draft) => void (draft.recording.sourceCropRight = value))}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() =>
            mutate((draft) => {
              draft.recording.sourceCropTop = 0;
              draft.recording.sourceCropRight = 0;
              draft.recording.sourceCropBottom = 0;
              draft.recording.sourceCropLeft = 0;
            })
          }
        >
          Reset to detected viewport
        </Button>
      </InspectorSection>

      <InspectorSection title="Border & shadow">
        <RangeField
          label="Screen radius"
          value={composition.frame.radius}
          min={0}
          max={80}
          step={1}
          onChange={(value) => mutate((draft) => void (draft.frame.radius = value))}
        />
        <RangeField
          label="Border"
          value={composition.frame.borderWidth}
          min={0}
          max={12}
          step={1}
          onChange={(value) => mutate((draft) => void (draft.frame.borderWidth = value))}
        />
        <RangeField
          label="Shadow blur"
          value={composition.frame.shadowBlur}
          min={0}
          max={180}
          step={1}
          onChange={(value) => mutate((draft) => void (draft.frame.shadowBlur = value))}
        />
        <RangeField
          label="Shadow opacity"
          value={composition.frame.shadowOpacity}
          min={0}
          max={0.8}
          step={0.01}
          onChange={(value) => mutate((draft) => void (draft.frame.shadowOpacity = value))}
        />
      </InspectorSection>

      <InspectorSection title="Motion">
        <SelectField
          label="Preset"
          value={composition.animation.preset}
          options={[
            "none",
            "subtle",
            "minimal-premium",
            "cinematic",
            "founder-launch",
            "fast-social",
          ]}
          onChange={(value) =>
            mutate(
              (draft) =>
                void (draft.animation.preset = value as CompositionDesign["animation"]["preset"]),
            )
          }
        />
        <SelectField
          label="Entrance"
          value={composition.animation.entrance}
          options={["none", "fade", "scale", "slide-up", "slide-left"]}
          onChange={(value) =>
            mutate(
              (draft) =>
                void (draft.animation.entrance =
                  value as CompositionDesign["animation"]["entrance"]),
            )
          }
        />
        <RangeField
          label="Floating motion"
          value={composition.animation.floatingMotion}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => mutate((draft) => void (draft.animation.floatingMotion = value))}
        />
        {composition.animation.zoomEvents.map((zoom, index) => (
          <div key={zoom.id} className="grid grid-cols-2 gap-2 rounded border border-white/8 p-2">
            <NumberField
              label={`Zoom ${index + 1} start`}
              value={zoom.start}
              min={0}
              step={0.1}
              onChange={(value) =>
                mutate((draft) => void (draft.animation.zoomEvents[index].start = value))
              }
            />
            <NumberField
              label="Scale"
              value={zoom.zoom}
              min={1}
              max={5}
              step={0.05}
              onChange={(value) =>
                mutate((draft) => void (draft.animation.zoomEvents[index].zoom = value))
              }
            />
            <NumberField
              label="Page focus X"
              value={zoom.focusX ?? composition.recording.sourceViewport.contentWidth / 2}
              min={0}
              step={1}
              onChange={(value) =>
                mutate((draft) => void (draft.animation.zoomEvents[index].focusX = value))
              }
            />
            <NumberField
              label="Page focus Y"
              value={zoom.focusY ?? composition.recording.sourceViewport.contentHeight / 2}
              min={0}
              step={1}
              onChange={(value) =>
                mutate((draft) => void (draft.animation.zoomEvents[index].focusY = value))
              }
            />
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() =>
            mutate(
              (draft) =>
                void draft.animation.zoomEvents.push({
                  id: crypto.randomUUID(),
                  start: 8,
                  duration: 4,
                  zoom: 1.3,
                  panX: 0,
                  panY: 0,
                  focusX: draft.recording.sourceViewport.contentWidth / 2,
                  focusY: draft.recording.sourceViewport.contentHeight / 2,
                }),
            )
          }
        >
          <Plus /> Add zoom event
        </Button>
      </InspectorSection>

      <InspectorSection title="Intro & outro">
        <ToggleRow
          label="Intro"
          checked={composition.intro.enabled}
          onChange={(checked) => mutate((draft) => void (draft.intro.enabled = checked))}
        />
        <TextField
          label="Intro title"
          value={composition.intro.title}
          onChange={(value) => mutate((draft) => void (draft.intro.title = value))}
        />
        <ToggleRow
          label="Outro"
          checked={composition.outro.enabled}
          onChange={(checked) => mutate((draft) => void (draft.outro.enabled = checked))}
        />
        <TextField
          label="Outro title"
          value={composition.outro.title}
          onChange={(value) => mutate((draft) => void (draft.outro.title = value))}
        />
      </InspectorSection>

      <InspectorSection title="Export">
        <SelectField
          label="Quality"
          value={composition.export.quality}
          options={["draft", "standard", "high", "master"]}
          onChange={(value) =>
            mutate(
              (draft) =>
                void (draft.export.quality = value as CompositionDesign["export"]["quality"]),
            )
          }
        />
        <NumberField
          label="FPS"
          value={composition.canvas.fps}
          min={15}
          max={60}
          step={1}
          onChange={(value) => mutate((draft) => void (draft.canvas.fps = value))}
        />
      </InspectorSection>
    </div>
  );
}

function ExportShelf({
  exports,
  onRetry,
  busy,
}: {
  exports: Workspace["exports"];
  onRetry: (exportId: string) => void;
  busy: boolean;
}) {
  if (exports.length === 0) return null;
  return (
    <div className="border-t border-white/8 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
        <MonitorUp className="h-3.5 w-3.5" /> Exports
      </div>
      <div className="space-y-3">
        {exports.slice(0, 5).map((item) => (
          <div key={item.id} className="rounded-lg border border-white/8 bg-black/15 p-2.5">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span
                className={
                  item.render_status === "ready"
                    ? "text-emerald-400"
                    : item.render_status === "failed"
                      ? "text-red-300"
                      : "text-orange-300"
                }
              >
                {item.render_status}
              </span>
              <span className="text-white/30">
                {item.output_width}×{item.output_height}
              </span>
            </div>
            {item.render_status === "ready" ? (
              <>
                <video
                  src={compositionExportUrl(item.id)}
                  controls
                  preload="metadata"
                  className="mt-2 aspect-video w-full rounded bg-black"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={compositionExportUrl(item.id, true)} download>
                      <Download /> MP4
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={compositionExportUrl(item.id)} target="_blank" rel="noreferrer">
                      <CirclePlay /> Open
                    </a>
                  </Button>
                </div>
              </>
            ) : item.render_error ||
              (item.render_status === "rendering" &&
                Date.now() - new Date(item.updated_at).getTime() >= 2 * 60_000) ? (
              <div className="mt-2 space-y-2">
                <p className="text-[10px] leading-relaxed text-red-200/70">
                  {item.render_error ?? "This render stopped reporting progress before completion."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onRetry(item.id)}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <UploadCloud />} Retry render
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-white/8 py-4 first:pt-0">
      <h3 className="mb-3 text-[11px] font-semibold text-white/72">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] text-white/38">{label}</span>
      <div className="flex gap-2">{children}</div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <FieldLabel label={label}>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 bg-black/20 text-xs"
      />
    </FieldLabel>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <FieldLabel label={label}>
      <Input
        type="number"
        value={Number(value.toFixed(2))}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 bg-black/20 text-xs"
      />
    </FieldLabel>
  );
}

function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-[10px] text-white/38">
        <span>{label}</span>
        <span>{Number(value.toFixed(2))}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full accent-orange-500"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <FieldLabel label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-white/10 bg-black/20 px-2 text-xs text-white outline-none focus:border-primary"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("-", " ")}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-white/55">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-orange-500"
      />
    </label>
  );
}

function resizeCanvas(
  composition: CompositionDesign,
  width: number,
  height: number,
  mutate: (recipe: (draft: CompositionDesign) => void) => void,
) {
  const scaleX = width / composition.canvas.width;
  const scaleY = height / composition.canvas.height;
  mutate((draft) => {
    draft.frame.x = Math.round(draft.frame.x * scaleX);
    draft.frame.y = Math.round(draft.frame.y * scaleY);
    draft.frame.width = Math.round(draft.frame.width * Math.min(scaleX, scaleY));
    draft.canvas.width = width;
    draft.canvas.height = height;
    draft.canvas.format =
      width === 1920 && height === 1080
        ? "landscape"
        : width === height
          ? "square"
          : width === 1080 && height === 1350
            ? "portrait-feed"
            : width === 1080 && height === 1920
              ? "vertical"
              : "custom";
  });
}

function toColorInput(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#111827";
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.max(0, seconds - minutes * 60);
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
