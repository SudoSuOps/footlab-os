import type {
  DatasetEvent,
  ConsentPurpose,
  DataClassification,
} from "./types.ts";
import { stableStringify } from "./canonical.ts";
import {
  validateDatasetEvent,
  DatasetEventValidationError,
} from "./validator.ts";
import { evaluateConsent, ConsentEvaluationError } from "./consent.ts";
import { createHash } from "node:crypto";

// ---------- public types ----------

export type DatasetExportErrorCode =
  | "invalid_request"
  | "invalid_event"
  | "duplicate_event_id"
  | "invalid_case_chain"
  | "case_subject_mismatch"
  | "case_classification_mismatch"
  | "future_event"
  | "consent_evaluation_failed";

export class DatasetExportError extends Error {
  readonly code: DatasetExportErrorCode;
  readonly cause?: unknown;

  constructor(code: DatasetExportErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "DatasetExportError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.freeze(this);
  }
}

export interface DatasetExportRequest {
  readonly purpose: ConsentPurpose;
  readonly evaluatedAt: string;
  readonly caseIds?: readonly string[];
}

export interface DatasetExportCaseManifest {
  readonly caseId: string;
  readonly subjectId: string;
  readonly dataClassification: DataClassification;
  readonly eventCount: number;
  readonly headEventId: string;
  readonly headContentHash: string;
  readonly consentDecision: "allowed" | "synthetic_exemption";
  readonly consentEvidenceEventIds: readonly string[];
}

export interface DatasetExportExcludedCase {
  readonly caseId: string;
  readonly subjectId: string;
  readonly dataClassification: "identified" | "pseudonymized";
  readonly reason: string;
  readonly consentEvidenceEventIds: readonly string[];
}

export interface DatasetExportManifest {
  readonly schemaVersion: "1.0.0";
  readonly format: "application/x-ndjson";
  readonly purpose: ConsentPurpose;
  readonly evaluatedAt: string;
  readonly eventCount: number;
  readonly caseCount: number;
  readonly excludedCaseCount: number;
  readonly artifactReferenceCount: number;
  readonly eventsSha256: string;
  readonly includedCases: readonly DatasetExportCaseManifest[];
  readonly excludedCases: readonly DatasetExportExcludedCase[];
}

export interface DatasetExportBundle {
  readonly manifest: DatasetExportManifest;
  readonly manifestJson: string;
  readonly manifestSha256: string;
  readonly eventsNdjson: string;
}

// ---------- internal helpers ----------

const CONSENT_PURPOSES: readonly string[] = [
  "care_operations",
  "care_team_sharing",
  "quality_improvement",
  "model_evaluation",
  "model_training",
  "research_publication",
];

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function fail(
  code: DatasetExportErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new DatasetExportError(code, message, cause);
}

function isPlainObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  if (
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof RegExp
  ) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDenseArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) {
    for (const key of Object.keys(value)) {
      const n = Number(key);
      if (!Number.isInteger(n) || n < 0 || n >= value.length) return false;
    }
    return true;
  }
  const seen = new Set<number>();
  for (const key of Object.keys(value)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 0 || n >= value.length || seen.has(n))
      return false;
    seen.add(n);
  }
  for (let i = 0; i < value.length; i++) {
    if (!seen.has(i)) return false;
  }
  return true;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isValidCaseId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  if (value !== value.trim()) return false;
  if (CONTROL_CHARS.test(value)) return false;
  return true;
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const obj = value as object;
  if (Object.isFrozen(obj)) return value;
  for (const key of Object.getOwnPropertyNames(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key]);
  }
  return Object.freeze(obj);
}

function sha256Utf8(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Convert a validated UTC RFC3339 timestamp to a BigInt nanosecond epoch key,
 * preserving all 1–9 fractional-second digits exactly (no millisecond-only
 * Date.parse).
 */
function toNanos(timestamp: string): bigint {
  const m = timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/,
  )!;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const fracRaw = m[7] ?? "";

  // Days since 1970-01-01 (Howard Hinnant's civil-from-days algorithm).
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month + (month > 2 ? -3 : 9);
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const days = era * 146097 + doe - 719468;

  const frac = (fracRaw + "000000000").slice(0, 9);
  const seconds =
    BigInt(days) * 86400n +
    BigInt(hour) * 3600n +
    BigInt(minute) * 60n +
    BigInt(second);
  return seconds * 1_000_000_000n + BigInt(frac);
}

function isValidUtcRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!ISO_UTC_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/,
  );
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > lastDay) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    return false;
  }
  return true;
}

// ---------- request validation ----------

interface ValidatedRequest {
  purpose: ConsentPurpose;
  evaluatedAt: string;
  /**
   * undefined → caseIds omitted → evaluate all cases.
   * [] → caseIds present but empty → evaluate zero cases.
   * non-empty → evaluate exactly those (validated, sorted) case ids.
   */
  caseIds: string[] | undefined;
  evaluatedAtNs: bigint;
}

function validateRequest(request: unknown): ValidatedRequest {
  if (!isPlainObject(request)) {
    fail("invalid_request", "request: must be a plain object");
  }
  const record = request as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = new Set(["purpose", "evaluatedAt"]);
  for (const key of keys) {
    if (!allowed.has(key) && key !== "caseIds") {
      fail("invalid_request", "request: unknown field");
    }
  }
  if (!("purpose" in record)) fail("invalid_request", "request: missing purpose");
  if (!("evaluatedAt" in record)) fail("invalid_request", "request: missing evaluatedAt");

  const purpose = record["purpose"];
  if (
    typeof purpose !== "string" ||
    !CONSENT_PURPOSES.includes(purpose)
  ) {
    fail("invalid_request", "purpose: must be a known consent purpose");
  }

  const evaluatedAt = record["evaluatedAt"];
  if (!isValidUtcRfc3339(evaluatedAt)) {
    fail("invalid_request", "evaluatedAt: must be a genuine UTC RFC3339 timestamp");
  }

  let caseIds: string[] | undefined;
  if ("caseIds" in record) {
    const caseIdsRaw = record["caseIds"];
    if (!Array.isArray(caseIdsRaw) || !isDenseArray(caseIdsRaw)) {
      fail("invalid_request", "caseIds: must be a dense array");
    }
    caseIds = [];
    const seen = new Set<string>();
    for (let i = 0; i < caseIdsRaw.length; i++) {
      const id = caseIdsRaw[i];
      if (!isValidCaseId(id)) {
        fail(
          "invalid_request",
          "caseIds: each entry must be a non-empty string without leading/trailing whitespace or control characters",
        );
      }
      if (seen.has(id)) {
        fail("invalid_request", "caseIds: duplicate id");
      }
      seen.add(id);
      caseIds.push(id);
    }
    caseIds.sort();
  }

  return {
    purpose: purpose as ConsentPurpose,
    evaluatedAt,
    caseIds,
    evaluatedAtNs: toNanos(evaluatedAt),
  };
}

// ---------- case chain verification ----------

interface CaseChain {
  caseId: string;
  subjectId: string;
  dataClassification: DataClassification;
  events: readonly DatasetEvent[];
  headEvent: DatasetEvent;
}

