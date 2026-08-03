import type {
  DemoEventRecord,
  DirectorArtifactRecord,
  Json,
} from "../integrations/appwrite/types.ts";
import type { WiseDemoRepository } from "../integrations/appwrite/repository.server.ts";
import {
  classifyAuthenticatedMap,
  serializeLiveAccountSafetyAudit,
  type LiveAccountSafetyAudit,
} from "./live-account-safety.server.ts";

type PrivacyCheckpoint = {
  checkpoint: string;
  active: boolean;
  repaired: boolean;
  timestampMs: number;
};

type FailureDiagnosticRepository = {
  getDemo: (demoId: string) => Promise<{
    id: string;
    project_id: string;
    status: string;
    steel_session_id: string | null;
    error_code: string | null;
  } | null>;
  listDirectorArtifacts: (projectId: string) => Promise<DirectorArtifactRecord[]>;
  listDemoEvents: (demoId: string) => Promise<DemoEventRecord[]>;
};

type JsonRecord = Record<string, Json | undefined>;

function safeMismatchCategory(value: string | null): string | null {
  return [
    "canonical-format-mismatch",
    "confirmed-different-account",
    "identity-source-unavailable",
  ].includes(value ?? "")
    ? value
    : null;
}

function safeInventoryRequestStatus(value: string | null): string | null {
  return [
    "success",
    "unauthorized",
    "forbidden",
    "invalid-query",
    "not-found",
    "rate-limited",
    "server-error",
    "network-error",
    "invalid-response",
  ].includes(value ?? "")
    ? value
    : null;
}

function safeInventoryHttpStatusClass(value: string | null): string | null {
  return ["2xx", "4xx", "5xx", "network", "unknown"].includes(value ?? "") ? value : null;
}

export function createDirectedFailureDiagnosticPersister(input: {
  repository: Pick<WiseDemoRepository, "createDirectorArtifact">;
  projectId: string;
  demoId: string;
  auditCacheKey: string;
  authenticatedMapState: ReturnType<typeof classifyAuthenticatedMap>;
}) {
  const checkpoints: PrivacyCheckpoint[] = [];
  const identityAttempts: Array<{
    source: string;
    sourceAvailable: boolean;
    authenticatedAccountConfirmed: boolean;
    confidence: number;
    mismatchCategory: string | null;
  }> = [];
  let checkpointRevision = 0;
  let identityRevision = 0;
  let auditRevision = 0;
  const cacheKey = (suffix: string) =>
    `${input.auditCacheKey.slice(0, 127 - suffix.length - 1)}:${suffix}`;
  const safelyPersist = async (artifact: {
    artifactKind:
      "privacy-shield-checkpoints" | "identity-source-attempts" | "live-account-safety-audit";
    cacheKey: string;
    payload: Json;
    revision: number;
  }) => {
    await input.repository
      .createDirectorArtifact({
        project_id: input.projectId,
        demo_id: input.demoId,
        artifact_kind: artifact.artifactKind,
        cache_key: artifact.cacheKey,
        status: "ready",
        payload_json: artifact.payload,
        expires_at: null,
        provider: "wisedemo",
        model: null,
        duration_ms: null,
        revision: artifact.revision,
        failure_reason: null,
      })
      .catch(() => undefined);
  };
  return {
    checkpoints,
    async persistCheckpoint(result: PrivacyCheckpoint) {
      checkpoints.push(result);
      checkpointRevision += 1;
      await safelyPersist({
        artifactKind: "privacy-shield-checkpoints",
        cacheKey: cacheKey("privacy-shield-checkpoints"),
        payload: checkpoints.slice(-32).map(({ checkpoint, active, repaired, timestampMs }) => ({
          checkpoint: checkpoint.slice(0, 96),
          active: active === true,
          repaired: repaired === true,
          timestampMs,
        })) as Json,
        revision: checkpointRevision,
      });
    },
    async persistIdentityAttempt(evidence: {
      source: string;
      sourceAvailable: boolean;
      authenticatedAccountConfirmed: boolean;
      confidence: number;
      mismatchCategory: string | null;
    }) {
      identityAttempts.push({
        source: evidence.source.slice(0, 64),
        sourceAvailable: evidence.sourceAvailable === true,
        authenticatedAccountConfirmed: evidence.authenticatedAccountConfirmed === true,
        confidence: Number.isFinite(evidence.confidence) ? evidence.confidence : 0,
        mismatchCategory: safeMismatchCategory(evidence.mismatchCategory),
      });
      identityRevision += 1;
      await safelyPersist({
        artifactKind: "identity-source-attempts",
        cacheKey: cacheKey("identity-source-attempts"),
        payload: identityAttempts.slice(-8) as unknown as Json,
        revision: identityRevision,
      });
    },
    async persistAudit(audit: LiveAccountSafetyAudit) {
      auditRevision += 1;
      await safelyPersist({
        artifactKind: "live-account-safety-audit",
        cacheKey: input.auditCacheKey,
        payload: {
          authenticatedMapState: input.authenticatedMapState,
          audit: serializeLiveAccountSafetyAudit(audit),
        } as Json,
        revision: auditRevision,
      });
    },
  };
}

function asRecord(value: Json | null | undefined): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asBoolean(value: Json | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: Json | undefined, limit = 240): string | null {
  return typeof value === "string" ? value.slice(0, limit) : null;
}

function masked(value: string | null): string | null {
  return value && value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : null;
}

