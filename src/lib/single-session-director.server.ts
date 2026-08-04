import type { CdpAction, SceneExecutionResult } from "./steel-recorder.server.ts";
import {
  DEFAULT_DIRECTED_CAPTURE_PHASE_BUDGET,
  executeWithinBudget,
  recordingHoldMs,
  type DirectedCapturePhaseBudget,
  type RecordingSessionLike,
} from "./recording-pass.server.ts";

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

type ActionShape = CdpAction & {
  selector?: string;
  expected?: { selector?: string; text?: string; urlIncludes?: string };
};

function captureType(type: CdpAction["type"]): CaptureEvent["type"] {
  if (type === "goto") return "navigation";
  if (type === "click" || type === "type" || type === "scroll" || type === "wait") return type;
  return "result";
}

export function captureEventsFromExecution(
  actions: CdpAction[],
  execution: SceneExecutionResult,
): CaptureEvent[] {
  return execution.diagnostics.map((diagnostic) => {
    const action = actions[diagnostic.index] as ActionShape | undefined;
    const expected = action?.expected;
    const expectedResult = expected?.text ?? expected?.selector ?? expected?.urlIncludes ?? null;
    return {
      id: `capture-${diagnostic.index + 1}`,
      timestampMs: diagnostic.startedAt ?? diagnostic.completedAt ?? 0,
      type: diagnostic.success ? captureType(diagnostic.type) : "error",
      selector:
        action && "selector" in action && typeof action.selector === "string"
          ? action.selector
          : null,
      boundingBox: diagnostic.boundingBox ?? null,
      cursor: diagnostic.cursor ?? null,
      expectedResult,
      resultVerified: diagnostic.success ? Boolean(expectedResult) : false,
    };
  });
}

export async function runSingleSessionDirectedCapture<
  Session extends RecordingSessionLike,
  Preflight,
  Verification = unknown,
  LiveAudit = unknown,
  PrivacyShield = unknown,
