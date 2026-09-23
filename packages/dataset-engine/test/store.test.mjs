import test from "node:test";
import assert from "node:assert/strict";
import { computeDatasetEventHash } from "../src/canonical.ts";
import { validateDatasetEvent } from "../src/validator.ts";
import {
  DatasetStoreError,
  InMemoryDatasetEventStore,
} from "../src/store.ts";

// ---------- fixture helpers ----------

let eventCounter = 0;

function baseEvent(overrides = {}) {
  const event = {
    schemaVersion: "1.0.0",
    eventId: `SYN-EV-${String(++eventCounter).padStart(3, "0")}`,
    caseId: "SYN-CASE-1",
    subjectId: "SYN-SUBJ-1",
    eventType: "capture_recorded",
    occurredAt: "2026-09-23T12:00:00Z",
    recordedAt: "2026-09-23T12:00:05Z",
    actor: { id: "SYN-ACTOR-1", type: "system" },
    dataClassification: "synthetic",
    source: { producerName: "footlab-capture", producerVersion: "1.0.0" },
    consentEvidence: {
      decision: "synthetic_exemption",
      evaluatedAt: "2026-09-23T11:59:00Z",
      evidenceEventIds: [],
      reason: "synthetic test data",
    },
    artifactReferences: [],
    provenance: { inputEventIds: [] },
    payload: { captureId: "SYN-CAP-SECRET-DO-NOT-LEAK", frames: [1, 2, 3] },
    integrity: { algorithm: "sha256", contentHash: "0".repeat(64) },
  };
  for (const [key, value] of Object.entries(overrides)) {
    event[key] = value;
  }
  return event;
}

/** Return a validated event with integrity.contentHash set correctly. */
function makeEvent(overrides = {}) {
  const event = baseEvent(overrides);
  // Compute the correct content hash (includes previousEventHash if set).
  event.integrity.contentHash = computeDatasetEventHash(event);
  // The validator re-validates the canonical hash; ensure it's the validator
  // itself computing it.
  return validateDatasetEvent(event);
}

/** Return a validated event whose integrity.previousEventHash is set to `prev`. */
function makeChainedEvent(overrides = {}, prev) {
  return makeEvent({
    ...overrides,
    integrity: { algorithm: "sha256", contentHash: "0".repeat(64), previousEventHash: prev },
  });
}

/** Assert fn throws a DatasetStoreError with the given code. Returns the error. */
function assertStoreError(fn, code, label) {
  let error;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  assert.ok(
    error instanceof DatasetStoreError,
    `${label}: expected DatasetStoreError, got ${error?.constructor?.name}: ${error?.message}`,
  );
  assert.equal(error.code, code, `${label}: expected code=${code}, got code=${error.code}`);
  return error;
}

/**
 * Assert the payload secret did not leak into any part of the error graph:
 * error.message, error.cause.name, error.cause.message, error.cause.stack
 * (when present), and the safe serialization of non-Error causes.
 *
 * Failing assertion messages name ONLY the field that leaked — never the
 * protected value itself.
 */
function assertNoLeak(error) {
  const SECRET = "SYN-CAP-SECRET-DO-NOT-LEAK";
  if (!error) return;

  const safeText = (value) => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      // Circular or non-serializable cause: degrade to a stable label.
      // Never throw from a privacy helper.
      return String(value);
    }
  };

  assert.ok(
    !String(error.message).includes(SECRET),
    "error.message leaked protected payload value",
  );

  const cause = error.cause;
  if (cause === undefined) return;

  if (cause instanceof Error) {
    assert.ok(
      !String(cause.name).includes(SECRET),
      "error.cause.name leaked protected payload value",
    );
    assert.ok(
      !String(cause.message).includes(SECRET),
      "error.cause.message leaked protected payload value",
    );
    if (cause.stack !== undefined) {
      assert.ok(
        !String(cause.stack).includes(SECRET),
        "error.cause.stack leaked protected payload value",
      );
    }
  } else {
    assert.ok(
      !safeText(cause).includes(SECRET),
      "safely serialized error.cause leaked protected payload value",
    );
  }
}

// ---------- first append ----------