function verifyCaseChain(
  caseId: string,
  events: readonly DatasetEvent[],
): CaseChain {
  if (events.length === 0) {
    fail("invalid_case_chain", "case chain: no events");
  }

  const roots = events.filter((e) => e.integrity.previousEventHash === undefined);
  if (roots.length !== 1) {
    fail("invalid_case_chain", "case chain: must have exactly one root");
  }

  const subjectId = events[0].subjectId;
  for (const e of events) {
    if (e.subjectId !== subjectId) {
      fail("case_subject_mismatch", "case chain: subjectId mismatch");
    }
  }

  const dataClassification = events[0].dataClassification;
  for (const e of events) {
    if (e.dataClassification !== dataClassification) {
      fail("case_classification_mismatch", "case chain: dataClassification mismatch");
    }
  }

  // Build map: contentHash -> event (for link resolution)
  const hashToEvent = new Map<string, DatasetEvent>();
  for (const e of events) {
    hashToEvent.set(e.integrity.contentHash, e);
  }

  // Verify each non-root's previousEventHash references exactly one event
  const nonRoots = events.filter((e) => e.integrity.previousEventHash !== undefined);
  const incomingCount = new Map<string, number>();
  for (const e of nonRoots) {
    const prev = e.integrity.previousEventHash!;
    if (!hashToEvent.has(prev)) {
      fail("invalid_case_chain", "case chain: missing link");
    }
    incomingCount.set(prev, (incomingCount.get(prev) ?? 0) + 1);
  }
  for (const [, count] of incomingCount) {
    if (count > 1) {
      fail("invalid_case_chain", "case chain: fork detected");
    }
  }

  // Walk from root to head
  const chain: DatasetEvent[] = [roots[0]];
  const visited = new Set<string>([roots[0].eventId]);
  let current = roots[0];
  while (true) {
    const next = nonRoots.find(
      (e) => e.integrity.previousEventHash === current.integrity.contentHash,
    );
    if (next === undefined) break;
    if (visited.has(next.eventId)) {
      fail("invalid_case_chain", "case chain: cycle detected");
    }
    chain.push(next);
    visited.add(next.eventId);
    current = next;
  }

  if (chain.length !== events.length) {
    fail("invalid_case_chain", "case chain: disconnected segment");
  }

  return {
    caseId,
    subjectId,
    dataClassification,
    events: Object.freeze(chain),
    headEvent: chain[chain.length - 1],
  };
}

// ---------- main function ----------