function safeMessage(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi, "[redacted-id]")
    .slice(0, 240);
}

function latestArtifact(
  artifacts: DirectorArtifactRecord[],
  demoId: string,
  artifactKind: DirectorArtifactRecord["artifact_kind"],
): DirectorArtifactRecord | null {
  return (
    artifacts
      .filter((artifact) => artifact.demo_id === demoId && artifact.artifact_kind === artifactKind)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null
  );
}

export async function readDirectedFailureDiagnostics(
  repository: FailureDiagnosticRepository,
  demoId: string,
) {
  const demo = await repository.getDemo(demoId);
  if (!demo) throw new Error("Directed demo was not found.");
  const [artifacts, events] = await Promise.all([
    repository.listDirectorArtifacts(demo.project_id),
    repository.listDemoEvents(demo.id),
  ]);
  const auditArtifact = latestArtifact(artifacts, demo.id, "live-account-safety-audit");
  const checkpointArtifact = latestArtifact(artifacts, demo.id, "privacy-shield-checkpoints");
  const identityArtifact = latestArtifact(artifacts, demo.id, "identity-source-attempts");
  const auditEnvelope = asRecord(auditArtifact?.payload_json);
  const audit = asRecord(auditEnvelope.audit);
  const identity = asRecord(audit.identityEvidence);
  const inventoryRequest = asRecord(audit.inventoryRequestEvidence);
  const checkpoints = Array.isArray(checkpointArtifact?.payload_json)
    ? checkpointArtifact.payload_json.slice(0, 32).map((item, index) => {
        const checkpoint = asRecord(item);
        return {
          order: index + 1,
          checkpoint: asString(checkpoint.checkpoint, 96),
          active: asBoolean(checkpoint.active),
          repaired: asBoolean(checkpoint.repaired),
          timestampMs: asNumber(checkpoint.timestampMs),
        };
      })
    : [];
  const identityAttempts = Array.isArray(identityArtifact?.payload_json)
    ? identityArtifact.payload_json.slice(0, 8).map((item) => {
        const attempt = asRecord(item);
        return {
          source: asString(attempt.source, 64),
          sourceAvailable: asBoolean(attempt.sourceAvailable),
          authenticatedAccountConfirmed: asBoolean(attempt.authenticatedAccountConfirmed),
          confidence: asNumber(attempt.confidence),
          mismatchCategory: safeMismatchCategory(asString(attempt.mismatchCategory, 64)),
        };
      })
    : [];
  return {
    demo: {
      id: masked(demo.id),
      steelSessionId: masked(demo.steel_session_id),
      status: demo.status,
      errorCode: asString(demo.error_code, 96),
    },
    audit: {
      artifactPresent: Boolean(auditArtifact),
      status: asString(audit.status, 32),
      mode: asString(audit.mode, 32),
      authenticatedAccountConfirmed: asBoolean(audit.authenticatedAccountConfirmed),
      identityEvidence: {
        source: asString(identity.source, 64),
        sourceAvailable: asBoolean(identity.sourceAvailable),
        authenticatedAccountConfirmed: asBoolean(identity.authenticatedAccountConfirmed),
        confidence: asNumber(identity.confidence),
        mismatchCategory: safeMismatchCategory(asString(identity.mismatchCategory, 64)),
      },
      inventoryEvidenceSources: Array.isArray(audit.inventoryEvidenceSources)
        ? audit.inventoryEvidenceSources
            .map((source) => {
              const value = asString(source, 64);
              return value && /^[a-z-]{1,64}$/.test(value) ? value : null;
            })
            .filter((source): source is string => source !== null)
            .slice(0, 8)
        : [],
      inventoryRequestEvidence: {
        source:
          asString(inventoryRequest.source, 64) === "appwrite-resumes" ? "appwrite-resumes" : null,
        sourceAvailable: asBoolean(inventoryRequest.sourceAvailable),
        inventoryResolved: asBoolean(inventoryRequest.inventoryResolved),
        countEstablished: asBoolean(inventoryRequest.countEstablished),
        requestStatus: safeInventoryRequestStatus(asString(inventoryRequest.requestStatus, 64)),
        httpStatusClass: safeInventoryHttpStatusClass(
          asString(inventoryRequest.httpStatusClass, 16),
        ),
        domFallbackResolved:
          typeof inventoryRequest.domFallbackResolved === "boolean"
            ? inventoryRequest.domFallbackResolved
            : null,
      },
      totalResumeCount: asNumber(audit.totalResumeCount),
      fixtureResumeCount: asNumber(audit.fixtureResumeCount),
      nonFixtureResumeCount: asNumber(audit.nonFixtureResumeCount),
      fixtureIsolated: asBoolean(audit.fixtureIsolated),
      privacyShieldActive: asBoolean(audit.privacyShieldActive),
      mutationScopeLockedToFixture: asBoolean(audit.mutationScopeLockedToFixture),
      personalDataMarkersFound: asBoolean(audit.personalDataMarkersFound),
      reasons: Array.isArray(audit.reasons)
        ? audit.reasons.map((reason) => safeMessage(asString(reason))).filter(Boolean)
        : [],
    },
    checkpoints: {
      artifactPresent: Boolean(checkpointArtifact),
      items: checkpoints,
    },
    identityAttempts,
    events: events.slice(0, 100).map((event, index) => ({
      order: index + 1,
      step: event.step.slice(0, 96),
      level: event.level,
      message: safeMessage(event.message),
    })),
  };
}