test("store: first append and size/head", () => {
  const store = new InMemoryDatasetEventStore();
  assert.equal(store.size, 0);

  const event = makeEvent();
  const returned = store.append(event);

  assert.equal(store.size, 1);
  assert.equal(returned.eventId, event.eventId);
  assert.equal(returned.caseId, "SYN-CASE-1");

  const head = store.getCaseHead("SYN-CASE-1");
  assert.ok(head, "head should exist for SYN-CASE-1");
  assert.equal(head.caseId, "SYN-CASE-1");
  assert.equal(head.subjectId, "SYN-SUBJ-1");
  assert.equal(head.eventId, event.eventId);
  assert.equal(head.contentHash, event.integrity.contentHash);
  assert.equal(head.eventCount, 1);
});

// ---------- chained second event ----------

test("store: correctly chained second event", () => {
  const store = new InMemoryDatasetEventStore();
  const first = makeEvent();
  store.append(first);

  const second = makeChainedEvent({ caseId: "SYN-CASE-1", subjectId: "SYN-SUBJ-1" }, first.integrity.contentHash);
  const returned = store.append(second);

  assert.equal(store.size, 2);
  assert.equal(returned.eventId, second.eventId);

  const head = store.getCaseHead("SYN-CASE-1");
  assert.equal(head.eventId, second.eventId);
  assert.equal(head.contentHash, second.integrity.contentHash);
  assert.equal(head.eventCount, 2);
});

// ---------- first event with previous hash rejected ----------

test("store: first event with previous hash rejected (unexpected_previous_hash)", () => {
  const store = new InMemoryDatasetEventStore();
  const event = makeChainedEvent({ caseId: "SYN-CASE-99", subjectId: "SYN-SUBJ-99" }, "a".repeat(64));
  const err = assertStoreError(() => store.append(event), "unexpected_previous_hash", "first-with-prev");
  assertNoLeak(err);
});

// ---------- later event missing/wrong previous hash ----------

test("store: later event with missing previous hash rejected (previous_hash_mismatch)", () => {
  const store = new InMemoryDatasetEventStore();
  const first = makeEvent();
  store.append(first);

  // Second event with NO previousEventHash
  const second = makeEvent({ caseId: "SYN-CASE-1", subjectId: "SYN-SUBJ-1" });
  const err = assertStoreError(() => store.append(second), "previous_hash_mismatch", "missing-prev");
  assertNoLeak(err);
});

test("store: later event with wrong previous hash rejected (previous_hash_mismatch)", () => {
  const store = new InMemoryDatasetEventStore();
  const first = makeEvent();
  store.append(first);

  const wrong = "b".repeat(64);
  const second = makeChainedEvent({ caseId: "SYN-CASE-1", subjectId: "SYN-SUBJ-1" }, wrong);
  const err = assertStoreError(() => store.append(second), "previous_hash_mismatch", "wrong-prev");
  assertNoLeak(err);
});

// ---------- independent case chains ----------

test("store: independent case chains", () => {
  const store = new InMemoryDatasetEventStore();

  const a1 = makeEvent({ caseId: "SYN-CASE-A", subjectId: "SYN-SUBJ-A" });
  const a1Hash = a1.integrity.contentHash;
  store.append(a1);

  const b1 = makeEvent({ caseId: "SYN-CASE-B", subjectId: "SYN-SUBJ-B" });
  const b1Hash = b1.integrity.contentHash;
  store.append(b1);

  // Case B's second event chains to b1, not a1
  const b2 = makeChainedEvent({ caseId: "SYN-CASE-B", subjectId: "SYN-SUBJ-B" }, b1Hash);
  store.append(b2);

  assert.equal(store.size, 3);

  const headA = store.getCaseHead("SYN-CASE-A");
  assert.equal(headA.eventId, a1.eventId);
  assert.equal(headA.contentHash, a1Hash);
  assert.equal(headA.eventCount, 1);

  const headB = store.getCaseHead("SYN-CASE-B");
  assert.equal(headB.eventId, b2.eventId);
  assert.equal(headB.contentHash, b2.integrity.contentHash);
  assert.equal(headB.eventCount, 2);
});

// ---------- duplicate event ID in store ----------

test("store: duplicate event ID in store", () => {
  const store = new InMemoryDatasetEventStore();
  const event = makeEvent();
  store.append(event);

  // Attempt to append the same event again
  const err = assertStoreError(() => store.append(event), "duplicate_event_id", "dup-store");
  assertNoLeak(err);
  assert.equal(store.size, 1);
});

// ---------- duplicate event ID within batch ----------

