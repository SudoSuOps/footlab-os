import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDatasetEventHash,
  isSha256Hex,
  sha256Canonical,
  stableStringify,
} from "../src/canonical.ts";
import {
  ArtifactError,
  ensureUniqueArtifactIds,
  validateArtifactReference,
  validateRelativeUri,
} from "../src/artifact.ts";
import {
  ConsentEvaluationError,
  evaluateConsent,
} from "../src/consent.ts";
import {
  DatasetEventValidationError,
  validateDatasetEvent,
} from "../src/validator.ts";
import {
  DatasetStoreError,
  InMemoryDatasetEventStore,
} from "../src/store.ts";

// ---------- fixture helpers ----------

let artifactCounter = 0;

function makeArtifact(overrides = {}) {
  artifactCounter += 1;
  return {
    artifactId: `SYN-ART-${String(artifactCounter).padStart(3, "0")}`,
    artifactKind: "image",
    relativeUri: "artifacts/SYN-CASE-1/capture.png",
    mediaType: "image/png",
    byteLength: 1024,
    sha256: sha256Canonical({
      id: `artifact-content-${artifactCounter}`,
      byteLength: 1024,
    }),
    createdAt: "2026-09-23T11:58:00Z",
    ...overrides,
  };
}

function makeSyntheticEvent(overrides = {}) {
  const event = {
    schemaVersion: "1.0.0",
    eventId: "SYN-EV-1",
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
      evidenceEventIds: ["SYN-EV-EVID-1"],
      reason: "synthetic test data",
    },
    artifactReferences: [makeArtifact()],
    provenance: { inputEventIds: [] },
    payload: { captureId: "SYN-CAP-1", frames: [1, 2, 3] },
    integrity: { algorithm: "sha256", contentHash: "0".repeat(64) },
  };
  for (const [key, value] of Object.entries(overrides)) {
    event[key] = value;
  }
  return event;
}

/** Return a deep clone of `event` with integrity.contentHash removed. */
function withoutContentHash(event) {
  const clone = structuredClone(event);
  if (clone.integrity && typeof clone.integrity === "object") {
    delete clone.integrity.contentHash;
  }
  return clone;
}

/** Return a deep clone of `event` seeded with a correct or fake contentHash. */
function withCompute(event, { fakeContentHash = false } = {}) {
  const clone = structuredClone(event);
  const hashBase = withoutContentHash(clone);
  if (fakeContentHash) {
    clone.integrity.contentHash = "f".repeat(64);
    if (computeDatasetEventHash(hashBase).startsWith("f".repeat(64))) {
      clone.integrity.contentHash = "e".repeat(64);
    }
  } else {
    clone.integrity.contentHash = computeDatasetEventHash(hashBase);
  }
  return clone;
}

/** Assert `fn` throws a DatasetEventValidationError whose message matches `msgPattern`. */
function assertEventRejected(fn, label, msgPattern) {
  let error;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  assert.ok(
    error instanceof DatasetEventValidationError,
    `${label}: expected DatasetEventValidationError, got ${error?.constructor?.name}: ${error?.message}`,
  );
  if (msgPattern) {
    assert.match(
      error.message,
      msgPattern,
      `${label}: message "${error.message}" did not match ${msgPattern}`,
    );
  }
  return error;
}

