import type { CdpAction, SceneExecutionResult } from "./steel-recorder.server.ts";
import { executeWithinBudget, recordingActionBudgetMs, recordingHoldMs, type RecordingSessionLike } from "./recording-pass.server.ts";

export type TakeMarkers = {
  sessionStartedAtMs: number;
  takeStartedAtMs: number;
  takeEndedAtMs: number;
};

export type CaptureEvent = {
  id: string;
  timestampMs: number;
  type: "navigation" | "click" | "type" | "scroll" | "wait" | "result" | "error";
  selector: string | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  cursor: { x: number; y: number } | null;
  expectedResult: string | null;
  resultVerified: boolean | null;
};

type ActionShape = CdpAction & { selector?: string; expected?: { selector?: string; text?: string; urlIncludes?: string } };

function captureType(type: CdpAction["type"]): CaptureEvent["type"] {
  if (type === "goto") return "navigation";
  if (type === "click" || type === "type" || type === "scroll" || type === "wait") return type;
  return "result";
}

export function captureEventsFromExecution(actions: CdpAction[], execution: SceneExecutionResult): CaptureEvent[] {
  return execution.diagnostics.map((diagnostic) => {
    const action = actions[diagnostic.index] as ActionShape | undefined;
    const expected = action?.expected;
    const expectedResult = expected?.text ?? expected?.selector ?? expected?.urlIncludes ?? null;
    return {
      id: `capture-${diagnostic.index + 1}`,
      timestampMs: diagnostic.startedAt ?? diagnostic.completedAt ?? 0,
      type: diagnostic.success ? captureType(diagnostic.type) : "error",
      selector: action && "selector" in action && typeof action.selector === "string" ? action.selector : null,
      boundingBox: diagnostic.boundingBox ?? null,
      cursor: diagnostic.cursor ?? null,
      expectedResult,
      resultVerified: diagnostic.success ? Boolean(expectedResult) : false,
    };
  });
}

export async function runSingleSessionDirectedCapture<Session extends RecordingSessionLike, Preflight>(options: {
  startUrl: string;
  createSession: (startUrl: string) => Promise<Session>;
  releaseSession: (sessionId: string) => Promise<Session>;
  publishLiveSession: (session: Session) => Promise<void>;
  authenticate?: (websocketUrl: string) => Promise<void>;
  preflight: (websocketUrl: string, maxWallMs: number) => Promise<Preflight>;
  executeFinalTake: (websocketUrl: string, maxWallMs: number, preflight: Preflight) => Promise<SceneExecutionResult>;
  finalActions: CdpAction[] | ((preflight: Preflight) => CdpAction[]);
  preflightMaxMs?: number;
  sleep?: (milliseconds: number) => Promise<unknown>;
  now?: () => number;
}): Promise<{ session: Session; releasedSession: Session; preflight: Preflight; markers: TakeMarkers; execution: SceneExecutionResult; telemetry: CaptureEvent[] }> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const sessionStartedAtMs = now();
  let session: Session | null = null;
  let released = false;
  try {
    session = await options.createSession(options.startUrl);
    if (!session.websocketUrl) throw new Error("The Steel session did not provide a browser connection.");
    const websocketUrl = session.websocketUrl;
    await options.publishLiveSession(session);
    if (options.authenticate) await options.authenticate(websocketUrl);
    const preflight = await executeWithinBudget(
      () => options.preflight(websocketUrl, options.preflightMaxMs ?? 20_000),
      options.preflightMaxMs ?? 20_000,
    );
    const takeStartedAtMs = now();
    const execution = await executeWithinBudget(
      () => options.executeFinalTake(websocketUrl, recordingActionBudgetMs(0), preflight),
      recordingActionBudgetMs(0),
    );
    if (!execution.completed) throw new Error(execution.error ?? "The directed final take did not complete.");
    const holdMs = recordingHoldMs(now() - takeStartedAtMs);
    if (holdMs > 0) await sleep(holdMs);
    const takeEndedAtMs = now();
    const releasedSession = await options.releaseSession(session.id);
    released = true;
    const markers = { sessionStartedAtMs, takeStartedAtMs, takeEndedAtMs };
    const finalActions =
      typeof options.finalActions === "function" ? options.finalActions(preflight) : options.finalActions;
    return { session, releasedSession, preflight, markers, execution, telemetry: captureEventsFromExecution(finalActions, execution) };
  } catch (error) {
    if (session && !released) await options.releaseSession(session.id).catch(() => undefined);
    throw error;
  }
}