test("store: duplicate event ID within batch", () => {
  const store = new InMemoryDatasetEventStore();
  const event = makeEvent({ caseId: "SYN-CASE-DUP", subjectId: "SYN-SUBJ-DUP" });

  // Two identical events in one batch
  const err = assertStoreError(
    () => store.appendBatch([event, event]),
    "duplicate_event_id",
    "dup-batch",
  );
  assertNoLeak(err);
  assert.equal(store.size, 0);
});

// ---------- case/subject mismatch ----------

test("store: case/subject mismatch", () => {
  const store = new InMemoryDatasetEventStore();
  const first = makeEvent({ caseId: "SYN-CASE-M", subjectId: "SYN-SUBJ-M" });
  store.append(first);

  // Second event with same caseId but different subjectId
  const wrongSubject = makeChainedEvent(
    { caseId: "SYN-CASE-M", subjectId: "SYN-SUBJ-OTHER" },
    first.integrity.contentHash,
  );
  const err = assertStoreError(() => store.append(wrongSubject), "case_subject_mismatch", "subject-mismatch");
  assertNoLeak(err);
});

// ---------- invalid event/hash wrapped with correct code ----------

test("store: invalid event (bad hash) wrapped with invalid_event code", () => {
  const store = new InMemoryDatasetEventStore();
  const bad = baseEvent({
    integrity: { algorithm: "sha256", contentHash: "f".repeat(64) }, // wrong hash
    payload: { captureId: "SYN-CAP-SECRET-DO-NOT-LEAK", frames: [1] },
  });
  const err = assertStoreError(() => store.append(bad), "invalid_event", "invalid-event");
  assertNoLeak(err);
  assert.equal(store.size, 0);
});

test("store: non-object value wrapped with invalid_event code", () => {
  const store = new InMemoryDatasetEventStore();
  const err = assertStoreError(() => store.append("not-an-object"), "invalid_event", "non-object");
  assertNoLeak(err);
});

// ---------- multi-event batch using staged head ----------

test("store: multi-event batch with staged head chain", () => {
  const store = new InMemoryDatasetEventStore();
  const a1 = makeEvent({ caseId: "SYN-CASE-STAGED", subjectId: "SYN-SUBJ-STAGED" });
  const a2 = makeChainedEvent(
    { caseId: "SYN-CASE-STAGED", subjectId: "SYN-SUBJ-STAGED" },
    a1.integrity.contentHash,
  );
  const a3 = makeChainedEvent(
    { caseId: "SYN-CASE-STAGED", subjectId: "SYN-SUBJ-STAGED" },
    a2.integrity.contentHash,
  );

  const result = store.appendBatch([a1, a2, a3]);

  assert.equal(result.length, 3);
  assert.equal(store.size, 3);
  assert.equal(result[0].eventId, a1.eventId);
  assert.equal(result[1].eventId, a2.eventId);
  assert.equal(result[2].eventId, a3.eventId);

  const head = store.getCaseHead("SYN-CASE-STAGED");
  assert.equal(head.eventId, a3.eventId);
  assert.equal(head.contentHash, a3.integrity.contentHash);
  assert.equal(head.eventCount, 3);
});

// ---------- atomic rollback when batch event fails ----------

test("store: atomic rollback when middle batch event fails", () => {
  const store = new InMemoryDatasetEventStore();

  const a1 = makeEvent({ caseId: "SYN-CASE-RB", subjectId: "SYN-SUBJ-RB" });
  const badMiddle = baseEvent({
    eventId: "SYN-EV-BAD-MIDDLE",
    caseId: "SYN-CASE-RB",
    subjectId: "SYN-SUBJ-RB",
    integrity: { algorithm: "sha256", contentHash: "f".repeat(64) }, // bad hash
    payload: { captureId: "SYN-CAP-SECRET-DO-NOT-LEAK" },
  });
  const a3 = makeEvent({ caseId: "SYN-CASE-RB", subjectId: "SYN-SUBJ-RB" });

  assertStoreError(() => store.appendBatch([a1, badMiddle, a3]), "invalid_event", "rollback-middle");
  assert.equal(store.size, 0, "store must be unchanged after failed batch");
});