>(options: {
  sessionBootstrapUrl: string;
  productLoginUrl?: string;
  productStartUrl?: string;
  createSession: (sessionBootstrapUrl: string) => Promise<Session>;
  releaseSession: (sessionId: string) => Promise<Session>;
  publishLiveSession: (session: Session) => Promise<void>;
  installPrivacyShield?: (websocketUrl: string) => Promise<PrivacyShield>;
  removePrivacyShield?: (
    websocketUrl: string,
    preflight: Preflight,
    privacyShield: PrivacyShield | undefined,
  ) => Promise<void>;
  assertPrivacyShield?: (websocketUrl: string, checkpoint: string) => Promise<void>;
  authenticate?: (
    websocketUrl: string,
    productUrls: { productLoginUrl?: string; productStartUrl?: string },
  ) => Promise<void>;
  liveAccountSafetyAudit?: (websocketUrl: string) => Promise<LiveAudit>;
  assertMutationAllowed?: (audit: LiveAudit | undefined) => void;
  onProtectedBootstrapStage?: (
    stage: "install-privacy-shield" | "verify-initial-shield" | "authenticate" | "account-audit",
  ) => Promise<void> | void;
  preflight: (
    websocketUrl: string,
    maxWallMs: number,
    liveAccountSafetyAudit: LiveAudit | undefined,
    signal: AbortSignal,
  ) => Promise<Preflight>;
  executeFinalTake: (
    websocketUrl: string,
    maxWallMs: number,
    preflight: Preflight,
  ) => Promise<SceneExecutionResult>;
  verifyFinalTake?: (
    websocketUrl: string,
    preflight: Preflight,
    execution: SceneExecutionResult,
  ) => Promise<Verification>;
  finalActions: CdpAction[] | ((preflight: Preflight) => CdpAction[]);
  phaseBudget?: Partial<DirectedCapturePhaseBudget>;
  sleep?: (milliseconds: number) => Promise<unknown>;
  now?: () => number;
}): Promise<{
  session: Session;
  releasedSession: Session;
  preflight: Preflight;
  markers: TakeMarkers;
  execution: SceneExecutionResult;
  verification: Verification | undefined;
  liveAccountSafetyAudit: LiveAudit | undefined;
  telemetry: CaptureEvent[];
}> {
  const now = options.now ?? (() => performance.now());
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const sessionStartedAtMs = now();
  const phaseBudget = { ...DEFAULT_DIRECTED_CAPTURE_PHASE_BUDGET, ...options.phaseBudget };
  let session: Session | null = null;
  let released = false;
  let privacyShield: PrivacyShield | undefined;
  try {
    session = await options.createSession(options.sessionBootstrapUrl);
    if (!session.websocketUrl)
      throw new Error("The Steel session did not provide a browser connection.");
    const websocketUrl = session.websocketUrl;
    await options.publishLiveSession(session);
    const liveAccountSafetyAudit = await executeWithinBudget(
      async () => {
        if (options.installPrivacyShield) {
          await options.onProtectedBootstrapStage?.("install-privacy-shield");
          privacyShield = await options.installPrivacyShield(websocketUrl);
        }
        if (options.assertPrivacyShield) {
          await options.onProtectedBootstrapStage?.("verify-initial-shield");
          await options.assertPrivacyShield(websocketUrl, "after-session-creation");
          await options.assertPrivacyShield(websocketUrl, "before-login-navigation");
        }
        if (options.authenticate) {
          await options.onProtectedBootstrapStage?.("authenticate");
          await options.authenticate(websocketUrl, {
            productLoginUrl: options.productLoginUrl,
            productStartUrl: options.productStartUrl,
          });
        }
        if (options.assertPrivacyShield) {
          await options.onProtectedBootstrapStage?.("verify-initial-shield");
          await options.assertPrivacyShield(websocketUrl, "before-account-audit");
        }
        await options.onProtectedBootstrapStage?.("account-audit");
        const liveAccountSafetyAudit = options.liveAccountSafetyAudit
          ? await options.liveAccountSafetyAudit(websocketUrl)
          : undefined;
        options.assertMutationAllowed?.(liveAccountSafetyAudit);
        return liveAccountSafetyAudit;
      },
      phaseBudget.protectedBootstrapMaxMs,
      {
        code: "PROTECTED_BOOTSTRAP_TIMEOUT",
        message: `Protected bootstrap exceeded its safe session budget before fixture preparation. (budget-ms=${phaseBudget.protectedBootstrapMaxMs})`,
      },
    );
    if (options.assertPrivacyShield)
      await options.assertPrivacyShield(websocketUrl, "before-fixture-discovery");
    const preflight = await executeWithinBudget(
      (signal) =>
        options.preflight(websocketUrl, phaseBudget.preflightMaxMs, liveAccountSafetyAudit, signal),
      phaseBudget.preflightMaxMs,
      {
        code: "PROTECTED_PREFLIGHT_TIMEOUT",
        message: "Protected fixture preparation exceeded its safe setup budget.",
      },
    );
    if (options.removePrivacyShield)
      await options.removePrivacyShield(websocketUrl, preflight, privacyShield);
    const takeStartedAtMs = now();
    const { execution, verification } = await executeWithinBudget(
      async () => {
        const execution = await executeWithinBudget(
          () => options.executeFinalTake(websocketUrl, phaseBudget.cleanTakeActionMaxMs, preflight),
          phaseBudget.cleanTakeActionMaxMs,
          {
            code: "CLEAN_TAKE_ACTION_TIMEOUT",
            message: "The clean feature interaction exceeded its safe take budget.",
          },
        );
        if (!execution.completed)
          throw new Error(execution.error ?? "The directed final take did not complete.");
        const verification = options.verifyFinalTake
          ? await options.verifyFinalTake(websocketUrl, preflight, execution)
          : undefined;
        const holdMs = recordingHoldMs(now() - takeStartedAtMs, phaseBudget.cleanTakeTargetMs);
        if (holdMs > 0) await sleep(holdMs);
        return { execution, verification };
      },
      phaseBudget.cleanTakeMaxMs,
      {
        code: "CLEAN_TAKE_TIMEOUT",
        message: "The clean feature take exceeded its safe duration budget.",
      },
    );
    const takeEndedAtMs = now();
    const releasedSession = await options.releaseSession(session.id);
    released = true;
    const markers = { sessionStartedAtMs, takeStartedAtMs, takeEndedAtMs };
    const finalActions =
      typeof options.finalActions === "function"
        ? options.finalActions(preflight)
        : options.finalActions;
    return {
      session,
      releasedSession,
      preflight,
      liveAccountSafetyAudit,
      markers,
      execution,
      verification,
      telemetry: captureEventsFromExecution(finalActions, execution),
    };
  } catch (error) {
    if (session && !released) await options.releaseSession(session.id).catch(() => undefined);
    throw error;
  }
}
