import type { Id, ISODateTime } from "../../domain/src/index";
import type {
  ConsentEvidence,
  ConsentPurpose,
  DataClassification,
  DatasetEvent,
} from "./types.ts";

export class ConsentEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsentEvaluationError";
  }
}

export interface ConsentRequest {
  readonly subjectId: Id;
  readonly dataClassification: DataClassification;
  readonly purpose?: ConsentPurpose;
  readonly evaluatedAt: ISODateTime;
}

const CLASSIFICATIONS: readonly string[] = [
  "synthetic",
  "identified",
  "pseudonymized",
];

const CONSENT_PURPOSES: readonly string[] = [
  "care_operations",
  "care_team_sharing",
  "quality_improvement",
  "model_evaluation",
  "model_training",
  "research_publication",
];

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/** Internal error for payload violations; message never names payload values. */
class ConsentPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsentPayloadError";
  }
}

function fail(message: string): never {
  throw new ConsentEvaluationError(message);
}

function failPayload(field: string, detail: string): never {
  throw new ConsentPayloadError(
    `consent payload: ${field} ${detail} (see the consent event payload schema)`,
  );
}

/** Internal strict-string check for payload fields; errors never name values. */
function validateStrictPayloadString(value: unknown, field: string): string {
  if (typeof value !== "string") failPayload(field, "must be a string");
  if (value.length === 0) failPayload(field, "must be a non-empty string");
  if (value !== value.trim()) {
    failPayload(field, "must not contain leading or trailing whitespace");
  }
  if (CONTROL_CHARS.test(value)) {
    failPayload(field, "must not contain control characters");
  }
  return value;
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

function validateStrictId(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field}: must be a string`);
  if (value.length === 0) fail(`${field}: must be a non-empty string`);
  if (value !== value.trim()) {
    fail(`${field}: must not contain leading or trailing whitespace`);
  }
  if (CONTROL_CHARS.test(value)) {
    fail(`${field}: must not contain control characters`);
  }
  return value;
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

/**
 * Convert a validated (genuine) UTC RFC3339 timestamp into an internal BigInt
 * nanosecond epoch key, preserving up to 9 fractional-second digits. Using a
 * manual civil-date computation (not Date.parse) avoids JavaScript's
 * millisecond-only rounding so ordering stays exact below the millisecond.
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

  // Days since 1970-01-01 (Howard Hinnant's civil-from-days, inverted to
  // days-from-civil).
  const y = (month <= 2 ? year - 1 : year);
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

interface GrantPayload {
  readonly consentId: string;
  readonly purpose: string;
  readonly expiresAtNanos?: bigint;
}

function validateGrantPayload(payload: unknown, occurredAtNanos: bigint): GrantPayload {
  if (!isPlainObject(payload)) {
    failPayload("payload", "must be an exact plain object");
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = [
    "consentId",
    "purpose",
    ...(Object.prototype.hasOwnProperty.call(record, "expiresAt") ? ["expiresAt"] : []),
  ];
  const expectedSet = new Set(expected);
  const sameShape =
    keys.length === expected.length && keys.every((key) => expectedSet.has(key));
  if (!sameShape) {
    failPayload("payload", "must contain exactly the fields 'consentId', 'purpose' and optional 'expiresAt'");
  }
  const consentId = validateStrictPayloadString(record.consentId, "consentId");
  const purpose = record.purpose;
  if (typeof purpose !== "string" || !CONSENT_PURPOSES.includes(purpose)) {
    failPayload("purpose", "must be a known consent purpose");
  }
  let expiresAtNanos: bigint | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "expiresAt")) {
    const rawExpiresAt = record.expiresAt;
    if (typeof rawExpiresAt !== "string" || !isValidUtcRfc3339(rawExpiresAt)) {
      failPayload(
        "payload.expiresAt",
        "must be a UTC RFC3339 timestamp ending in Z",
      );
    }
    expiresAtNanos = toNanos(rawExpiresAt);
    if (expiresAtNanos <= occurredAtNanos) {
      failPayload(
        "payload.expiresAt",
        "must be strictly after the grant's occurredAt",
      );
    }
  }
  return { consentId, purpose, expiresAtNanos };
}

interface RevocationPayload {
  readonly consentId: string;
  readonly reason: string;
}

function validateRevocationPayload(payload: unknown): RevocationPayload {
  if (!isPlainObject(payload)) {
    failPayload("payload", "must be an exact plain object");
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    (keys.length !== 2 ||
      !Object.prototype.hasOwnProperty.call(record, "consentId")) ||
    !Object.prototype.hasOwnProperty.call(record, "reason")
  ) {
    failPayload(
      "payload",
      "must contain exactly the fields 'consentId' and 'reason'",
    );
  }
  const consentId = validateStrictPayloadString(record.consentId, "consentId");
  const reason = validateStrictPayloadString(record.reason, "reason");
  return { consentId, reason };
}

type ConsentEventType = "grant" | "revoke";

interface ConsentEvent {
  readonly index: number;
  readonly eventId: string;
  readonly occurredAtNanos: bigint;
  readonly recordedAtNanos: bigint;
  readonly type: ConsentEventType;
  grant?: GrantPayload;
  revocation?: RevocationPayload;
}

interface GrantRecord {
  readonly consentId: string;
  readonly purpose: string;
  readonly eventId: string;
  readonly occurredAtNanos: bigint;
  readonly expiresAtNanos?: bigint;
  revokedAtNanos?: bigint;
  revocationEventId?: string;
}

const GRANT_ORDER_RANK = 0;
const REVOKE_ORDER_RANK = 1;

export function evaluateConsent(
  events: readonly DatasetEvent[],
  request: ConsentRequest,
): ConsentEvidence {
  if (!Array.isArray(events)) {
    fail("events: must be an array of dataset events");
  }

  if (!isPlainObject(request)) {
    fail("request: must be a plain object");
  }
  const requestRecord = request as unknown as Record<string, unknown>;

  // Rule: reject unknown request fields. Allowed set is exactly:
  // subjectId, dataClassification, purpose, evaluatedAt.
  const ALLOWED_REQUEST_FIELDS: readonly string[] = [
    "subjectId",
    "dataClassification",
    "purpose",
    "evaluatedAt",
  ];
  for (const key of Object.keys(requestRecord)) {
    if (!ALLOWED_REQUEST_FIELDS.includes(key)) {
      fail(
        `request: unknown field '${key}' — allowed fields are exactly: subjectId, dataClassification, purpose, evaluatedAt`,
      );
    }
  }

  const subjectId = validateStrictId(requestRecord.subjectId, "subjectId");
  const dataClassification = requestRecord.dataClassification;
  if (
    typeof dataClassification !== "string" ||
    !CLASSIFICATIONS.includes(dataClassification)
  ) {
    fail(
      "dataClassification: must be a known classification ('synthetic', 'identified', 'pseudonymized')",
    );
  }

  let purpose: string | undefined;
  if (Object.prototype.hasOwnProperty.call(requestRecord, "purpose")) {
    const rawPurpose = requestRecord.purpose;
    if (
      typeof rawPurpose !== "string" ||
      !CONSENT_PURPOSES.includes(rawPurpose)
    ) {
      fail("purpose: must be a known consent purpose when present");
    }
    purpose = rawPurpose;
  }

  const evaluatedAt = requestRecord.evaluatedAt;
  if (!isValidUtcRfc3339(evaluatedAt)) {
    fail("evaluatedAt: must be a genuine UTC RFC3339 timestamp ending in Z");
  }
  const evaluatedAtNanos = toNanos(evaluatedAt);

  if (dataClassification === "synthetic") {
    if (!subjectId.startsWith("SYN-")) {
      fail("subjectId: synthetic requests must use a SYN- prefixed subjectId");
    }
    if (purpose !== undefined) {
      fail("purpose: synthetic requests must not specify a purpose");
    }
    return {
      decision: "synthetic_exemption",
      evaluatedAt,
      evidenceEventIds: [],
      reason: "synthetic_data_exempt",
    };
  }

  if (purpose === undefined) {
    fail("purpose: identified and pseudonymized requests require a purpose");
  }

  const seenEventIds = new Set<string>();
  const subjectEvents: ConsentEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const raw = events[i] as unknown;
    if (!isPlainObject(raw)) {
      fail(`events[${i}]: must be a dataset event object`);
    }
    const record = raw as Record<string, unknown>;

    // Ordering per the repair spec:
    // 1. First identify eventType.
    const eventType = record.eventType;
    if (eventType !== "consent_granted" && eventType !== "consent_revoked") {
      continue;
    }

    // 2. Then require exact matching subjectId. Wrong-subject events are
    //    ignored entirely — they cannot poison the evaluation through
    //    duplicate IDs or malformed payloads.
    const rawSubjectId = record.subjectId;
    if (typeof rawSubjectId !== "string" || rawSubjectId !== subjectId) {
      continue;
    }

    // 3. Then validate occurredAt (valid timestamp).
    const occurredAt = record.occurredAt;
    if (typeof occurredAt !== "string" || !isValidUtcRfc3339(occurredAt)) {
      fail(
        `events[${i}].occurredAt: must be a genuine UTC RFC3339 timestamp ending in Z`,
      );
    }
    const occurredAtNanos = toNanos(occurredAt);

    // 4. Ignore events occurring after evaluatedAt (future events are skipped
    //    before any other validation, so a future event with a valid
    //    occurredAt but an otherwise malformed payload is silently ignored).
    if (occurredAtNanos > evaluatedAtNanos) {
      continue;
    }

    // 5. Only now: validate eventId, recordedAt, payload, and duplicates.
    const eventId = validateStrictId(record.eventId, `events[${i}].eventId`);
    if (seenEventIds.has(eventId)) {
      fail("duplicate eventId across the subject consent timeline");
    }
    seenEventIds.add(eventId);

    // recordedAt is required and must be valid; do not fall back to occurredAt.
    if (!Object.prototype.hasOwnProperty.call(record, "recordedAt")) {
      fail(`events[${i}].recordedAt: is required`);
    }
    const rawRecordedAt: unknown = record.recordedAt;
    if (
      typeof rawRecordedAt !== "string" ||
      !isValidUtcRfc3339(rawRecordedAt)
    ) {
      fail(
        `events[${i}].recordedAt: must be a genuine UTC RFC3339 timestamp ending in Z`,
      );
    }
    const recordedAtNanos = toNanos(rawRecordedAt);

    const type: ConsentEventType =
      eventType === "consent_granted" ? "grant" : "revoke";
    const event: ConsentEvent = {
      index: i,
      eventId,
      occurredAtNanos,
      recordedAtNanos,
      type,
    };

    try {
      if (type === "grant") {
        event.grant = validateGrantPayload(record.payload, occurredAtNanos);
      } else {
        event.revocation = validateRevocationPayload(record.payload);
      }
    } catch (err) {
      if (err instanceof ConsentPayloadError) {
        throw new ConsentEvaluationError(
          `events[${i}]: ${err.message}`,
        );
      }
      throw err;
    }

    subjectEvents.push(event);
  }

  subjectEvents.sort((a, b) => {
    if (a.occurredAtNanos !== b.occurredAtNanos) {
      return a.occurredAtNanos < b.occurredAtNanos ? -1 : 1;
    }
    if (a.recordedAtNanos !== b.recordedAtNanos) {
      return a.recordedAtNanos < b.recordedAtNanos ? -1 : 1;
    }
    const typeRank = (e: ConsentEvent) =>
      e.type === "grant" ? GRANT_ORDER_RANK : REVOKE_ORDER_RANK;
    if (typeRank(a) !== typeRank(b)) return typeRank(a) - typeRank(b);
    if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
    return 0;
  });

  const grants: GrantRecord[] = [];
  const consentIdGrants = new Map<string, GrantRecord[]>();

  for (const event of subjectEvents) {
    if (event.type === "grant") {
      const consentId = event.grant!.consentId;
      // Rule 11: reject duplicate consentId grants within the subject timeline.
      const existing = consentIdGrants.get(consentId);
      if (existing && existing.length > 0) {
        fail("duplicate consentId grant within the subject timeline");
      }
      const rec: GrantRecord = {
        consentId,
        purpose: event.grant!.purpose,
        eventId: event.eventId,
        occurredAtNanos: event.occurredAtNanos,
        expiresAtNanos: event.grant!.expiresAtNanos,
        revokedAtNanos: undefined,
        revocationEventId: undefined,
      };
      grants.push(rec);
      consentIdGrants.set(consentId, [rec]);
    } else {
      // Rule 8: a revocation matches its consentId.
      const consentId = event.revocation!.consentId;
      const bucket = consentIdGrants.get(consentId);
      if (!bucket) continue;
      for (const g of bucket) {
        // Only revoke a grant that is effective at the revocation time
        // (revocation must come at/after the grant).
        if (g.revokedAtNanos !== undefined) continue;
        if (event.occurredAtNanos < g.occurredAtNanos) continue;
        g.revokedAtNanos = event.occurredAtNanos;
        g.revocationEventId = event.eventId;
        break;
      }
    }
  }

  // Purpose-applicable grants (those matching the requested purpose),
  // sorted deterministic: occurredAt → eventId.
  const applicable = grants
    .filter((g) => g.purpose === purpose)
    .sort((a, b) => {
      if (a.occurredAtNanos !== b.occurredAtNanos) {
        return a.occurredAtNanos < b.occurredAtNanos ? -1 : 1;
      }
      if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
      return 0;
    });

  // Rule: any currently active grant allows use; choose the latest active grant
  // deterministically. A grant is active when not revoked and not expired
  // (evaluatedAt === expiresAt counts as expired).
  const activeGrants = applicable.filter((g) => {
    if (g.revokedAtNanos !== undefined) return false;
    if (g.expiresAtNanos !== undefined) {
      return evaluatedAtNanos < g.expiresAtNanos;
    }
    return true;
  });
  if (activeGrants.length > 0) {
    const latestActive = activeGrants[activeGrants.length - 1];
    return {
      decision: "allowed",
      purpose: purpose as ConsentEvidence["purpose"],
      evaluatedAt,
      evidenceEventIds: [latestActive.eventId],
      reason: "active_consent",
    };
  }

  if (applicable.length > 0) {
    // Otherwise report the state of the latest applicable grant.
    const latest = applicable[applicable.length - 1];
    if (latest.revokedAtNanos !== undefined) {
      return {
        decision: "denied",
        purpose: purpose as ConsentEvidence["purpose"],
        evaluatedAt,
        evidenceEventIds: [latest.eventId, latest.revocationEventId!],
        reason: "consent_revoked",
      };
    }
    if (
      latest.expiresAtNanos !== undefined &&
      evaluatedAtNanos >= latest.expiresAtNanos
    ) {
      return {
        decision: "denied",
        purpose: purpose as ConsentEvidence["purpose"],
        evaluatedAt,
        evidenceEventIds: [latest.eventId],
        reason: "consent_expired",
      };
    }
  }

  return {
    decision: "denied",
    purpose: purpose as ConsentEvidence["purpose"],
    evaluatedAt,
    evidenceEventIds: [],
    reason: "no_matching_consent",
  };
}