test("store: atomic rollback when final batch event fails", () => {
  const store = new InMemoryDatasetEventStore();

  const a1 = makeEvent({ caseId: "SYN-CASE-RB2", subjectId: "SYN-SUBJ-RB2" });
  const a2 = makeChainedEvent({ caseId: "SYN-CASE-RB2", subjectId: "SYN-SUBJ-RB2" }, a1.integrity.contentHash);
  const a3Bad = baseEvent({
    eventId: "SYN-EV-BAD-FINAL",
    caseId: "SYN-CASE-RB2",
    subjectId: "SYN-SUBJ-RB2",
    integrity: { algorithm: "sha256", contentHash: "e".repeat(64), previousEventHash: a2.integrity.contentHash },
    payload: { captureId: "SYN-CAP-SECRET-DO-NOT-LEAK" },
  });

  // a3Bad has wrong contentHash — validator will reject it
  const err = assertStoreError(
    () => store.appendBatch([a1, a2, a3Bad]),
    "invalid_event",
    "rollback-final",
  );
  assertNoLeak(err);
  assert.equal(store.size, 0);
});

// ---------- empty batch no-op ----------

test("store: empty batch is a valid no-op", () => {
  const store = new InMemoryDatasetEventStore();
  const result = store.appendBatch([]);
  assert.equal(result.length, 0);
  assert.equal(store.size, 0);
});

// ---------- non-array, sparse, extra-property batches ----------

test("store: non-array batch rejected with invalid_batch", () => {
  const store = new InMemoryDatasetEventStore();
  assertStoreError(() => store.appendBatch("not-an-array"), "invalid_batch", "non-array");
  assertStoreError(() => store.appendBatch(null), "invalid_batch", "null-batch");
  assertStoreError(() => store.appendBatch({}), "invalid_batch", "object-batch");
});

test("store: sparse array batch rejected with invalid_batch", () => {
  const store = new InMemoryDatasetEventStore();
  const sparse = new Array(2); // [ <empty>, <empty> ]
  assertStoreError(() => store.appendBatch(sparse), "invalid_batch", "sparse");
  assert.equal(store.size, 0);
});

test("store: array with enumerable non-index property rejected with invalid_batch", () => {
  const store = new InMemoryDatasetEventStore();
  const event = makeEvent();
  const patched = [event];
  Object.defineProperty(patched, "extra", { value: 1, enumerable: true });
  assertStoreError(() => store.appendBatch(patched), "invalid_batch", "extra-prop");
  assert.equal(store.size, 0);
});

// ---------- global and per-case append order ----------

test("store: preserves global and per-case append order", () => {
  const store = new InMemoryDatasetEventStore();

  const a1 = makeEvent({ caseId: "SYN-CASE-ORD-A", subjectId: "SYN-SUBJ-ORD", occurredAt: "2026-09-23T12:00:00Z" });
  const b1 = makeEvent({ caseId: "SYN-CASE-ORD-B", subjectId: "SYN-SUBJ-ORD", occurredAt: "2026-09-23T12:01:00Z" });
  const a2 = makeChainedEvent({ caseId: "SYN-CASE-ORD-A", subjectId: "SYN-SUBJ-ORD", occurredAt: "2026-09-23T12:00:30Z" }, a1.integrity.contentHash);

  store.append(a1);
  store.append(b1);
  store.append(a2);

  const all = store.listAll();
  assert.equal(all.length, 3);
  assert.equal(all[0].eventId, a1.eventId);
  assert.equal(all[1].eventId, b1.eventId);
  assert.equal(all[2].eventId, a2.eventId);

  const caseA = store.listByCaseId("SYN-CASE-ORD-A");
  assert.equal(caseA.length, 2);
  assert.equal(caseA[0].eventId, a1.eventId);
  assert.equal(caseA[1].eventId, a2.eventId);
});

// ---------- input immutability ----------

test("store: input remains mutable and independent after append", () => {
  const store = new InMemoryDatasetEventStore();
  const input = baseEvent();
  input.integrity.contentHash = computeDatasetEventHash(input);
  validateDatasetEvent(input);

  const returned = store.append(input);

  // Returned event is NOT the same object as the input
  assert.notEqual(returned, input, "returned event must not be the caller's object");

  // Nested objects are not shared
  assert.notEqual(returned.payload, input.payload, "payload must not be the same reference");
  assert.notEqual(returned.actor, input.actor, "actor must not be the same reference");
  assert.notEqual(returned.integrity, input.integrity, "integrity must not be the same reference");

  // Mutating the input does not affect the stored event
  input.payload.frames = [999];
  assert.deepEqual(returned.payload.frames, [1, 2, 3]);

  // And the input's payload object itself still contains the mutation
  // (input was NEVER frozen or mutated by the store).
  assert.deepEqual(input.payload.frames, [999]);
});

