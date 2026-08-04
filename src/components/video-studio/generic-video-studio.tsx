import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Film, Loader2, Play, Upload, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  getVideoStudio,
  renderVideoTimeline,
  saveVideoTimeline,
} from "@/lib/video-studio.functions";

type Studio = Awaited<ReturnType<typeof getVideoStudio>>;

function sourceUrl(assetId: string) {
  return `/api/public/media/${assetId}`;
}

function renderUrl(renderId: string) {
  return `/api/public/video-renders/${renderId}`;
}

export function GenericVideoStudio({ projectId }: { projectId: string }) {
  const loadStudio = useServerFn(getVideoStudio);
  const saveTimeline = useServerFn(saveVideoTimeline);
  const renderTimeline = useServerFn(renderVideoTimeline);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [assetId, setAssetId] = useState("");
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const [context, setContext] = useState("");
  const [cta, setCta] = useState("");
  const [zoom, setZoom] = useState(1.08);
  const [crop, setCrop] = useState(0);
  const [frame, setFrame] = useState<"minimal-browser" | "premium-laptop" | "clean-saas">(
    "premium-laptop",
  );
  const [busy, setBusy] = useState<"upload" | "save" | "render" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await loadStudio({ data: { projectId } });
      setStudio(next);
      setAssetId((current) => current || next.media[0]?.id || "");
      setTitle((current) => current || `${next.project.name} launch cut`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this video project.");
    }
  }, [loadStudio, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const latestRender = studio?.renders[0] ?? null;
  const selectedSource = useMemo(() => (assetId ? sourceUrl(assetId) : null), [assetId]);

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const metadata = await readVideoMetadata(file);
      const body = new FormData();
      body.set("file", file);
      body.set("durationSeconds", String(metadata.duration));
      body.set("width", String(metadata.width));
      body.set("height", String(metadata.height));
      const response = await fetch(`/api/media/upload?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        body,
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { assetId: string };
      await load();
      setAssetId(result.assetId);
      setNotice("Source clip stored. Shape the framing, message, and focus before rendering.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The video could not be uploaded.");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndRender() {
    if (!assetId) {
      setError("Upload or select one source clip first.");
      return;
    }
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const timeline = await saveTimeline({
        data: {
          projectId,
          timeline: {
            assetId,
            title,
            hook,
            context,
            cta,
            addressText: "",
            zoom,
            cropTop: crop,
            cropRight: 0,
            cropBottom: crop,
            cropLeft: 0,
            frame,
          },
        },
      });
      setBusy("render");
      await renderTimeline({ data: { timelineId: timeline.id } });
      await load();
      setNotice(
        "A real MP4 render is ready. Review it, then make a render-only revision from the same source.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The render could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/dashboard" className="font-mono-tight text-sm font-semibold">
            WiseDemo / Studio
          </Link>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono-tight text-[10px] uppercase tracking-widest text-primary">
            Generic capture
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="max-w-3xl">
          <p className="font-mono-tight text-xs uppercase tracking-widest text-primary">
            /// Production workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Turn a real clip into a launch-ready video.
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Upload a video, shape its crop and message, then render a downloadable MP4. This default
            workflow never asks for product credentials or changes a third-party app.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-6 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
            {notice}
          </p>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">1. Source</h2>
              <label className="cursor-pointer">
                <input
                  className="sr-only"
                  type="file"
                  accept="video/mp4"
                  disabled={busy !== null}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                    event.currentTarget.value = "";
                  }}
                />
                <span className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
                  <Upload className="h-4 w-4" />
                  {busy === "upload" ? "Storing…" : "Upload MP4"}
                </span>
              </label>
            </div>
            {studio?.media.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {studio.media.map((asset) => (
                  <button
                    type="button"
                    key={asset.id}
                    onClick={() => setAssetId(asset.id)}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${assetId === asset.id ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    Uploaded clip
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Choose an MP4 to begin. The source is stored as immutable production media.
              </div>
            )}
            {selectedSource && (
              <video
                className="mt-5 aspect-video w-full rounded-xl bg-black"
                controls
                preload="metadata"
                src={selectedSource}
              />
            )}
          </section>

          <aside className="rounded-2xl border border-border bg-card/40 p-5">
            <h2 className="text-lg font-semibold">2. Edit</h2>
            <div className="mt-5 space-y-4">
              <Field
                label="Cut title"
                value={title}
                onChange={setTitle}
                placeholder="Your launch cut"
              />
              <Field
                label="Hook"
                value={hook}
                onChange={setHook}
                placeholder="The payoff in one line"
              />
              <Field
                label="Context"
                value={context}
                onChange={setContext}
                placeholder="Why it matters"
              />
              <Field
                label="Call to action"
                value={cta}
                onChange={setCta}
                placeholder="What the viewer does next"
              />
              <label className="block text-sm">
                <span className="mb-1.5 block text-muted-foreground">Frame</span>
                <select
                  value={frame}
                  onChange={(event) => setFrame(event.target.value as typeof frame)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                >
                  <option value="premium-laptop">Premium laptop</option>
                  <option value="minimal-browser">Minimal browser</option>
                  <option value="clean-saas">Clean SaaS</option>
                </select>
              </label>
              <Range
                label={`Focus zoom ${zoom.toFixed(2)}×`}
                min={1}
                max={2}
                step={0.02}
                value={zoom}
                onChange={setZoom}
              />
              <Range
                label={`Top / bottom crop ${Math.round(crop * 100)}%`}
                min={0}
                max={0.35}
                step={0.01}
                value={crop}
                onChange={setCrop}
              />
            </div>
            <Button
              className="mt-6 w-full"
              disabled={busy !== null || !assetId}
              onClick={() => void saveAndRender()}
            >
              <WandSparkles />
              {busy === "render"
                ? "Rendering real MP4…"
                : busy === "save"
                  ? "Saving timeline…"
                  : "Render MP4"}
            </Button>
          </aside>
        </div>

        <section className="mt-6 rounded-2xl border border-border bg-card/40 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono-tight text-xs uppercase tracking-widest text-primary">
                /// Delivery
              </p>
              <h2 className="mt-1 text-lg font-semibold">3. Review and ship</h2>
            </div>
            {latestRender && (
              <a
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm"
                href={`${renderUrl(latestRender.id)}?download=1`}
              >
                <Download className="h-4 w-4" />
                Download MP4
              </a>
            )}
          </div>
          {latestRender ? (
            <div className="mt-5">
              <video
                className="aspect-video w-full max-w-4xl rounded-xl bg-black"
                controls
                preload="metadata"
                src={renderUrl(latestRender.id)}
              />
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Film className="h-4 w-4" />
                Real Remotion render · range-enabled playback · render-only revisions use the same
                immutable source.
              </div>
            </div>
          ) : (
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              <Play className="h-4 w-4" />
              Your finished MP4 will appear here after the first render.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-primary"
      />
    </label>
  );
}

function Range({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-muted-foreground">{label}</span>
      <input
        className="w-full accent-primary"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

async function readVideoMetadata(
  file: File,
): Promise<{ duration: number; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      video.onerror = () => reject(new Error("The browser could not read this MP4."));
      video.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
