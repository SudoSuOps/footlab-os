import type { DatasetEvent } from "./types.js";
import {
  validateArtifactReference,
  ensureUniqueArtifactIds,
} from "./artifact.ts";
import { computeDatasetEventHash, isSha256Hex, stableStringify } from "./canonical.ts";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

const EVENT_TYPES: readonly string[] = [
  "consent_granted",
  "consent_revoked",
  "flight_event_recorded",
  "capture_recorded",
  "observation_recorded",
  "design_released",
  "build_verified",
  "fit_recorded",
  "follow_up_recorded",
  "outcome_recorded",
  "artifact_superseded",
];

const ACTOR_TYPES: readonly string[] = [
  "client",
  "operator",
  "clinical_reviewer",
  "manufacturing",
  "system",
  "model",
];

const CLASSIFICATIONS: readonly string[] = [
  "synthetic",
  "identified",
  "pseudonymized",
];

const FOOT_SIDES: readonly string[] = ["left", "right"];

const CONSENT_DECISIONS: readonly string[] = [
  "allowed",
  "denied",
  "synthetic_exemption",
];

const CONSENT_PURPOSES: readonly string[] = [
  "care_operations",
  "care_team_sharing",
  "quality_improvement",
  "model_evaluation",
  "model_training",
  "research_publication",
];

const REQUIRED_FIELDS: readonly string[] = [
  "schemaVersion",
  "eventId",
  "caseId",
  "subjectId",
  "eventType",
  "occurredAt",
  "recordedAt",
  "actor",
  "dataClassification",
  "source",
  "consentEvidence",
  "artifactReferences",
  "provenance",
  "payload",
  "integrity",
];

const OPTIONAL_FIELDS: readonly string[] = ["footSide", "correlationId", "causationId"];
const ALL_FIELDS: readonly string[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

class DatasetEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetEventValidationError";
  }
}

function fail(field: string, detail: string): never {
  throw new DatasetEventValidationError(`${field}: ${detail}`);
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

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  parent?: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      const field = parent ? `${parent}.${key}` : key;
      fail(
        field,
        `unknown or unexpected field '${key}' is not part of the DatasetEvent schema`,
      );
    }
  }
}

function isValidId(value: unknown, field: string): string {
  if (typeof value !== "string") fail(field, "must be a string");
  if (value.length === 0 || value.trim().length === 0) {
    fail(field, "must be a non-empty string");
  }
  if (value !== value.trim()) {
    fail(field, "must not contain leading or trailing whitespace");
  }
  if (CONTROL_CHARS.test(value)) {
    fail(field, "must not contain control characters");
  }
  return value;
}

function isValidTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") fail(field, "must be a UTC ISO/RFC3339 timestamp ending in Z");
  if (!ISO_UTC_PATTERN.test(value)) {
    fail(field, "must be a UTC ISO/RFC3339 timestamp ending in Z");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail(field, "must be a valid UTC ISO/RFC3339 timestamp ending in Z");
  }
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/,
  );
  if (!m) fail(field, "must be a valid UTC ISO/RFC3339 timestamp ending in Z");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > lastDay || hour > 23 || minute > 59 || second > 59) {
    fail(field, "must be a valid UTC ISO/RFC3339 timestamp ending in Z");
  }
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    fail(field, "must be a valid UTC ISO/RFC3339 timestamp ending in Z");
  }
  return value;
}

function isDenseArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(field, "must be an array");
  for (let i = 0; i < value.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) {
      fail(field, "must be a dense array without empty slots");
    }
  }
  for (const key of Object.keys(value)) {
    if (key !== String(value.length) && !/^(0|[1-9]\d*)$/.test(key)) {
      fail(field, "must not contain extra enumerable non-index properties");
    }
  }
}

function validateIdArray(
  value: unknown,
  field: string,
): string[] {
  isDenseArray(value, field);
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    out.push(isValidId(value[i], `${field}[${i}]`));
  }
  return out;
}