// ---------- returned event deeply frozen ----------

test("store: returned event is deeply frozen", () => {
  const store = new InMemoryDatasetEventStore();
  const event = makeEvent();
  const returned = store.append(event);

  assert.ok(Object.isFrozen(returned), "returned event must be frozen");
  assert.ok(Object.isFrozen(returned.payload), "payload must be frozen");
  assert.ok(Object.isFrozen(returned.actor), "actor must be frozen");
  assert.ok(Object.isFrozen(returned.source), "source must be frozen");
  assert.ok(Object.isFrozen(returned.consentEvidence), "consentEvidence must be frozen");
  assert.ok(Object.isFrozen(returned.artifactReferences), "artifactReferences must be frozen");
  assert.ok(Object.isFrozen(returned.provenance), "provenance must be frozen");
  assert.ok(Object.isFrozen(returned.integrity), "integrity must be frozen");

  assert.throws(
    () => { returned.payload.newKey = 1; },
    TypeError,
    "frozen payload must throw on assignment",
  );
});

// ---------- returned arrays and case heads frozen ----------

test("store: returned arrays and case heads are frozen", () => {
  const store = new InMemoryDatasetEventStore();
  const e1 = makeEvent();
  const e1Hash = e1.integrity.contentHash;
  store.append(e1);

  const e2 = makeChainedEvent({}, e1Hash);
  const e2Hash = e2.integrity.contentHash;
  store.append(e2);

  const e3 = makeChainedEvent({}, e2Hash);
  store.append(e3);

  const all = store.listAll();
  assert.ok(Object.isFrozen(all), "listAll() result must be frozen");
  assert.ok(all.every((ev) => Object.isFrozen(ev)), "events in listAll() must be frozen");

  const byCase = store.listByCaseId("SYN-CASE-1");
  assert.ok(Object.isFrozen(byCase), "listByCaseId() result must be frozen");

  const head = store.getCaseHead("SYN-CASE-1");
  assert.ok(Object.isFrozen(head), "case head must be frozen");
});

// ---------- attempted nested mutation cannot alter stored state ----------

test("store: attempted nested mutation cannot alter stored state", () => {
  const store = new InMemoryDatasetEventStore();
  const event = makeEvent();
  const returned = store.append(event);

  // Try to mutate nested object via the returned reference
  assert.throws(() => {
    "use strict";
    returned.payload.frames.push(999);
  }, TypeError);

  // Try to mutate via a new object reference
  assert.throws(() => {
    "use strict";
    returned.actor.id = "changed";
  }, TypeError);

  // Stored state unchanged
  assert.deepEqual(returned.payload.frames, [1, 2, 3]);
  assert.equal(returned.actor.id, "SYN-ACTOR-1");
});

// ---------- strict query ID validation ----------

test("store: strict query ID validation", () => {
  const store = new InMemoryDatasetEventStore();
  const stored = store.append(makeEvent());
  const firstEventId = stored.eventId;

  // Empty string
  assert.throws(() => store.getByEventId(""), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "empty string");
  assert.throws(() => store.listByCaseId(""), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "empty caseId");
  assert.throws(() => store.getCaseHead(""), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "empty caseId head");

  // Leading whitespace
  assert.throws(() => store.getByEventId(` ${firstEventId}`), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "leading ws");

  // Trailing whitespace
  assert.throws(() => store.listByCaseId("SYN-CASE-1 "), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "trailing ws");

  // Control character
  assert.throws(() => store.getByEventId("SYN\u0000EV"), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "control char");

  // Non-string
  assert.throws(() => store.getByEventId(42), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "number");
  assert.throws(() => store.getByEventId(null), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "null");
  assert.throws(() => store.getByEventId(undefined), (e) => e instanceof DatasetStoreError && e.code === "invalid_query", "undefined");
});

// ---------- unknown valid queries ----------