export function buildDatasetExport(
  values: readonly unknown[],
  request: DatasetExportRequest,
): DatasetExportBundle {
  const req = validateRequest(request);

  if (!Array.isArray(values) || !isDenseArray(values)) {
    fail("invalid_event", "values: must be a dense array");
  }

  // Validate all events, check duplicates
  const validated: DatasetEvent[] = [];
  const eventIdSeen = new Set<string>();
  for (let i = 0; i < values.length; i++) {
    let event: DatasetEvent;
    try {
      event = validateDatasetEvent(values[i]);
    } catch (err) {
      if (err instanceof DatasetEventValidationError) {
        fail("invalid_event", `values[${i}]: dataset event failed validation`, err);
      }
      fail("invalid_event", `values[${i}]: dataset event failed validation`, err);
    }
    if (eventIdSeen.has(event.eventId)) {
      fail("duplicate_event_id", `values[${i}]: duplicate eventId`);
    }
    eventIdSeen.add(event.eventId);
    validated.push(event);
  }

  // Check future events (all events)
  for (let i = 0; i < validated.length; i++) {
    const ev = validated[i];
    if (toNanos(ev.occurredAt) > req.evaluatedAtNs) {
      fail("future_event", `values[${i}]: occurredAt is in the future`);
    }
    if (toNanos(ev.recordedAt) > req.evaluatedAtNs) {
      fail("future_event", `values[${i}]: recordedAt is in the future`);
    }
  }

  // Group by caseId
  const caseMap = new Map<string, DatasetEvent[]>();
  for (const ev of validated) {
    const existing = caseMap.get(ev.caseId);
    if (existing === undefined) {
      caseMap.set(ev.caseId, [ev]);
    } else {
      existing.push(ev);
    }
  }

  // Determine which cases to evaluate.
  // req.caseIds undefined → omitted → evaluate all cases.
  // req.caseIds present (possibly empty) → evaluate exactly those cases.
  let caseIdsToEvaluate: string[];
  if (req.caseIds === undefined) {
    caseIdsToEvaluate = Array.from(caseMap.keys()).sort();
  } else {
    for (const id of req.caseIds) {
      if (!caseMap.has(id)) {
        fail("invalid_request", "caseIds: unknown caseId");
      }
    }
    caseIdsToEvaluate = req.caseIds; // already sorted
  }

  // Verify chains for the evaluated cases only (artifact isolation:
  // unselected case chains are never reconstructed or exposed).
  const allChains = new Map<string, CaseChain>();
  for (const caseId of caseIdsToEvaluate) {
    allChains.set(caseId, verifyCaseChain(caseId, caseMap.get(caseId)!));
  }

  // Consent gating and selection
  const includedCases: DatasetExportCaseManifest[] = [];
  const excludedCases: DatasetExportExcludedCase[] = [];
  const includedEventsByCase = new Map<string, readonly DatasetEvent[]>();
  let artifactReferenceCount = 0;

  for (const caseId of caseIdsToEvaluate) {
    const chain = allChains.get(caseId)!;
    const { events, subjectId, dataClassification } = chain;

    if (dataClassification === "synthetic") {
      const result = evaluateConsent(events, {
        subjectId,
        dataClassification,
        evaluatedAt: req.evaluatedAt,
      });
      if (result.decision === "synthetic_exemption") {
        includedCases.push({
          caseId,
          subjectId,
          dataClassification,
          eventCount: events.length,
          headEventId: chain.headEvent.eventId,
          headContentHash: chain.headEvent.integrity.contentHash,
          consentDecision: "synthetic_exemption",
          consentEvidenceEventIds: Object.freeze([...result.evidenceEventIds]),
        });
        includedEventsByCase.set(caseId, events);
        for (const ev of events) {
          artifactReferenceCount += ev.artifactReferences.length;
        }
      }
    } else {
      try {
        // Consent evidence scope: the complete validated event collection,
        // not only the current case chain. evaluateConsent filters by
        // subjectId and event type internally.
        const result = evaluateConsent(validated, {
          subjectId,
          dataClassification,
          purpose: req.purpose,
          evaluatedAt: req.evaluatedAt,
        });
        if (result.decision === "allowed") {
          includedCases.push({
            caseId,
            subjectId,
            dataClassification,
            eventCount: events.length,
            headEventId: chain.headEvent.eventId,
            headContentHash: chain.headEvent.integrity.contentHash,
            consentDecision: "allowed",
            consentEvidenceEventIds: Object.freeze([...result.evidenceEventIds]),
          });
          includedEventsByCase.set(caseId, events);
          for (const ev of events) {
            artifactReferenceCount += ev.artifactReferences.length;
          }
        } else {
          excludedCases.push({
            caseId,
            subjectId,
            dataClassification: dataClassification as "identified" | "pseudonymized",
            reason: result.reason,
            consentEvidenceEventIds: Object.freeze([...result.evidenceEventIds]),
          });
        }
      } catch (err) {
        if (err instanceof ConsentEvaluationError) {
          fail("consent_evaluation_failed", "consent evaluation failed", err);
        }
        fail("consent_evaluation_failed", "consent evaluation failed", err);
      }
    }
  }

  includedCases.sort((a, b) =>
    a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0,
  );
  excludedCases.sort((a, b) =>
    a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0,
  );

  // Build NDJSON
  const ndjsonLines: string[] = [];
  for (const caseId of caseIdsToEvaluate) {
    const events = includedEventsByCase.get(caseId);
    if (events === undefined) continue;
    for (const ev of events) {
      ndjsonLines.push(stableStringify(ev));
    }
  }
  const eventsNdjson =
    ndjsonLines.length > 0 ? ndjsonLines.join("\n") + "\n" : "";

  const totalIncludedEvents = Array.from(includedEventsByCase.values()).reduce(
    (sum, evts) => sum + evts.length,
    0,
  );

  const manifest = {
    schemaVersion: "1.0.0" as const,
    format: "application/x-ndjson" as const,
    purpose: req.purpose,
    evaluatedAt: req.evaluatedAt,
    eventCount: totalIncludedEvents,
    caseCount: includedCases.length,
    excludedCaseCount: excludedCases.length,
    artifactReferenceCount,
    eventsSha256: sha256Utf8(eventsNdjson),
    includedCases,
    excludedCases,
  };

  const manifestJson = stableStringify(manifest);
  const manifestSha256 = sha256Utf8(manifestJson);

  return deepFreeze({
    manifest,
    manifestJson,
    manifestSha256,
    eventsNdjson,
  }) as DatasetExportBundle;
}