/** Return the serialized structure of an object (own keys/values, recursed). */
function describe(value, depth = 0) {
  if (depth > 8) return "<deep>";
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => (v === undefined ? "<hole>" : describe(v, depth + 1)))
      .join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .map((k) => `${k}:${describe(value[k], depth + 1)}`)
      .join(", ")}}`;
  }
  if (value === undefined) return "<undefined>";
  return JSON.stringify(value);
}

/** Assert no string value inside `value` contains `secret`. */
function assertNoPayloadLeak(value, secret, label) {
  const check = (node, path) => {
    if (typeof node === "string") {
      assert.ok(
        !node.includes(secret),
        `${label}: validation error output leaked payload value at ${path}`,
      );
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) check(v, `${path}.${k}`);
    }
  };
  check({ message: String(value.message ?? ""), stack: value.stack ?? "" }, "error");
}

// ---------- package index ----------

test("index: src/index.ts imports successfully and exposes the public API surface", async () => {
  const index = await import("../src/index.ts");
  for (const exportedName of [
    "stableStringify",
    "sha256Canonical",
    "computeDatasetEventHash",
    "validateArtifactReference",
    "validateDatasetEvent",
    "DatasetEventValidationError",
    "evaluateConsent",
    "ConsentEvaluationError",
    "InMemoryDatasetEventStore",
    "DatasetStoreError",
  ]) {
    assert.ok(
      exportedName in index,
      `src/index.ts must export ${exportedName}`,
    );
  }
  // The ten public surface entries resolve to the exact implementations under test.
  assert.equal(index.stableStringify, stableStringify);
  assert.equal(index.sha256Canonical, sha256Canonical);
  assert.equal(index.computeDatasetEventHash, computeDatasetEventHash);
  assert.equal(index.validateArtifactReference, validateArtifactReference);
  assert.equal(index.validateDatasetEvent, validateDatasetEvent);
  assert.equal(index.DatasetEventValidationError, DatasetEventValidationError);
  assert.equal(index.evaluateConsent, evaluateConsent);
  assert.equal(index.ConsentEvaluationError, ConsentEvaluationError);
  assert.equal(index.InMemoryDatasetEventStore, InMemoryDatasetEventStore);
  assert.equal(index.DatasetStoreError, DatasetStoreError);
  // ConsentRequest is type-only and has no runtime representation.
  assert.ok(
    !("ConsentRequest" in index),
    "src/index.ts must not expose a runtime ConsentRequest export",
  );
  // DatasetStoreErrorCode and DatasetCaseHead are type-only and have no
  // runtime representation.
  assert.ok(
    !("DatasetStoreErrorCode" in index),
    "src/index.ts must not expose a runtime DatasetStoreErrorCode export",
  );
  assert.ok(
    !("DatasetCaseHead" in index),
    "src/index.ts must not expose a runtime DatasetCaseHead export",
  );
});

// ---------- canonical serialization ----------

test("canonical: recursive object-key ordering is deterministic regardless of insertion order", () => {
  const builtFirst = {};
  builtFirst.b = { m: 1, a: [3, 2], z: null };
  builtFirst.a = { y: "x", b: { q: true, p: false } };
  const builtSecond = {};
  builtSecond.a = { b: { p: false, q: true }, y: "x" };
  builtSecond.b = { z: null, a: [3, 2], m: 1 };

  const expected =
    '{"a":{"b":{"p":false,"q":true},"y":"x"},"b":{"a":[3,2],"m":1,"z":null}}';

  assert.equal(stableStringify(builtFirst), expected);
  assert.equal(stableStringify(builtSecond), expected);
  assert.equal(stableStringify(builtFirst), stableStringify(builtSecond));
  assert.equal(
    sha256Canonical(builtFirst),
    sha256Canonical(builtSecond),
    "hashes must agree for the same logical content",
  );
});

test("canonical: array order is preserved and affects hashes", () => {
  assert.equal(stableStringify([3, 1, 2]), "[3,1,2]");
  assert.equal(stableStringify([1, 2, 3]), "[1,2,3]");
  assert.notEqual(stableStringify([3, 1, 2]), stableStringify([1, 2, 3]));
  assert.equal(
    stableStringify([["a", ["b", "c"]], ["a", ["c", "b"]]]),
    '[["a",["b","c"]],["a",["c","b"]]]',
    "nested array order must be preserved",
  );
  assert.notEqual(
    sha256Canonical({ values: [1, 2, 3] }),
    sha256Canonical({ values: [3, 2, 1] }),
    "reordered arrays must produce different hashes",
  );
});

test("canonical: unsupported values (undefined, NaN, Infinity, bigint, function, symbol) are rejected", () => {
  const unsupported = [
    ["undefined (top-level)", undefined],
    ["undefined (nested)", { a: { b: undefined } }],
    ["NaN", { a: NaN }],
    ["Infinity", { a: Infinity }],
    ["-Infinity", { a: -Infinity }],
    ["bigint (top-level)", 10n],
    ["bigint (nested)", { a: 3n }],
    ["function (top-level)", () => 1],
    ["function (nested)", { a: function nested() {} }],
    ["symbol (top-level)", Symbol("tag")],
    ["symbol (nested)", { a: Symbol("x") }],
  ];
  for (const [label, value] of unsupported) {
    assert.throws(
      () => stableStringify(value),
      /unsupported value/i,
      `stableStringify must reject ${label}`,
    );
    assert.throws(
      () => sha256Canonical(value),
      /unsupported value/i,
      `sha256Canonical must reject ${label}`,
    );
    if (typeof value === "object" && value !== null) {
      assert.throws(
        () => computeDatasetEventHash(value),
        /unsupported value/i,
        `computeDatasetEventHash must reject event containing ${label}`,
      );
    }
  }
});

test("canonical: sparse arrays are rejected", () => {
  assert.throws(
    () => stableStringify([1, , 3]),
    /sparse/i,
    "hole at index 1",
  );
  assert.throws(
    () => stableStringify({ items: ["a", , "b"] }),
    /sparse/i,
    "nested hole",
  );
  const three = ["a", "b"];
  three.length = 4;
  three[3] = "d";
  assert.throws(() => stableStringify(three), /sparse/i, "length-stretched hole");
});

test("canonical: cyclic structures are rejected", () => {
  const objCycle = {};
  objCycle.self = objCycle;
  assert.throws(
    () => stableStringify(objCycle),
    /cyclic/i,
    "object self-reference",
  );

  const a = {};
  const b = { ref: a };
  a.ref = b;
  assert.throws(() => stableStringify({ a, b }), /cyclic/i, "two-object cycle");

  const arr = [];
  arr.push(arr);
  assert.throws(() => stableStringify(arr), /cyclic/i, "array self-reference");

  const nestedArray = { list: [] };
  nestedArray.list.push(nestedArray);
  assert.throws(
    () => stableStringify(nestedArray),
    /cyclic/i,
    "object containing self-referencing array",
  );
});

test("canonical: Date, Map, Set, and class instances are rejected", () => {
  assert.throws(
    () => stableStringify(new Date("2026-09-23T00:00:00Z")),
    /non-plain object/i,
    "Date",
  );
  assert.throws(
    () => stableStringify(new Map([["k", 1]])),
    /non-plain object/i,
    "Map",
  );
  assert.throws(
    () => stableStringify(new Set([1, 2])),
    /non-plain object/i,
    "Set",
  );

  class Measurement {
    constructor(value) {
      this.value = value;
    }
  }
  assert.throws(
    () => stableStringify(new Measurement(42)),
    /non-plain object/i,
    "class instance",
  );
  assert.throws(
    () => stableStringify({ reading: new Measurement(42) }),
    /non-plain object/i,
    "nested class instance",
  );
  assert.throws(
    () => stableStringify(new (class Anonymous { m() {} })()),
    /non-plain object/i,
    "anonymous class instance",
  );
});

test("canonical: shared non-cyclic references are allowed", () => {
  const shared = { x: 1, y: [9, 8] };
  const list = ["first", "second"];
  const structure = { a: shared, b: list, nested: { c: shared, d: list } };

  const expected =
    '{"a":{"x":1,"y":[9,8]},"b":["first","second"],"nested":{"c":{"x":1,"y":[9,8]},"d":["first","second"]}}';

  const result = stableStringify(structure);
  assert.equal(result, expected);
  assert.equal(
    result,
    JSON.stringify({
      a: structuredClone(shared),
      b: structuredClone(list),
      nested: {
        c: structuredClone(shared),
        d: structuredClone(list),
      },
    }),
    "repeated references must serialize identically to independently built copies",
  );
});

test("canonical: computeDatasetEventHash excludes only integrity.contentHash", () => {
  const event = makeSyntheticEvent({
    payload: { note: "hash-exclusion fixture" },
    correlationId: "SYN-CORR-1",
  });
  const base = withoutContentHash(event);
  const computed = computeDatasetEventHash(base);
  assert.equal(computed, computeDatasetEventHash(base), "hash must be deterministic");
  assert.ok(isSha256Hex(computed), "hash must be 64-char lowercase hex");

  const withRealHash = withCompute(event);
  assert.equal(withRealHash.integrity.contentHash, computed);

  const tampered = structuredClone(withRealHash);
  tampered.integrity.contentHash = "f".repeat(64) === computed ? "e".repeat(64) : "f".repeat(64);
  assert.notEqual(tampered.integrity.contentHash, computed);
  assert.equal(
    computeDatasetEventHash(tampered),
    computed,
    "changing integrity.contentHash alone must not change the hash",
  );

  const algorithmChanged = structuredClone(withRealHash);
  algorithmChanged.integrity.algorithm = "blake3";
  assert.notEqual(
    computeDatasetEventHash(algorithmChanged),
    computed,
    "integrity.algorithm remains part of the hash input",
  );

  const prevHash = "3".repeat(64);
  const withPrev = structuredClone(withoutContentHash(event));
  withPrev.integrity.previousEventHash = prevHash;
  const hashWithPrev = computeDatasetEventHash(withPrev);
  assert.notEqual(
    hashWithPrev,
    computeDatasetEventHash(withoutContentHash(event)),
    "integrity.previousEventHash remains part of the hash input",
  );

  const payloadChanged = structuredClone(withoutContentHash(event));
  payloadChanged.payload.note = "changed";
  assert.notEqual(
    computeDatasetEventHash(payloadChanged),
    computed,
    "payload changes must change the hash",
  );
});

test("canonical: hashing does not mutate the input event", () => {
  const event = makeSyntheticEvent();
  const snapshot = structuredClone(event);

  computeDatasetEventHash(event);
  sha256Canonical(event.payload);

  assert.deepEqual(event, snapshot, "event must be unchanged after hashing");
  assert.ok(
    "contentHash" in event.integrity,
    "integrity.contentHash must not be deleted from the caller's object",
  );
});

// ---------- artifact validation ----------

test("artifact: valid reference returns a fresh object with identical values", () => {
  const input = makeArtifact({ artifactId: "SYN-ART-FRESH-1" });
  const result = validateArtifactReference(input);
  assert.notEqual(result, input, "returned reference must not be the input object");
  for (const key of Object.keys(input)) {
    assert.equal(result[key], input[key], `field ${key} value must be preserved`);
  }
  assert.deepEqual(Object.keys(result).sort(), Object.keys(input).sort());
  result.relativeUri = "artifacts/elsewhere.png";
  assert.equal(
    input.relativeUri,
    "artifacts/SYN-CASE-1/capture.png",
    "mutating the returned object must not affect the input",
  );
});

test("artifact: absolute paths, backslashes, schemes, traversal, empty segments, and unsafe characters are rejected", () => {
  const cases = [
    ["empty string", ""],
    ["absolute POSIX path", "/etc/passwd"],
    ["leading-slash segment", "/artifacts/img.png"],
    ["backslash path", "artifacts\\img.png"],
    ["Windows drive path", "C:/artifacts/img.png"],
    ["URI scheme (http)", "http://example.com/img.png"],
    ["URI scheme (data)", "data:image/png;base64,xxx"],
    ["double-slash empty segment", "artifacts//img.png"],
    ["trailing-slash empty segment", "artifacts/img.png/"],
    ["parent traversal segment", "../outside.png"],
    ["dot traversal segment", "artifacts/./img.png"],
    ["mid-path parent traversal", "artifacts/../secret.png"],
    ["space in segment", "artifacts/my file.png"],
    ["hash in segment", "artifacts/img#fragment.png"],
    ["colon in segment", "artifacts/img:tag.png"],
    ["plus in segment", "artifacts/img+1.png"],
    ["question in segment", "artifacts/w?x.png"],
    ["at-sign in segment", "artifacts/user@host.png"],
    ["unicode segment", "artifacts/图像.png"],
    ["dollar in segment", "artifacts/$img.png"],
  ];
  for (const [label, uri] of cases) {
    assert.throws(
      () => validateRelativeUri(uri),
      ArtifactError,
      `relativeUri must reject ${label}`,
    );
    assert.throws(
      () =>
        validateArtifactReference(makeArtifact({ relativeUri: uri })),
      ArtifactError,
      `validateArtifactReference must reject ${label}`,
    );
  }

  const valid = "artifacts/SYN-CASE-1/deep/nested-file_v2.png";
  validateRelativeUri(valid);
  assert.ok(true, `valid mixed-case URI with hyphen, underscore, and dot accepted: ${valid}`);
});

test("artifact: invalid hashes, byte lengths, timestamps, kinds, and extra fields are rejected", () => {
  assert.throws(
    () => validateArtifactReference(makeArtifact({ sha256: "A".repeat(64) })),
    /sha256/,
    "uppercase hex",
  );
  assert.throws(
    () => validateArtifactReference(makeArtifact({ sha256: "g".repeat(64) })),
    /sha256/,
    "non-hex character",
  );
  assert.throws(
    () => validateArtifactReference(makeArtifact({ sha256: "a".repeat(63) })),
    /sha256/,
    "63 chars too short",
  );
  assert.throws(
    () => validateArtifactReference(makeArtifact({ sha256: "a".repeat(65) })),
    /sha256/,
    "65 chars too long",
  );

  const badByteLengths = [
    ["negative byteLength", -1],
    ["float byteLength", 12.5],
    ["non-safe-integer byteLength", Number.MAX_SAFE_INTEGER + 1],
    ["NaN byteLength", NaN],
    ["string byteLength", "1024"],
  ];
  for (const [label, byteLength] of badByteLengths) {
    assert.throws(
      () => validateArtifactReference(makeArtifact({ byteLength })),
      /byteLength/,
      label,
    );
  }

  const badTimestamps = [
    ["not ISO", "yesterday"],
    ["offset instead of Z", "2026-09-23T12:00:00+02:00"],
    ["lowercase z", "2026-09-23T12:00:00z"],
    ["space instead of T", "2026-09-23 12:00:00Z"],
    ["month 13", "2026-13-23T12:00:00Z"],
    ["day 32", "2026-01-32T12:00:00Z"],
    ["hour 24", "2026-09-23T24:00:00Z"],
    ["minute 60", "2026-09-23T12:60:00Z"],
    ["number timestamp", 1758710400000],
  ];
  for (const [label, createdAt] of badTimestamps) {
    assert.throws(
      () => validateArtifactReference(makeArtifact({ createdAt })),
      /createdAt/,
      label,
    );
  }

  for (const artifactKind of ["photo", "IMAGE", "capture", 42, null]) {
    assert.throws(
      () => validateArtifactReference(makeArtifact({ artifactKind })),
      /artifactKind/,
      `kind ${JSON.stringify(artifactKind)}`,
    );
  }

  const withExtra = { ...makeArtifact({ artifactId: "SYN-ART-EXTRA-1" }) };
  withExtra.notes = "extra field";
  assert.throws(
    () => validateArtifactReference(withExtra),
    /exactly 7 fields/,
    "extra field",
  );

  const missing = { ...makeArtifact() };
  delete missing.createdAt;
  assert.throws(
    () => validateArtifactReference(missing),
    /exactly 7 fields|missing field/,
    "missing field",
  );
});

test("artifact: duplicate artifactIds are rejected", () => {
  const ref = makeArtifact({ artifactId: "SYN-ART-DUP-1" });
  assert.throws(
    () => ensureUniqueArtifactIds([ref, { ...ref, relativeUri: "artifacts/other.png" }]),
    /duplicate artifactId/,
    "duplicate artifactId (same id, different uri) must be rejected",
  );
  assert.throws(
    () => ensureUniqueArtifactIds([makeArtifact({ artifactId: "SYN-ART-D-1" }), makeArtifact({ artifactId: "SYN-ART-D-1" })]),
    /duplicate artifactId/,
    "two distinct fixtures with identical artifactId must be rejected",
  );
});

test("artifact: MIME values with missing or multiple slashes are rejected", () => {
  const badMediaTypes = [
    ["no slash", "imagepng"],
    ["multiple slashes (image/png/extra)", "image/png/extra"],
    ["double slash", "image//png"],
    ["double type", "image/png/tiff"],
  ];
  for (const [label, mediaType] of badMediaTypes) {
    assert.throws(
      () => validateArtifactReference(makeArtifact({ mediaType })),
      /mediaType/,
      label,
    );
  }

  for (const [value, expected] of [
    ["image/png", true],
    ["application/json", true],
    ["text/;boundary=xyz", false],
    ["text/plain extra", false],
  ]) {
    const ref = makeArtifact({ mediaType: value });
    if (expected) {
      validateArtifactReference(ref);
    } else {
      assert.throws(
        () => validateArtifactReference(ref),
        /mediaType/,
        `mediaType ${JSON.stringify(value)}`,
      );
    }
  }
});

// ---------- dataset-event validation ----------

test("event: valid SYN event passes and returns a fresh, deeply independent event", () => {
  const input = withCompute(makeSyntheticEvent());
  const result = validateDatasetEvent(input);

  assert.ok(
    !Object.is(result, input),
    "returned event must be a new object, not the input",
  );
  assert.deepEqual(result, input, "values must be faithfully reproduced");
  assert.equal(result.integrity.contentHash, computeDatasetEventHash(withoutContentHash(input)));

  const baseline = structuredClone(input);

  const mutations = [
    ["top-level id", (ev) => { ev.eventId = "MUTATED"; }],
    ["payload value", (ev) => { ev.payload.frames[0] = 999; }],
    ["payload item", (ev) => { ev.payload.frames.push(99); }],
    ["consent ids", (ev) => { ev.consentEvidence.evidenceEventIds[0] = "MUTATED"; }],
    ["artifact ref", (ev) => { ev.artifactReferences[0].relativeUri = "artifacts/mutated.png"; }],
    ["artifact list", (ev) => { ev.artifactReferences.push({ ...ev.artifactReferences[0], artifactId: "SYN-ART-MUT" }); }],
    ["nested actor", (ev) => { ev.actor.id = "MUTATED"; }],
  ];
  for (const [label, mutate] of mutations) {
    const variant = structuredClone(input);
    validateDatasetEvent(variant);
    assert.deepEqual(input, baseline, `input must be unchanged after validating ${label}`);
    mutate(variant);
    assert.deepEqual(input, baseline, `input must be unchanged after mutating ${label}`);
  }
  assert.deepEqual(input, baseline, "input must equal the baseline after all probes");
});

test("event: schema, event type, actor, foot side, and classification violations fail", () => {
  assert.throws(
    () => validateDatasetEvent(withCompute(makeSyntheticEvent({ schemaVersion: "2.0.0" }))),
    /schemaVersion/,
    "bad schemaVersion",
  );

  for (const eventType of ["capture_recorded!", "Capture_Recorded", "", 42, null]) {
    assert.throws(
      () => validateDatasetEvent(
        withCompute(makeSyntheticEvent({ eventType })),
      ),
      /eventType/,
      `eventType ${JSON.stringify(eventType)}`,
    );
  }

  assert.throws(
    () => validateDatasetEvent(withCompute(makeSyntheticEvent({ actor: { id: "SYN-A", type: "robot" } }))),
    /actor\.type/,
    "unknown actor type",
  );
  assert.throws(
    () => validateDatasetEvent(withCompute(makeSyntheticEvent({ actor: { id: "SYN-A" } }))),
    /actor\.type/,
    "missing actor type",
  );
  assert.throws(
    () => validateDatasetEvent(withCompute(makeSyntheticEvent({ actor: { id: "SYN-A", type: "system", role: "capturer" } }))),
    /unknown or unexpected field/,
    "extra actor field",
  );

  for (const footSide of ["both", "LEFT", "", 1, 0]) {
    assert.throws(
      () => validateDatasetEvent(withCompute(makeSyntheticEvent({ footSide }))),
      /footSide/,
      `footSide ${JSON.stringify(footSide)}`,
    );
  }
  validateDatasetEvent(withCompute(makeSyntheticEvent({ footSide: "left" })));

  for (const dataClassification of ["anonymous", "SYNTHETIC", "", null]) {
    assert.throws(
      () => validateDatasetEvent(
        withCompute(makeSyntheticEvent({ dataClassification })),
      ),
      /dataClassification/,
      `dataClassification ${JSON.stringify(dataClassification)}`,
    );
  }
});

test("event: leading or trailing whitespace in IDs fails", () => {
  for (const [field, badValue] of [
    ["eventId", " SYN-EV-1"],
    ["eventId", "SYN-EV-1 "],
    ["caseId", "SYN-CASE-1\t"],
    ["subjectId", "  SYN-SUBJ-1"],
  ]) {
    assert.throws(
      () => validateDatasetEvent(withCompute(makeSyntheticEvent({ [field]: badValue }))),
      /leading or trailing whitespace/,
      `${field} with whitespace`,
    );
  }

  {
    const ev = makeSyntheticEvent();
    ev.consentEvidence.evidenceEventIds = ["SYN-EV-EVID-1 "];
    assert.throws(
      () => validateDatasetEvent(withCompute(ev)),
      /leading or trailing whitespace/,
      "nested evidenceEventIds[0] trailing whitespace",
    );
  }

  assert.ok(
    validateDatasetEvent(withCompute(makeSyntheticEvent({ correlationId: "SYN-CORR-WS" }))).correlationId,
    "valid (non-whitespace) optional ID still accepted",
  );
});

test("event: synthetic IDs and synthetic-exemption rules are enforced", () => {
  assert.throws(
    () =>
      validateDatasetEvent(
        withCompute(makeSyntheticEvent({ subjectId: "SUBJ-REAL-1" })),
      ),
    /SYN-/ ,
    "synthetic event with non-SYN subjectId",
  );
  assert.throws(
    () =>
      validateDatasetEvent(
        withCompute(makeSyntheticEvent({ caseId: "CASE-REAL-1" })),
      ),
    /SYN-/,
    "synthetic event with non-SYN caseId",
  );

  {
    const ev = makeSyntheticEvent();
    ev.consentEvidence.decision = "allowed";
    assert.throws(
      () => validateDatasetEvent(withCompute(ev)),
      /synthetic_exemption/,
      "synthetic event with decision 'allowed'",
    );
  }

  {
    const ev = makeSyntheticEvent();
    ev.consentEvidence.purpose = "quality_improvement";
    assert.throws(
      () => validateDatasetEvent(withCompute(ev)),
      /purpose/,
      "synthetic event with a consent purpose",
    );
  }

  {
    const ev = makeSyntheticEvent();
    ev.dataClassification = "identified";
    ev.subjectId = "SUBJ-1";
    ev.caseId = "CASE-1";
    ev.consentEvidence.decision = "synthetic_exemption";
    ev.consentEvidence.reason = "synthetic test data";
    assert.throws(
      () => validateDatasetEvent(withCompute(ev)),
      /synthetic_exemption/,
      "identified event cannot use synthetic_exemption",
    );
  }

  {
    const ev = makeSyntheticEvent();
    ev.dataClassification = "pseudonymized";
    ev.subjectId = "PSD-1";
    ev.caseId = "CASE-PSD-1";
    ev.consentEvidence.decision = "allowed";
    delete ev.consentEvidence.purpose;
    assert.throws(
      () => validateDatasetEvent(withCompute(ev)),
      /purpose/,
      "pseudonymized event without a purpose",
    );
  }

  {
    const ev = makeSyntheticEvent();
    ev.dataClassification = "identified";
    ev.subjectId = "SUBJ-1";
    ev.caseId = "CASE-1";
    ev.consentEvidence.decision = "denied";
    ev.consentEvidence.purpose = "care_operations";
    ev.consentEvidence.reason = "captured during clinical care";
    assert.equal(validateDatasetEvent(withCompute(ev)).dataClassification, "identified");
  }
});

test("event: duplicate artifacts and sparse arrays fail", () => {
  {
    const ev = makeSyntheticEvent();
    ev.artifactReferences = [
      makeArtifact({ artifactId: "SYN-ART-DUP-EV-1", relativeUri: "artifacts/one.png" }),
      makeArtifact({ artifactId: "SYN-ART-DUP-EV-1", relativeUri: "artifacts/two.png" }),
    ];
    assertEventRejected(
      () => validateDatasetEvent(withCompute(ev)),
      "duplicate artifactIds in one event",
      /duplicate artifactId/,
    );
  }

  {
    // Sparse id arrays are caught by validateIdArray's isDenseArray check, which
    // reports "must be a dense array without empty slots" (an event-field failure,
    // not a payload failure), before the canonical hash is ever computed.
    const ev = makeSyntheticEvent();
    ev.provenance.inputEventIds = ["SYN-EV-A", , "SYN-EV-B"];
    assert.throws(
      () => validateDatasetEvent(ev),
      (err) =>
        err instanceof DatasetEventValidationError &&
        /provenance\.inputEventIds: must be a dense array without empty slots/i.test(err.message),
      "sparse provenance.inputEventIds must be rejected by the dense-array check",
    );
  }

  {
    const ev = makeSyntheticEvent();
    ev.consentEvidence.evidenceEventIds = ["SYN-EV-EVID-1", , "SYN-EV-EVID-2"];
    assert.throws(
      () => validateDatasetEvent(ev),
      (err) =>
        err instanceof DatasetEventValidationError &&
        /consentEvidence\.evidenceEventIds: must be a dense array without empty slots/i.test(err.message),
      "sparse consentEvidence.evidenceEventIds must be rejected by the dense-array check",
    );
  }

  {
    const ev = withCompute(makeSyntheticEvent());
    ev.artifactReferences.splice(1, 0, undefined);
    assert.throws(
      () => validateDatasetEvent(ev),
      /artifactReferences\[1\]/,
      "undefined entry inside artifactReferences",
    );
  }
});

test("event: non-canonical payloads fail without leaking payload content", () => {
  // Non-JSON payload values make the canonical hasher throw plain Error/TypeError (not a
  // DatasetEventValidationError). Each case is probed by hashing the mutated payload directly
  // and by running it through the validator, and the error text must never echo a secret.
  const leakProbes = [
    ["cyclic payload", (ev) => { const c = {}; c.self = c; ev.payload = c; }],
    ["payload containing NaN", (ev) => { ev.payload = { n: NaN } }],
    ["payload containing undefined", (ev) => { ev.payload = { u: undefined } }],
    ["payload containing bigint", (ev) => { ev.payload = { b: 5n } }],
    ["payload containing Date", (ev) => { ev.payload = { d: new Date(0) } }],
    ["sparse payload array", (ev) => { ev.payload = { list: [1, , 3] } }],
  ];
  const SECRET = "NEVER_LEAK_THIS_VALUE";
  for (const [label, mutate] of leakProbes) {
    // 1) The canonical hasher itself rejects the payload (plain Error/TypeError, not a
    //    DatasetEventValidationError).
    const directEv = makeSyntheticEvent({ payload: { secret: SECRET } });
    mutate(directEv);
    let hashError;
    try {
      computeDatasetEventHash(withoutContentHash(directEv));
      hashError = new Error(`expected the canonical hash to reject: ${label}`);
    } catch (err) {
      hashError = err;
    }
    assert.ok(
      /sparse|cyclic|unsupported|non-finite/i.test(hashError.message),
      `${label}: canonical hash must reject the non-JSON payload (got "${hashError.message}")`,
    );
    assertNoPayloadLeak(hashError, SECRET, label + " (hasher)");
    // 2) The validator also rejects it and never echoes the secret.
    const ev = makeSyntheticEvent({ payload: { secret: SECRET } });
    mutate(ev);
    let validateError;
    try { validateDatasetEvent(withCompute(ev)); } catch (e) { validateError = e; }
    assert.ok(validateError, `${label}: validator must reject the non-JSON payload`);
    assertNoPayloadLeak(validateError, SECRET, label + " (validator)");
  }

  const reordered = makeSyntheticEvent({ payload: { b: 2, a: 1, c: { z: 9, d: [3, 1] } } });
  validateDatasetEvent(withCompute(reordered));
  assert.ok(true, "key order of payload does not affect canonical validity");
});

test("event: unknown top-level and nested fields fail", () => {
  assert.throws(
    () => validateDatasetEvent(withCompute(makeSyntheticEvent({ extraTopLevel: 1 }))),
    /extraTopLevel/,
    "unknown top-level field",
  );
  {
    // A cyclic payload is the canonical "not canonical JSON" case: the hasher rejects it
    // and the validator rethrows as DatasetEventValidationError. (A bare number is *valid*
    // canonical JSON, so it is intentionally not probed here.)
    const cycle = {};
    cycle.self = cycle;
    const ev = makeSyntheticEvent({ payload: cycle });
    assert.throws(
      () => validateDatasetEvent(ev),
      (err) =>
        err instanceof DatasetEventValidationError && /cyclic|JSON-compatible/i.test(err.message),
      "cyclic payload must be rejected as non-canonical JSON",
    );
  }
  assert.throws(
    () => validateDatasetEvent(withCompute(makeSyntheticEvent({ correlationId: "X", causationId: "Y", unknownId: "Z" }))),
    /unknownId/,
    "unknown sibling of optional ids",
  );

  const nestedCases = [
    ["actor", (ev) => { ev.actor.extra = 1; }, /actor\.extra|extra/],
    ["source", (ev) => { ev.source.deprecatedField = true; }, /source/],
    ["consentEvidence", (ev) => { ev.consentEvidence.auditRef = "A-1"; }, /auditRef/],
    ["provenance", (ev) => { ev.provenance.note = "why"; }, /provenance/],
    ["integrity", (ev) => { ev.integrity.signature = "sig"; }, /integrity/],
  ];
  for (const [label, mutate, pattern] of nestedCases) {
    const ev = makeSyntheticEvent();
    mutate(ev);
    assert.throws(
      () => validateDatasetEvent(withCompute(ev)),
      pattern,
      `unknown field under ${label}`,
    );
  }
});

test("event: malformed or mismatched integrity hashes fail", () => {
  const malformedContentHashes = [
    ["empty string", ""],
    ["uppercase", "A".repeat(64)],
    ["too short", "a".repeat(63)],
    ["too long", "a".repeat(65)],
    ["non-hex", "z".repeat(64)],
    ["number", 12345],
  ];
  for (const [label, contentHash] of malformedContentHashes) {
    const ev = makeSyntheticEvent();
    ev.integrity.contentHash = contentHash;
    assertEventRejected(
      () => validateDatasetEvent(ev),
      `contentHash ${label}`,
      /contentHash/,
    );
  }

  {
    const ev = makeSyntheticEvent();
    ev.integrity.algorithm = "sha256";
    ev.integrity.contentHash = "b".repeat(64);
    assertEventRejected(
      () => validateDatasetEvent(ev),
      "mismatched contentHash",
      /does not match|not match/,
    );
  }

  {
    const ev = makeSyntheticEvent({});
    delete ev.integrity.algorithm;
    assertEventRejected(
      () => validateDatasetEvent(ev),
      "missing algorithm",
      /algorithm|sha256|exactly/,
    );
  }

  {
    const ev = makeSyntheticEvent({});
    ev.integrity.algorithm = "blake3";
    assertEventRejected(
      () => validateDatasetEvent(ev),
      "wrong algorithm",
      /algorithm/,
    );
  }

  {
    const ev = makeSyntheticEvent();
    ev.integrity.previousEventHash = "B".repeat(64);
    assertEventRejected(
      () => validateDatasetEvent(withCompute(ev)),
      "uppercase previousEventHash",
      /previousEventHash/,
    );
  }

  {
    const prevBefore = "c".repeat(64);
    const ev = makeSyntheticEvent();
    ev.integrity.previousEventHash = prevBefore;
    const validEvent = withCompute(ev);
    assert.equal(
      validateDatasetEvent(validEvent).integrity.previousEventHash,
      prevBefore,
      "valid previousEventHash is preserved on the returned event",
    );
  }
});

test("event: validation errors never include payload values", () => {
  const secret = "TOPIC_SECRET_PAYLOAD_VALUE_9c4d";
  const cases = [
    ["payload with unknown field", (ev) => { ev.payload = { note: secret, extraField: 1 }; }],
    ["mismatched hash with secret in payload", (ev) => { ev.payload = { note: secret }; }],
    ["bad artifact with secret in payload", (ev) => { ev.payload = { note: secret }; ev.artifactReferences[0].byteLength = -5; }],
    ["bad event type with secret in payload", (ev) => { ev.payload = { note: secret }; ev.eventType = "nope"; }],
    ["synthetic id violation with secret in payload", (ev) => { ev.payload = { note: secret }; ev.subjectId = "REAL-SUBJ"; }],
  ];
  for (const [label, mutate] of cases) {
    const ev = makeSyntheticEvent();
    mutate(ev);
    const error = assertEventRejected(() => validateDatasetEvent(ev), label);
    for (const secretPart of [secret, "TOPIC_SECRET", "9c4d"]) {
      for (const prop of ["message", "stack"]) {
        const text = String(error[prop] ?? "");
        assert.ok(
          !text.includes(secretPart),
          `${label}: error.${prop} leaked payload content: ${JSON.stringify(text.slice(0, 200))}`,
        );
      }
    }
  }
});