test("store: unknown valid queries return undefined/empty frozen array", () => {
  const store = new InMemoryDatasetEventStore();
  store.append(makeEvent());

  assert.equal(store.getByEventId("SYN-EV-DO-NOT-EXIST"), undefined);
  assert.equal(store.getCaseHead("SYN-CASE-DO-NOT-EXIST"), undefined);

  const empty = store.listByCaseId("SYN-CASE-DO-NOT-EXIST");
  assert.equal(empty.length, 0);
  assert.ok(Object.isFrozen(empty), "empty result array must be frozen");
});

// ---------- no destructive methods exposed ----------

test("store: no destructive methods exposed", () => {
  const store = new InMemoryDatasetEventStore();
  store.append(makeEvent());

  for (const method of ["update", "replace", "delete", "remove", "clear", "reset", "set", "put", "upsert"]) {
    assert.equal(
      typeof store[method],
      "undefined",
      `store.${method} must not exist`,
    );
  }
});

// ---------- errors never disclose payload values ----------

test("store: errors never disclose payload values", () => {
  const store = new InMemoryDatasetEventStore();
  const SECRET = "SYN-CAP-SECRET-DO-NOT-LEAK";
  const bad = baseEvent({
    integrity: { algorithm: "sha256", contentHash: "f".repeat(64) },
    payload: { captureId: SECRET, frames: [1, 2, 3] },
  });

  let error;
  try {
    store.append(bad);
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof DatasetStoreError, "expected DatasetStoreError");
  assert.ok(!String(error.message).includes(SECRET), "error.message leaked protected payload value");
  const cause = error.cause;
  if (cause instanceof Error) {
    assert.ok(!String(cause.message).includes(SECRET), "cause.message leaked protected payload value");
  } else if (cause !== undefined) {
    let serialized;
    try {
      serialized = JSON.stringify(cause);
    } catch {
      serialized = String(cause);
    }
    assert.ok(!serialized.includes(SECRET), "safely serialized error.cause leaked protected payload value");
  }
});

// ---------- regression: evidence hashes and returned-event identity ----------

test("store: returned event preserves the caller's validated declared contentHash", () => {
  const store = new InMemoryDatasetEventStore();
  const input = makeEvent();
  const declaredHash = input.integrity.contentHash;

  const returned = store.append(input);

  // Returned integrity.contentHash is exactly the caller's validated declared hash.
  assert.equal(returned.integrity.contentHash, declaredHash);
});

test("store: returned event is deeply equal to validateDatasetEvent(input)", () => {
  const store = new InMemoryDatasetEventStore();
  const input = makeEvent();

  const returned = store.append(input);
  const expected = validateDatasetEvent(input);

  // The complete returned event is deeply (strictly) equal to the validator's output.
  assert.deepEqual(returned, expected);
});

test("store: returned event is a different object graph from the input", () => {
  const store = new InMemoryDatasetEventStore();
  const input = makeEvent();

  const returned = store.append(input);

  assert.notEqual(returned, input, "returned event must be a different object");
  for (const key of ["payload", "actor", "source", "consentEvidence", "artifactReferences", "provenance", "integrity"]) {
    assert.notEqual(returned[key], input[key], `${key} must not be the same reference`);
  }
});

test("store: input integrity and contentHash are unchanged after append", () => {
  const store = new InMemoryDatasetEventStore();
  const input = makeEvent();
  const beforeHash = input.integrity.contentHash;
  const beforeIntegrity = input.integrity;

  store.append(input);

  // The input's own integrity object and its contentHash are untouched.
  assert.equal(input.integrity, beforeIntegrity, "input.integrity reference must be unchanged");
  assert.equal(input.integrity.contentHash, beforeHash, "input.integrity.contentHash must be unchanged");
});

test("store: computeDatasetEventHash(returned) equals returned.integrity.contentHash", () => {
  const store = new InMemoryDatasetEventStore();
  const input = makeEvent();

  const returned = store.append(input);

  assert.equal(computeDatasetEventHash(returned), returned.integrity.contentHash);
});

test("store: invalid-event errors and their causes do not expose the secret", () => {
  const store = new InMemoryDatasetEventStore();
  const SECRET = "SYN-CAP-SECRET-DO-NOT-LEAK";
  const bad = baseEvent({
    integrity: { algorithm: "sha256", contentHash: "f".repeat(64) },
    payload: { captureId: SECRET, frames: [1] },
  });

  const err = assertStoreError(() => store.append(bad), "invalid_event", "regression-no-secret");
  assertNoLeak(err);
});
