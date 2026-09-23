import type { DatasetEvent } from "./types.ts";
import { validateDatasetEvent, DatasetEventValidationError } from "./validator.ts";
import { computeDatasetEventHash, stableStringify } from "./canonical.ts";

export type DatasetStoreErrorCode =
  | "invalid_batch"
  | "invalid_event"
  | "duplicate_event_id"
  | "unexpected_previous_hash"
  | "previous_hash_mismatch"
  | "case_subject_mismatch"
  | "invalid_query";

export class DatasetStoreError extends Error {
  readonly code: DatasetStoreErrorCode;
  readonly cause?: unknown;

  constructor(code: DatasetStoreErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "DatasetStoreError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.freeze(this);
  }
}

export interface DatasetCaseHead {
  readonly caseId: string;
  readonly subjectId: string;
  readonly eventId: string;
  readonly contentHash: string;
  readonly eventCount: number;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function fail(code: DatasetStoreErrorCode, message: string, cause?: unknown): never {
  throw new DatasetStoreError(code, message, cause);
}

function wrapValidationError(index: number, err: unknown): never {
  if (err instanceof DatasetEventValidationError) {
    fail(
      "invalid_event",
      `appendBatch[${index}]: dataset event failed validation ${err.message}`,
      err,
    );
  }
  fail("invalid_event", `appendBatch[${index}]: dataset event failed validation`, err);
}

function validateQueryId(value: unknown, field: string): string {
  if (typeof value !== "string") fail("invalid_query", `${field}: must be a string`);
  if (value.length === 0) fail("invalid_query", `${field}: must be a non-empty string`);
  if (value !== value.trim()) {
    fail("invalid_query", `${field}: must not contain leading or trailing whitespace`);
  }
  if (CONTROL_CHARS.test(value)) {
    fail("invalid_query", `${field}: must not contain control characters`);
  }
  return value;
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

/**
 * Deep-copy a JSON-value tree using the store's canonical serialization.
 *
 * `JSON.parse(stableStringify(value))` round-trips every JSON value (plain
 * objects, arrays, strings, numbers, booleans, null) into a fresh object
 * graph and rejects exactly the value kinds the schema forbids (class
 * instances, dates, Map/Set, non-finite numbers, cycles, sparse arrays).
 * This is both the deep-copy and a last-line schema guard for committed
 * events.
 */
function deepCopyJson(value: unknown, field: string): unknown {
  let canonical: string;
  try {
    canonical = stableStringify(value);
  } catch (err) {
    fail(
      "invalid_event",
      `${field}: must be JSON-compatible for storage (canonical serialization failed)`,
      err,
    );
  }
  try {
    return JSON.parse(canonical);
  } catch (err) {
    fail("invalid_event", `${field}: must be JSON-compatible for storage`, err);
  }
}

function verifyAndPreserveEvent(event: DatasetEvent): DatasetEvent {
  // Deep-copy through canonical serialization: a fresh object graph whose
  // JSON values are byte-identical (under canonical key order) to the input.
  const copy = deepCopyJson(event, "event") as DatasetEvent;
  // Verify the stored contentHash against the copy's canonical form.
  // If the caller's declared hash does not match, the event is corrupt and
  // we refuse to store it — without echoing either hash or any payload value.
  const recomputed = computeDatasetEventHash(copy);
  if (recomputed !== copy.integrity.contentHash) {
    fail(
      "invalid_event",
      "appendBatch: event failed content integrity verification",
    );
  }
  // Return the copy unchanged: contentHash is preserved, never rewritten.
  return copy;
}

class CaseState {
  readonly subjectId: string;
  headHash: string;
  eventCount: number;
  readonly eventIds: string[] = [];

  constructor(subjectId: string, headHash: string) {
    this.subjectId = subjectId;
    this.headHash = headHash;
    this.eventCount = 0;
  }
}

export class InMemoryDatasetEventStore {
  private readonly events: DatasetEvent[] = [];
  private byEventId = new Map<string, number>();
  private caseStates = new Map<string, CaseState>();

  get size(): number {
    return this.events.length;
  }

  /**
   * Append a single event. All append rules (validation, uniqueness,
   * case chain, subject agreement) are checked; on any failure the store
   * is left unchanged and a DatasetStoreError is thrown.
   */
  append(value: unknown): DatasetEvent {
    return this.appendBatch([value])[0];
  }

  /**
   * Append a batch atomically. The whole batch is validated and staged
   * against shadow state; if any item fails, the store is unchanged.
   */
  appendBatch(values: readonly unknown[]): readonly DatasetEvent[] {
    if (!Array.isArray(values)) {
      fail("invalid_batch", "appendBatch: values must be an array");
    }
    if (Object.keys(values).length !== values.length) {
      fail("invalid_batch", "appendBatch: values must be a dense array without empty slots");
    }
    for (const key of Object.keys(values)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= values.length) {
        fail("invalid_batch", "appendBatch: values must not contain enumerable non-index properties");
      }
    }

    // Shadow state: mirrors the store for the duration of staging. Nothing
    // is committed unless the whole batch is accepted.
    const shadowByEventId = new Map<string, number>(this.byEventId);
    const shadowCaseStates = new Map<string, CaseState>();
    for (const [caseId, state] of this.caseStates) {
      const copy = new CaseState(state.subjectId, state.headHash);
      copy.eventCount = state.eventCount;
      copy.eventIds.push(...state.eventIds);
      shadowCaseStates.set(caseId, copy);
    }

    const committed: DatasetEvent[] = [];

    for (let i = 0; i < values.length; i++) {
      let event: DatasetEvent;
      try {
        event = validateDatasetEvent(values[i]);
      } catch (err) {
        wrapValidationError(i, err);
      }

      const eventId = event.eventId;
      if (shadowByEventId.has(eventId)) {
        fail("duplicate_event_id", `appendBatch[${i}]: duplicate eventId`);
      }

      const caseId = event.caseId;
      const subjectId = event.subjectId;
      const previousEventHash: string | undefined = event.integrity.previousEventHash;

      const existing = shadowCaseStates.get(caseId);
      if (existing === undefined) {
        if (previousEventHash !== undefined) {
          fail(
            "unexpected_previous_hash",
            `appendBatch[${i}]: first event for a case must omit integrity.previousEventHash`,
          );
        }
      } else {
        if (existing.subjectId !== subjectId) {
          fail(
            "case_subject_mismatch",
            `appendBatch[${i}]: caseId already belongs to a different subjectId`,
          );
        }
        if (previousEventHash !== existing.headHash) {
          fail(
            "previous_hash_mismatch",
            `appendBatch[${i}]: integrity.previousEventHash must equal the current case head's contentHash`,
          );
        }
      }

      committed.push(
        deepFreeze(verifyAndPreserveEvent(event)) as DatasetEvent,
      );
      shadowByEventId.set(eventId, this.events.length + committed.length - 1);
      if (existing === undefined) {
        const fresh = new CaseState(subjectId, event.integrity.contentHash);
        fresh.eventCount = 1;
        fresh.eventIds.push(eventId);
        shadowCaseStates.set(caseId, fresh);
      } else {
        existing.headHash = event.integrity.contentHash;
        existing.eventCount += 1;
        existing.eventIds.push(eventId);
      }
    }

    // Commit: the staged copies were built before any mutation, so the
    // commit itself only records the pre-frozen, pre-rehashed events.
    for (const frozen of committed) {
      this.events.push(frozen);
    }
    this.byEventId = shadowByEventId;
    this.caseStates = shadowCaseStates;

    // Returned frozen array shares (deep-frozen) committed copies.
    return Object.freeze(committed.slice());
  }

  getByEventId(eventId: string): DatasetEvent | undefined {
    const id = validateQueryId(eventId, "eventId");
    const index = this.byEventId.get(id);
    if (index === undefined) return undefined;
    return this.events[index];
  }

  listAll(): readonly DatasetEvent[] {
    return Object.freeze([...this.events]);
  }

  listByCaseId(caseId: string): readonly DatasetEvent[] {
    const id = validateQueryId(caseId, "caseId");
    const result: DatasetEvent[] = [];
    for (const event of this.events) {
      if (event.caseId === id) result.push(event);
    }
    return Object.freeze(result);
  }

  getCaseHead(caseId: string): DatasetCaseHead | undefined {
    const id = validateQueryId(caseId, "caseId");
    const state = this.caseStates.get(id);
    if (state === undefined) return undefined;
    const headEventId = state.eventIds[state.eventIds.length - 1];
    return Object.freeze({
      caseId: id,
      subjectId: state.subjectId,
      eventId: headEventId,
      contentHash: state.headHash,
      eventCount: state.eventCount,
    });
  }
}