export function validateDatasetEvent(value: unknown): DatasetEvent {
  if (!isPlainObject(value)) {
    fail("event", "must be a plain object, not array/Date/Map/Set/class instance");
  }
  const record = value as Record<string, unknown>;
  hasOnlyKeys(record, ALL_FIELDS);

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      fail(field, "is required");
    }
  }

  if (record.schemaVersion !== "1.0.0") {
    fail("schemaVersion", "must be exactly '1.0.0'");
  }

  const eventId = isValidId(record.eventId, "eventId");
  const caseId = isValidId(record.caseId, "caseId");
  const subjectId = isValidId(record.subjectId, "subjectId");

  const eventType = record.eventType;
  if (typeof eventType !== "string" || !EVENT_TYPES.includes(eventType)) {
    fail("eventType", `must be one of: ${EVENT_TYPES.join(", ")}`);
  }

  const occurredAt = isValidTimestamp(record.occurredAt, "occurredAt");
  const recordedAt = isValidTimestamp(record.recordedAt, "recordedAt");

  let footSide: string | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "footSide")) {
    const rawFootSide = record.footSide;
    if (rawFootSide !== "left" && rawFootSide !== "right") {
      fail("footSide", "must be 'left' or 'right'");
    }
    footSide = rawFootSide;
  }

  const actor = record.actor;
  if (!isPlainObject(actor)) {
    fail("actor", "must be a plain object with exactly the fields 'id' and 'type'");
  }
  const actorRecord = actor as Record<string, unknown>;
  hasOnlyKeys(actorRecord, ["id", "type"], "actor");
  const actorId = isValidId(actorRecord.id, "actor.id");
  const actorType = actorRecord.type;
  if (typeof actorType !== "string" || !ACTOR_TYPES.includes(actorType)) {
    fail("actor.type", `must be one of: ${ACTOR_TYPES.join(", ")}`);
  }

  const dataClassification = record.dataClassification;
  if (
    typeof dataClassification !== "string" ||
    !CLASSIFICATIONS.includes(dataClassification)
  ) {
    fail(
      "dataClassification",
      `must be one of: ${CLASSIFICATIONS.join(", ")}`,
    );
  }

  const source = record.source;
  if (!isPlainObject(source)) {
    fail("source", "must be a plain object");
  }
  const sourceRecord = source as Record<string, unknown>;
  hasOnlyKeys(
    sourceRecord,
    ["producerName", "producerVersion", "sourceEventId"],
    "source",
  );
  const producerName = isValidId(sourceRecord.producerName, "source.producerName");
  const producerVersion = isValidId(sourceRecord.producerVersion, "source.producerVersion");
  let sourceEventId: string | undefined;
  if (Object.prototype.hasOwnProperty.call(sourceRecord, "sourceEventId")) {
    sourceEventId = isValidId(sourceRecord.sourceEventId, "source.sourceEventId");
  }

  const consent = record.consentEvidence;
  if (!isPlainObject(consent)) {
    fail("consentEvidence", "must be a plain object");
  }
  const consentRecord = consent as Record<string, unknown>;
  hasOnlyKeys(
    consentRecord,
    [
      "decision",
      "purpose",
      "evaluatedAt",
      "evidenceEventIds",
      "reason",
    ],
    "consentEvidence",
  );
  const decision = consentRecord.decision;
  if (
    typeof decision !== "string" ||
    !CONSENT_DECISIONS.includes(decision)
  ) {
    fail(
      "consentEvidence.decision",
      `must be one of: ${CONSENT_DECISIONS.join(", ")}`,
    );
  }
  let purpose: string | undefined;
  if (Object.prototype.hasOwnProperty.call(consentRecord, "purpose")) {
    const rawPurpose = consentRecord.purpose;
    if (
      typeof rawPurpose !== "string" ||
      !CONSENT_PURPOSES.includes(rawPurpose)
    ) {
      fail(
        "consentEvidence.purpose",
        `must be one of: ${CONSENT_PURPOSES.join(", ")}`,
      );
    }
    purpose = rawPurpose;
  }
  const evaluatedAt = isValidTimestamp(
    consentRecord.evaluatedAt,
    "consentEvidence.evaluatedAt",
  );
  const evidenceEventIds = validateIdArray(
    consentRecord.evidenceEventIds,
    "consentEvidence.evidenceEventIds",
  );
  const reason = isValidId(consentRecord.reason, "consentEvidence.reason");

  if (dataClassification === "synthetic") {
    if (!subjectId.startsWith("SYN-") || !caseId.startsWith("SYN-")) {
      fail(
        "subjectId",
        "synthetic events must use SYN- prefixed subjectId and caseId",
      );
    }
    if (decision !== "synthetic_exemption") {
      fail(
        "consentEvidence.decision",
        "synthetic events must use decision 'synthetic_exemption'",
      );
    }
    if (purpose !== undefined) {
      fail(
        "consentEvidence.purpose",
        "synthetic events must not specify a consent purpose",
      );
    }
  } else {
    if (decision === "synthetic_exemption") {
      fail(
        "consentEvidence.decision",
        "identified or pseudonymized events must not use 'synthetic_exemption'",
      );
    }
    if (purpose === undefined) {
      fail(
        "consentEvidence.purpose",
        "identified or pseudonymized events must include a purpose",
      );
    }
  }

  isDenseArray(record.artifactReferences, "artifactReferences");
  const artifactReferences = (
    record.artifactReferences as unknown[]
  ).map((ref, i) => {
    try {
      const validated = validateArtifactReference(ref);
      return validated;
    } catch (err) {
      if (err instanceof Error) {
        fail(
          `artifactReferences[${i}]`,
          err.name === "DatasetEventValidationError"
            ? err.message
            : `failed to validate artifact reference: ${err.message}`,
        );
      }
      throw err;
    }
  });
  try {
    ensureUniqueArtifactIds(artifactReferences);
  } catch (err) {
    if (err instanceof Error) {
      fail("artifactReferences", err.message);
    }
    throw err;
  }

  const provenance = record.provenance;
  if (!isPlainObject(provenance)) {
    fail("provenance", "must be a plain object");
  }
  const provenanceRecord = provenance as Record<string, unknown>;
  hasOnlyKeys(provenanceRecord, ["inputEventIds", "supersededEventId"], "provenance");
  const inputEventIds = validateIdArray(
    provenanceRecord.inputEventIds,
    "provenance.inputEventIds",
  );
  let supersededEventId: string | undefined;
  if (
    Object.prototype.hasOwnProperty.call(provenanceRecord, "supersededEventId")
  ) {
    supersededEventId = isValidId(
      provenanceRecord.supersededEventId,
      "provenance.supersededEventId",
    );
  }

  let canonical: string;
  try {
    canonical = stableStringify(record.payload);
  } catch (err) {
    if (err instanceof Error) {
      fail("payload", "must be JSON-compatible (see canonical serialization rules)");
    }
    throw err;
  }
  let payload: string | number | boolean | null | object | object[];
  try {
    payload = JSON.parse(canonical);
  } catch (err) {
    if (err instanceof Error) {
      fail("payload", "must be JSON-compatible (see canonical serialization rules)");
    }
    throw err;
  }

  const integrity = record.integrity;
  if (!isPlainObject(integrity)) {
    fail("integrity", "must be a plain object");
  }
  const integrityRecord = integrity as Record<string, unknown>;
  hasOnlyKeys(
    integrityRecord,
    ["algorithm", "contentHash", "previousEventHash"],
    "integrity",
  );
  if (integrityRecord.algorithm !== "sha256") {
    fail("integrity.algorithm", "must be exactly 'sha256'");
  }
  const contentHash = integrityRecord.contentHash;
  if (typeof contentHash !== "string" || !isSha256Hex(contentHash)) {
    fail(
      "integrity.contentHash",
      "must be exactly 64 lowercase hexadecimal characters",
    );
  }
  let previousEventHash: string | undefined;
  if (
    Object.prototype.hasOwnProperty.call(integrityRecord, "previousEventHash")
  ) {
    const rawPreviousEventHash = integrityRecord.previousEventHash;
    if (
      typeof rawPreviousEventHash !== "string" ||
      !isSha256Hex(rawPreviousEventHash)
    ) {
      fail(
        "integrity.previousEventHash",
        "must be exactly 64 lowercase hexadecimal characters",
      );
    }
    previousEventHash = rawPreviousEventHash;
  }

  let correlationId: string | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "correlationId")) {
    correlationId = isValidId(record.correlationId, "correlationId");
  }
  let causationId: string | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "causationId")) {
    causationId = isValidId(record.causationId, "causationId");
  }

  const reconstructed: Record<string, unknown> = {};
  for (const field of ALL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      reconstructed[field] = record[field];
    }
  }
  reconstructed.schemaVersion = "1.0.0";
  reconstructed.eventId = eventId;
  reconstructed.caseId = caseId;
  reconstructed.subjectId = subjectId;
  reconstructed.eventType = eventType;
  reconstructed.occurredAt = occurredAt;
  reconstructed.recordedAt = recordedAt;
  if (footSide !== undefined) reconstructed.footSide = footSide;
  reconstructed.actor = { id: actorId, type: actorType };
  reconstructed.dataClassification = dataClassification;
  reconstructed.source = {
    producerName,
    producerVersion,
    ...(sourceEventId !== undefined ? { sourceEventId } : {}),
  };
  reconstructed.consentEvidence = {
    decision,
    ...(purpose !== undefined ? { purpose } : {}),
    evaluatedAt,
    evidenceEventIds: [...evidenceEventIds],
    reason,
  };
  reconstructed.artifactReferences = artifactReferences.map((ref) => ({ ...ref }));
  reconstructed.provenance = {
    inputEventIds: [...inputEventIds],
    ...(supersededEventId !== undefined ? { supersededEventId } : {}),
  };
  reconstructed.payload = payload;
  if (previousEventHash !== undefined) {
    reconstructed.integrity = {
      algorithm: "sha256",
      contentHash,
      previousEventHash,
    };
  } else {
    reconstructed.integrity = {
      algorithm: "sha256",
      contentHash,
    };
  }
  if (correlationId !== undefined) reconstructed.correlationId = correlationId;
  if (causationId !== undefined) reconstructed.causationId = causationId;

  let computedHash: string;
  try {
    computedHash = computeDatasetEventHash(reconstructed);
  } catch (err) {
    if (err instanceof Error) {
      fail("integrity.contentHash", "could not be verified against canonical form");
    }
    throw err;
  }
  if (computedHash !== contentHash) {
    fail(
      "integrity.contentHash",
      "does not match the canonical hash of the event contents",
    );
  }

  return reconstructed as unknown as DatasetEvent;
}

export { DatasetEventValidationError };
