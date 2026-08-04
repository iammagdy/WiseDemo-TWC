// A short, evidence-rich feature advertisement is a valid production format.
// Keep the raw recording bounds broad enough for both a short ad and a longer
// walkthrough; the creative brief decides the editorial duration.
export const PROFESSIONAL_RECORDING_MIN_SECONDS = 8;
export const PROFESSIONAL_RECORDING_MAX_SECONDS = 69;
export const RECORDING_TARGET_MS = 50_000;
export const RECORDING_MAX_WALL_MS = 65_000;

const RELEASE_RESERVE_MS = 3_000;
const MIN_ACTION_BUDGET_MS = 8_000;

export type DirectedCapturePhaseBudget = {
  // Bootstrap covers the shield, authentication, and read-only account audit.
  // Fixture preflight is deliberately independent so bootstrap latency cannot
  // consume the time reserved for a guarded creation action.
  protectedBootstrapMaxMs: number;
  preflightMaxMs: number;
  cleanTakeActionMaxMs: number;
  cleanTakeMaxMs: number;
  cleanTakeTargetMs: number;
};

// These limits deliberately separate protected setup from the clean take. A
// fixture audit and fictional-data preparation can safely take longer than the
// market-facing interaction without forcing the recording itself to be long.
export const DEFAULT_DIRECTED_CAPTURE_PHASE_BUDGET: DirectedCapturePhaseBudget = {
  protectedBootstrapMaxMs: 150_000,
  preflightMaxMs: 125_000,
  cleanTakeActionMaxMs: 22_000,
  cleanTakeMaxMs: 30_000,
  cleanTakeTargetMs: 15_000,
};

export type RecordingSessionLike = {
  id: string;
  websocketUrl?: string;
  debugUrl?: string;
  sessionViewerUrl?: string;
  liveViewUrl?: string;
};

export type RecordingExecutionLike = {
  completed: boolean;
  error?: string;
};

export class RecordingPassError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "RecordingPassError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function recordingActionBudgetMs(elapsedMs: number): number {
  const available = RECORDING_MAX_WALL_MS - Math.max(0, elapsedMs) - RELEASE_RESERVE_MS;
  if (available < MIN_ACTION_BUDGET_MS) {
    throw new RecordingPassError(
      "RECORDING_START_TOO_SLOW",
      "The recording login took too long to leave a safe walkthrough budget.",
    );
  }
  return Math.min(55_000, available);
}

export function recordingHoldMs(elapsedMs: number, targetMs = RECORDING_TARGET_MS): number {
  return Math.max(0, targetMs - Math.max(0, elapsedMs));
}

export function assertProfessionalRecordingDuration(durationSeconds: number): void {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < PROFESSIONAL_RECORDING_MIN_SECONDS ||
    durationSeconds > PROFESSIONAL_RECORDING_MAX_SECONDS
  ) {
    throw new RecordingPassError(
      "RECORDING_DURATION_OUT_OF_RANGE",
      `The finalized recording duration must be ${PROFESSIONAL_RECORDING_MIN_SECONDS}-${PROFESSIONAL_RECORDING_MAX_SECONDS} seconds.`,
    );
  }
}

export async function executeWithinBudget<Execution>(
  execute: (signal: AbortSignal) => Promise<Execution>,
  budgetMs: number,
  timeout?: { code: string; message: string },
): Promise<Execution> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutError = () =>
    new RecordingPassError(
      timeout?.code ?? "RECORDING_WALL_CLOCK_TIMEOUT",
      timeout?.message ?? "The walkthrough exceeded its safe recording time budget.",
    );
  const execution = Promise.resolve().then(() => execute(controller.signal));
  // A timed-out browser call can settle later; observe its rejection while the
  // abort signal prevents subsequent guarded actions.
  void execution.catch(() => undefined);
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          const error = timeoutError();
          controller.abort(error);
          reject(error);
        }, budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (!timedOut) controller.abort();
  }
}

export async function executeRecordingPass<
  Session extends RecordingSessionLike,
  Execution extends RecordingExecutionLike,
>(options: {
  startUrl: string;
  createSession: (startUrl: string) => Promise<Session>;
  releaseSession: (sessionId: string) => Promise<Session>;
  publishLiveSession: (session: Session) => Promise<void>;
  authenticate?: (websocketUrl: string) => Promise<void>;
  executeScenes: (websocketUrl: string, maxWallMs: number) => Promise<Execution>;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
}): Promise<{
  session: Session;
  releasedSession: Session;
  execution: Execution;
  elapsedMs: number;
}> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let session: Session | null = null;
  let released = false;

  try {
    session = await options.createSession(options.startUrl);
    const websocketUrl = session.websocketUrl;
    if (!websocketUrl) {
      throw new RecordingPassError(
        "MISSING_RECORDING_WEBSOCKET",
        "The recording session did not provide a browser connection.",
      );
    }
    await options.publishLiveSession(session);
    if (options.authenticate) await options.authenticate(websocketUrl);

    const actionBudget = recordingActionBudgetMs(now() - startedAt);
    const execution = await executeWithinBudget(
      () => options.executeScenes(websocketUrl, actionBudget),
      actionBudget,
    );
    if (!execution.completed) {
      throw new RecordingPassError(
        "CDP_ACTION_FAILED",
        execution.error ?? "Not every planned browser action completed.",
      );
    }

    const holdMs = recordingHoldMs(now() - startedAt);
    if (holdMs > 0) await sleep(holdMs);

    const releasedSession = await options.releaseSession(session.id);
    released = true;
    return {
      session,
      releasedSession,
      execution,
      elapsedMs: Math.max(0, now() - startedAt),
    };
  } catch (error) {
    if (session && !released) {
      await options.releaseSession(session.id).catch(() => undefined);
    }
    throw error;
  }
}
