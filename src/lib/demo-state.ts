export const DEMO_STATUSES = [
  "pending",
  "starting",
  "scanning",
  "planning",
  "recording",
  "rendering",
  "ready",
  "failed",
] as const;

export type DemoStatus = (typeof DEMO_STATUSES)[number];

const TRANSITIONS: Record<DemoStatus, ReadonlySet<DemoStatus>> = {
  pending: new Set(["starting", "scanning", "failed"]),
  starting: new Set(["scanning", "recording", "failed"]),
  scanning: new Set(["planning", "failed"]),
  planning: new Set(["recording", "failed"]),
  recording: new Set(["rendering", "failed"]),
  rendering: new Set(["ready", "failed"]),
  ready: new Set(["ready"]),
  failed: new Set(["failed", "rendering"]),
};

export function isDemoStatus(value: string): value is DemoStatus {
  return (DEMO_STATUSES as readonly string[]).includes(value);
}

export function canTransitionDemo(from: string, to: DemoStatus): boolean {
  if (!isDemoStatus(from)) return false;
  return from === to || TRANSITIONS[from].has(to);
}

export function stableRecordingUrl(demoId: string, download = false): string {
  return `/api/public/demo-recordings/${encodeURIComponent(demoId)}${download ? "?download=1" : ""}`;
}

export type PlaybackDemo = {
  id: string;
  status: string;
  mp4_url: string | null;
  recording_url: string | null;
  recording_file_id?: string | null;
  live_view_url: string | null;
  session_viewer_url: string | null;
};

export function getDemoPlaybackState(demo: PlaybackDemo) {
  const durableUrl = demo.recording_file_id ? stableRecordingUrl(demo.id) : null;
  const videoUrl = durableUrl ?? demo.mp4_url ?? demo.recording_url ?? null;
  const isLive = ["starting", "scanning", "planning", "recording"].includes(demo.status);
  const liveUrl = isLive ? (demo.live_view_url ?? demo.session_viewer_url) : null;
  return {
    videoUrl,
    liveUrl,
    isLive,
    isRendering: demo.status === "rendering",
    isReady: demo.status === "ready" && Boolean(videoUrl),
    isFailed: demo.status === "failed",
  };
}

export function safeRecordingFilename(title: string): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return `${stem || "wisedemo-recording"}.mp4`;
}

export function isVerifiedLoginOutcome(input: {
  fieldsApplied: boolean;
  submitted: boolean;
  loginFormGone: boolean;
  outlineHasPasswordField: boolean;
}): boolean {
  return (
    input.fieldsApplied && input.submitted && input.loginFormGone && !input.outlineHasPasswordField
  );
}
