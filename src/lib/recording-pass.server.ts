export const PROFESSIONAL_RECORDING_MIN_SECONDS = 45;
export const PROFESSIONAL_RECORDING_MAX_SECONDS = 69;
export const RECORDING_TARGET_MS = 50_000;
export const RECORDING_MAX_WALL_MS = 65_000;

const RELEASE_RESERVE_MS = 3_000;
const MIN_ACTION_BUDGET_MS = 8_000;

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

export function recordingHoldMs(elapsedMs: number): number {
  return Math.max(0, RECORDING_TARGET_MS - Math.max(0, elapsedMs));
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
  execute: () => Promise<Execution>,
  budgetMs: number,
): Promise<Execution> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execute(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new RecordingPassError(
                "RECORDING_WALL_CLOCK_TIMEOUT",
                "The walkthrough exceeded its safe recording time budget.",
              ),
            ),
          budgetMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
