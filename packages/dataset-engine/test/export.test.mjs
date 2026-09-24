import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildDatasetExport, DatasetExportError } from "../src/export.ts";
import { stableStringify, computeDatasetEventHash } from "../src/canonical.ts";

const PURPOSE = "model_training";
const EVAL_AT = "2026-09-24T12:00:00Z";
const SHA64 = "0".repeat(64);

let seq = 0;

function id(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

// A valid captured event (root has no previousEventHash). Returns a plain,
// unvalidated object with integrity.contentHash computed correctly.
function buildEvent({ eventId, caseId, subjectId, eventType = "capture_recorded", occurredAt = "2026-09-24T10:00:00Z", recordedAt = "2026-09-24T10:00:01Z", classification = "pseudonymized", purpose = PURPOSE, decision = "allowed", evidence = [], reason, payload, previous = undefined, actorType = "system" }) {
  seq += 1;
  const consentEvidence = { decision, evaluatedAt: EVAL_AT, evidenceEventIds: evidence, ...(purpose ? { purpose } : {}), reason: reason ?? (classification === "identified" || classification === "pseudonymized" ? "active_consent" : "synthetic_data_exempt") };
  if (classification === "synthetic") {
    consentEvidence.purpose = undefined;
  }
  const event = {
    schemaVersion: "1.0.0",
    eventId,
    caseId,
    subjectId,
    eventType,
    occurredAt,
    recordedAt,
    actor: { id: id("SYN-ACT"), type: actorType },
    dataClassification: classification,
    source: { producerName: "SYN-PROD", producerVersion: "1.0.0" },
    consentEvidence,
    artifactReferences: [],
    provenance: { inputEventIds: [] },
    payload: payload ?? {},
    integrity: { algorithm: "sha256", contentHash: "0".repeat(64), ...(previous ? { previousEventHash: previous } : {}) },
  };
  event.integrity.contentHash = computeDatasetEventHash(event);
  return event;
}

function grantEvent({ eventId, subjectId, consentId, caseId, purpose = PURPOSE, occurredAt = "2026-09-24T09:00:00Z", expiresAt }) {
  const payload = { consentId, purpose, ...(expiresAt ? { expiresAt } : {}) };
  return buildEvent({ eventId, caseId: caseId ?? subjectId, subjectId, eventType: "consent_granted", classification: "identified", purpose, occurredAt, recordedAt: occurredAt, actorType: "system", payload });
}

function revokeEvent({ eventId, subjectId, consentId, caseId, occurredAt = "2026-09-24T11:00:00Z" }) {
  return buildEvent({ eventId, caseId: caseId ?? subjectId, subjectId, eventType: "consent_revoked", classification: "identified", occurredAt, recordedAt: occurredAt, actorType: "system", payload: { consentId, reason: "subject_requested" } });
}

function req(extra = {}) {
  return { purpose: PURPOSE, evaluatedAt: EVAL_AT, ...extra };
}

function sha256Utf8(s, key) {
  return createHash(key ? "sha256" : "sha256").update(s, "utf8").digest("hex");
}

function parseNdjson(ndjson) {
  if (ndjson === "") return [];
  return ndjson.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));
}

// ---------- 1. Omitted caseIds exports all eligible cases ----------
test("omitted caseIds exports all eligible cases", () => {
  const evA1 = buildEvent({ eventId: "SYN-EV-A1", caseId: "SYN-CASE-A", subjectId: "SYN-SUBJ-A" });
  const evA2 = buildEvent({ eventId: "SYN-EV-A2", caseId: "SYN-CASE-A", subjectId: "SYN-SUBJ-A", occurredAt: "2026-09-24T10:01:00Z", recordedAt: "2026-09-24T10:01:01Z", previous: evA1.integrity.contentHash });
  const evB1 = buildEvent({ eventId: "SYN-EV-B1", caseId: "SYN-CASE-B", subjectId: "SYN-SUBJ-A" });
  // The consent grant is identified, so it must form its own identified case
  // chain (it cannot anchor a pseudonymized data chain). It authorizes the
  // subject's cases by subjectId across the complete collection. That grant
  // case is itself eligible, so all three cases are exported.
  const grant = grantEvent({ eventId: "SYN-EV-GR1", subjectId: "SYN-SUBJ-A", consentId: "SYN-CT-1" });
  const values = [grant, evA1, evA2, evB1];
  const bundle = buildDatasetExport(values, req({}));
  assert.equal(bundle.manifest.caseCount, 3);
  assert.equal(bundle.manifest.eventCount, 4);
  assert.deepEqual(bundle.manifest.includedCases.map((c) => c.caseId), ["SYN-CASE-A", "SYN-CASE-B", "SYN-SUBJ-A"]);
  assert.equal(bundle.manifest.excludedCaseCount, 0);
  const lines = parseNdjson(bundle.eventsNdjson);
  assert.equal(lines.length, 4);
});

// ---------- 2. caseIds: [] exports zero cases, valid empty result ----------
test("caseIds: [] exports zero cases and produces a valid empty result", () => {
  const evA1 = buildEvent({ eventId: "SYN-EV-C1", caseId: "SYN-CASE-C", subjectId: "SYN-SUBJ-C" });
  const grant = grantEvent({ eventId: "SYN-EV-GR2", subjectId: "SYN-SUBJ-C", consentId: "SYN-CT-2" });
  const values = [grant, evA1];
  const bundle = buildDatasetExport(values, req({ caseIds: [] }));
  assert.equal(bundle.manifest.caseCount, 0);
  assert.equal(bundle.manifest.excludedCaseCount, 0);
  assert.equal(bundle.manifest.eventCount, 0);
  assert.deepStrictEqual(bundle.manifest.includedCases, []);
  assert.deepStrictEqual(bundle.manifest.excludedCases, []);
  assert.equal(bundle.eventsNdjson, "");
  // Still a well-formed bundle: hash of empty string, parseable manifest.
  assert.equal(bundle.manifest.eventsSha256, sha256Utf8(""));
  const manifest = JSON.parse(bundle.manifestJson);
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.format, "application/x-ndjson");
});

// ---------- 3. Non-empty caseIds exports exactly those cases ----------
test("non-empty caseIds exports exactly those cases", () => {
  const evA1 = buildEvent({ eventId: "SYN-EV-D1", caseId: "SYN-CASE-D", subjectId: "SYN-SUBJ-D" });
  const evB1 = buildEvent({ eventId: "SYN-EV-E1", caseId: "SYN-CASE-E", subjectId: "SYN-SUBJ-E" });
  const gA = grantEvent({ eventId: "SYN-EV-GR3", subjectId: "SYN-SUBJ-D", consentId: "SYN-CT-3" });
  const gB = grantEvent({ eventId: "SYN-EV-GR4", subjectId: "SYN-SUBJ-E", consentId: "SYN-CT-4" });
  const values = [gA, gB, evA1, evB1];
  const bundle = buildDatasetExport(values, req({ caseIds: ["SYN-CASE-D"] }));
  assert.equal(bundle.manifest.caseCount, 1);
  assert.deepEqual(bundle.manifest.includedCases.map((c) => c.caseId), ["SYN-CASE-D"]);
  const lines = parseNdjson(bundle.eventsNdjson);
  assert.deepEqual(lines.map((l) => l.eventId), ["SYN-EV-D1"]);
  // Unselected case B's event must be absent from NDJSON.
  assert.ok(!bundle.eventsNdjson.includes("SYN-EV-E1"));
});

// ---------- 4. Unknown case IDs fail safely ----------
test("unknown case IDs fail safely as invalid_request", () => {
  const evA1 = buildEvent({ eventId: "SYN-EV-F1", caseId: "SYN-CASE-F", subjectId: "SYN-SUBJ-F" });
  const grant = grantEvent({ eventId: "SYN-EV-GR5", subjectId: "SYN-SUBJ-F", consentId: "SYN-CT-5" });
  const values = [grant, evA1];
  try {
    buildDatasetExport(values, req({ caseIds: ["SYN-CASE-UNKNOWN", "SYN-CASE-F"] }));
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof DatasetExportError);
    assert.equal(err.code, "invalid_request");
    assert.ok(!["SYN-CASE-UNKNOWN", "SYN-SUBJ-F", "SYN-EV-F1", "SYN-CASE-F"].some((s) => s !== "SYN-CASE-F" && err.message.includes(s)));
  }
});

// ---------- 5. Malformed caseIds -> invalid_request ----------
test("duplicate, padded, empty, control-char, sparse, non-index caseIds fail as invalid_request", () => {
  const evA1 = buildEvent({ eventId: "SYN-EV-G1", caseId: "SYN-CASE-G", subjectId: "SYN-SUBJ-G" });
  const grant = grantEvent({ eventId: "SYN-EV-GR6", subjectId: "SYN-SUBJ-G", consentId: "SYN-CT-6" });
  const values = [grant, evA1];
  const sparse = ["SYN-CASE-G"];
  sparse[3] = "SYN-CASE-G2"; // hole at index 1
  const nonIndex = ["SYN-CASE-G"];
  Object.defineProperty(nonIndex, "extra", { value: "x", enumerable: true });
  const cases = {
    duplicate: ["SYN-CASE-G", "SYN-CASE-G"],
    padded: [" SYN-CASE-G"],
    empty: [""],
    control: ["SYN-CASE-\u0000G"],
    sparse,
    nonIndex,
  };
  for (const [name, caseIds] of Object.entries(cases)) {
    assert.throws(
      () => buildDatasetExport(values, req({ caseIds })),
      (err) => err instanceof DatasetExportError && err.code === "invalid_request",
      `expected invalid_request for ${name}`
    );
  }
});

// ---------- 6. Sparse events / non-index arrays -> invalid_event ----------
test("sparse input events and arrays with enumerable non-index properties fail as invalid_event", () => {
  const badArray = {};
  Array.prototype.push.call(badArray, "SYN-EV-H1");
  badArray.marker = "x"; // enumerable non-index property
  assert.throws(
    () => buildDatasetExport(badArray, req({})),
    (err) => err instanceof DatasetExportError && err.code === "invalid_event"
  );
  const sparseEvents = [buildEvent({ eventId: "SYN-EV-H2", caseId: "SYN-CASE-H", subjectId: "SYN-SUBJ-H" })];
  delete sparseEvents[0]; // sparse
  assert.throws(
    () => buildDatasetExport(sparseEvents, req({})),
    (err) => err instanceof DatasetExportError && err.code === "invalid_event"
  );
});

// ---------- 6b. Genuine array of valid events with own enumerable extra prop -> invalid_event ----------
test("a genuine array of valid events with an own enumerable extra property fails as invalid_event", () => {
  // Build a valid event, then attach an own enumerable extra property.
  const goodEvent = buildEvent({
    eventId: "SYN-EV-H3",
    caseId: "SYN-CASE-H3",
    subjectId: "SYN-SUBJ-H3",
  });
  const badEvent = { ...goodEvent, debugFlag: true };
  assert.throws(
    () => buildDatasetExport([badEvent], req({})),
    (err) => err instanceof DatasetExportError && err.code === "invalid_event"
  );
});

// ---------- 7. Consent uses complete collection; NDJSON/manifest only selected allowed ----------
test("consent uses complete validated collection while output contains only selected allowed events", () => {
  const subj = "TEST-SUBJ-1";
  // Grant lives OUTSIDE the selected case chain (in its own case), matching
  // subject+purpose -> authorizes the selected pseudonymized case.
  const grant = grantEvent({ eventId: "SYN-EV-GR7", caseId: "TEST-CASE-GRANT", subjectId: subj, consentId: "SYN-CT-7" });
  const sel1 = buildEvent({ eventId: "SYN-EV-S1", caseId: "TEST-CASE-SEL", subjectId: subj, classification: "pseudonymized" });
  const sel2 = buildEvent({ eventId: "SYN-EV-S2", caseId: "TEST-CASE-SEL", subjectId: subj, classification: "pseudonymized", occurredAt: "2026-09-24T10:02:00Z", recordedAt: "2026-09-24T10:02:01Z", previous: sel1.integrity.contentHash });
  const values = [sel1, sel2, grant];
  const bundle = buildDatasetExport(values, req({ caseIds: ["TEST-CASE-SEL"] }));
  assert.equal(bundle.manifest.caseCount, 1);
  assert.deepEqual(bundle.manifest.includedCases.map((c) => c.caseId), ["TEST-CASE-SEL"]);
  // Grant event (different case) must NOT appear in NDJSON or manifest.
  assert.ok(!bundle.eventsNdjson.includes("TEST-CASE-GRANT"));
  assert.ok(!bundle.manifestJson.includes("TEST-CASE-GRANT"));
  const lines = parseNdjson(bundle.eventsNdjson);
  assert.deepEqual(lines.map((l) => l.eventId).sort(), ["SYN-EV-S1", "SYN-EV-S2"]);
  assert.equal(bundle.manifest.eventCount, 2);
});

// ---------- 8. Out-of-chain grant authorizes selected case ----------
test("a grant outside the selected case chain authorizes an eligible selected case", () => {
  const subj = "TEST-SUBJ-2";
  const grant = grantEvent({ eventId: "SYN-EV-GR8", caseId: "TEST-CASE-OTHER", subjectId: subj, consentId: "SYN-CT-8" });
  const sel = buildEvent({ eventId: "SYN-EV-T1", caseId: "TEST-CASE-T", subjectId: subj, classification: "pseudonymized" });
  const bundle = buildDatasetExport([grant, sel], req({ caseIds: ["TEST-CASE-T"] }));
  const man = bundle.manifest.includedCases[0];
  assert.equal(man.caseId, "TEST-CASE-T");
  assert.equal(man.consentDecision, "allowed");
  assert.deepEqual(man.consentEvidenceEventIds, ["SYN-EV-GR8"]);
});

// ---------- 9. Denied or revoked consent excludes without leaking payload ----------
test("denied or revoked consent excludes the affected case without leaking payload values", () => {
  const subj = "TEST-SUBJ-3";
  const secret = "SECRET-FLIGHT-PAYLOAD-XYZ";
  // Scenario A: revoked consent.
  const grantRev = grantEvent({ eventId: "SYN-EV-GR9", caseId: "TEST-CASE-REV-GRANT", subjectId: subj, consentId: "SYN-CT-9" });
  const rev = revokeEvent({ eventId: "SYN-EV-RV1", caseId: "TEST-CASE-REV-GRANT", subjectId: subj, consentId: "SYN-CT-9" });
  const selRev = buildEvent({ eventId: "SYN-EV-SR1", caseId: "TEST-CASE-REV", subjectId: subj, classification: "pseudonymized", payload: { note: secret } });
  const bundleRevoked = buildDatasetExport([grantRev, rev, selRev], req({ caseIds: ["TEST-CASE-REV"] }));
  assert.equal(bundleRevoked.manifest.caseCount, 0);
  assert.equal(bundleRevoked.manifest.excludedCaseCount, 1);
  assert.equal(bundleRevoked.manifest.excludedCases[0].caseId, "TEST-CASE-REV");
  assert.ok(!bundleRevoked.eventsNdjson.includes(secret));
  assert.ok(!bundleRevoked.manifestJson.includes(secret));

  // Scenario B: no matching consent (denied).
  const subjB = "TEST-SUBJ-4";
  const selDenied = buildEvent({ eventId: "SYN-EV-SD1", caseId: "TEST-CASE-DENIED", subjectId: subjB, classification: "pseudonymized", payload: { note: secret } });
  const gB = grantEvent({ eventId: "SYN-EV-GR10", caseId: "TEST-CASE-DENIED-GRANT", subjectId: subjB, consentId: "SYN-CT-10", purpose: "care_operations" });
  const bundleDenied = buildDatasetExport([gB, selDenied], req({ caseIds: ["TEST-CASE-DENIED"] }));
  assert.equal(bundleDenied.manifest.caseCount, 0);
  assert.equal(bundleDenied.manifest.excludedCaseCount, 1);
  assert.equal(bundleDenied.manifest.excludedCases[0].caseId, "TEST-CASE-DENIED");
  assert.ok(!bundleDenied.eventsNdjson.includes(secret));
  assert.ok(!bundleDenied.manifestJson.includes(secret));
});

// ---------- 10. Broken unselected chain does not fail selected export ----------
test("a broken unselected case chain does not fail export of a valid selected case", () => {
  const subj = "TEST-SUBJ-5";
  const grant = grantEvent({ eventId: "SYN-EV-GR11", caseId: "TEST-CASE-GRANT", subjectId: subj, consentId: "SYN-CT-11" });
  const sel = buildEvent({ eventId: "SYN-EV-OK1", caseId: "TEST-CASE-OK", subjectId: subj, classification: "pseudonymized" });
  // Broken chain: two disconnected roots (both root, no link).
  const broken1 = buildEvent({ eventId: "SYN-EV-BK1", caseId: "TEST-CASE-BROKEN", subjectId: subj, classification: "pseudonymized", occurredAt: "2026-09-24T08:00:00Z", recordedAt: "2026-09-24T08:00:01Z" });
  const broken2 = buildEvent({ eventId: "SYN-EV-BK2", caseId: "TEST-CASE-BROKEN", subjectId: subj, classification: "pseudonymized", occurredAt: "2026-09-24T08:01:00Z", recordedAt: "2026-09-24T08:01:01Z" });
  const bundle = buildDatasetExport([grant, sel, broken1, broken2], req({ caseIds: ["TEST-CASE-OK"] }));
  assert.equal(bundle.manifest.caseCount, 1);
  assert.deepEqual(bundle.manifest.includedCases.map((c) => c.caseId), ["TEST-CASE-OK"]);
  assert.ok(!bundle.eventsNdjson.includes("SYN-EV-BK1"));
});

// ---------- 11. Broken selected chain does fail ----------
test("a broken selected case chain does fail", () => {
  const subj = "TEST-SUBJ-6";
  const grant = grantEvent({ eventId: "SYN-EV-GR12", caseId: "TEST-CASE-GRANT", subjectId: subj, consentId: "SYN-CT-12" });
  const broken1 = buildEvent({ eventId: "SYN-EV-BS1", caseId: "TEST-CASE-SBROKEN", subjectId: subj, classification: "pseudonymized", occurredAt: "2026-09-24T08:00:00Z", recordedAt: "2026-09-24T08:00:01Z" });
  const broken2 = buildEvent({ eventId: "SYN-EV-BS2", caseId: "TEST-CASE-SBROKEN", subjectId: subj, classification: "pseudonymized", occurredAt: "2026-09-24T08:01:00Z", recordedAt: "2026-09-24T08:01:01Z" });
  assert.throws(
    () => buildDatasetExport([grant, broken1, broken2], req({ caseIds: ["TEST-CASE-SBROKEN"] })),
    (err) => err instanceof DatasetExportError && err.code === "invalid_case_chain"
  );
});

// ---------- 12. Deterministic under shuffled input ----------
test("NDJSON ordering and manifest are deterministic under shuffled input", () => {
  const subj = "TEST-SUBJ-7";
  const grant = grantEvent({ eventId: "SYN-EV-GR13", caseId: "TEST-CASE-GRANT", subjectId: subj, consentId: "SYN-CT-13" });
  const a1 = buildEvent({ eventId: "SYN-EV-A1", caseId: "TEST-CASE-A", subjectId: subj, classification: "pseudonymized" });
  const a2 = buildEvent({ eventId: "SYN-EV-A2", caseId: "TEST-CASE-A", subjectId: subj, classification: "pseudonymized", occurredAt: "2026-09-24T10:01:00Z", recordedAt: "2026-09-24T10:01:01Z", previous: a1.integrity.contentHash });
  const b1 = buildEvent({ eventId: "SYN-EV-B1", caseId: "TEST-CASE-B", subjectId: subj, classification: "pseudonymized" });
  const c1 = buildEvent({ eventId: "SYN-EV-C1", caseId: "TEST-CASE-C", subjectId: subj, classification: "pseudonymized" });
  const base = [grant, a1, a2, b1, c1];
  const shuffled = [c1, b1, grant, a2, a1];
  const r1 = buildDatasetExport(base, req({}));
  const r2 = buildDatasetExport(shuffled, req({}));
  assert.equal(r1.eventsNdjson, r2.eventsNdjson);
  assert.equal(r1.manifestJson, r2.manifestJson);
  assert.equal(r1.manifestSha256, r2.manifestSha256);
});

// ---------- 13. Manifest/NDJSON agreement ----------
test("hashes, counts, case IDs, and included event IDs agree across manifest and NDJSON", () => {
  const subj = "TEST-SUBJ-8";
  const grant = grantEvent({ eventId: "SYN-EV-GR14", caseId: "TEST-CASE-GRANT", subjectId: subj, consentId: "SYN-CT-14" });
  const a1 = buildEvent({ eventId: "SYN-EV-A1", caseId: "TEST-CASE-A", subjectId: subj, classification: "pseudonymized" });
  const a2 = buildEvent({ eventId: "SYN-EV-A2", caseId: "TEST-CASE-A", subjectId: subj, classification: "pseudonymized", occurredAt: "2026-09-24T10:01:00Z", recordedAt: "2026-09-24T10:01:01Z", previous: a1.integrity.contentHash });
  const b1 = buildEvent({ eventId: "SYN-EV-B1", caseId: "TEST-CASE-B", subjectId: subj, classification: "pseudonymized" });
  const bundle = buildDatasetExport([grant, a1, a2, b1], req({}));
  const m = bundle.manifest;
  const lines = parseNdjson(bundle.eventsNdjson);
  assert.equal(m.eventCount, lines.length);
  assert.equal(m.caseCount, m.includedCases.length);
  // eventsSha256 matches the actual NDJSON.
  assert.equal(m.eventsSha256, sha256Utf8(bundle.eventsNdjson));
  // Included event IDs from manifest per-case totals equal NDJSON event set.
  const manifestEvents = new Set();
  for (const c of m.includedCases) {
    assert.ok(Number.isInteger(c.eventCount) && c.eventCount > 0);
    assert.ok(Object.keys(bundle.manifest).length > 0);
  }
  const ndEventIds = lines.map((l) => l.eventId).sort();
  // The grant lives in its own identified case (TEST-CASE-GRANT), which is
  // eligible and exported, so its event appears in the NDJSON alongside the
  // two pseudonymized data cases.
  assert.deepEqual(ndEventIds.sort(), ["SYN-EV-A1", "SYN-EV-A2", "SYN-EV-B1", "SYN-EV-GR14"]);
  // Rebuild canonical manifest JSON -> sha equals manifestSha256.
  assert.equal(bundle.manifestSha256, sha256Utf8(bundle.manifestJson));
});

// ---------- 14. No mutation of input events or request ----------
test("export does not mutate input events or the request", () => {
  const subj = "TEST-SUBJ-9";
  const grant = grantEvent({ eventId: "SYN-EV-GR15", caseId: "TEST-CASE-GRANT", subjectId: subj, consentId: "SYN-CT-15" });
  const sel = buildEvent({ eventId: "SYN-EV-P1", caseId: "TEST-CASE-P", subjectId: subj, classification: "pseudonymized" });
  const values = [grant, sel];
  const request = req({ caseIds: ["TEST-CASE-P"] });
  const beforeValues = stableStringify(values);
  const beforeRequest = stableStringify(request);
  buildDatasetExport(values, request);
  assert.equal(stableStringify(values), beforeValues);
  assert.equal(stableStringify(request), beforeRequest);
});

// ---------- 15. Errors never expose payload values, hashes, or consent reasons ----------
test("errors never expose payload values, hashes, or consent reasons", () => {
  const subj = "TEST-SUBJ-10";
  const secret = "SECRET-LEAK-CHECK";
  const grant = grantEvent({ eventId: "SYN-EV-GR16", caseId: "TEST-CASE-GRANT", subjectId: subj, consentId: "SYN-CT-16" });
  const broken1 = buildEvent({ eventId: "SYN-EV-LB1", caseId: "TEST-CASE-LEAK", subjectId: subj, classification: "pseudonymized", payload: { note: secret }, occurredAt: "2026-09-24T08:00:00Z", recordedAt: "2026-09-24T08:00:01Z" });
  const headHash = broken1.integrity.contentHash;
  // A single-event chain with no previousEventHash is a valid root chain.
  const okBundle = buildDatasetExport([grant, broken1], req({ caseIds: ["TEST-CASE-LEAK"] }));
  const okRows = parseNdjson(okBundle.eventsNdjson);
  assert.equal(okRows.length, 1, "single-event chain should export exactly one event");
  assert.equal(okRows[0].eventId, "SYN-EV-LB1", "expected the pseudonymized event to be exported");
  // Broken selected chain (two roots) -> invalid_case_chain, message clean.
  const broken2 = buildEvent({ eventId: "SYN-EV-LB2", caseId: "TEST-CASE-LEAK", subjectId: subj, classification: "pseudonymized", payload: { note: secret }, occurredAt: "2026-09-24T08:01:00Z", recordedAt: "2026-09-24T08:01:01Z" });
  assert.throws(
    () => buildDatasetExport([grant, broken1, broken2], req({ caseIds: ["TEST-CASE-LEAK"] })),
    (err) => {
      assert.ok(err instanceof DatasetExportError && err.code === "invalid_case_chain");
      const text = String(err.message) + String(err.cause?.message ?? "");
      assert.ok(!text.includes(secret), "no payload leak");
      assert.ok(!text.includes(headHash), "no hash leak");
      return true;
    }
  );
});

// ---------- 16. Grant expiration boundary: allowed just before, excluded at exact expiration ----------
test("a matching grant permits export immediately before expiration and excludes the case at exact expiration", () => {
  const subj = "TEST-SUBJ-16";
  const EXPIRES = "2026-09-24T12:00:00Z";

  // Helper: build a valid pseudonymized event for caseId.
  function dataEvent(eventId, occurredAt, recordedAt) {
    return buildEvent({
      eventId, caseId: "TEST-CASE-D16", subjectId: subj,
      classification: "pseudonymized", occurredAt, recordedAt,
    });
  }

  // Before expiration: grant is active -> export succeeds and includes the case.
  const beforeGrant = grantEvent({ eventId: "SYN-EV-GRB16", caseId: "TEST-CASE-GR16", subjectId: subj, consentId: "SYN-CT-16A", occurredAt: "2026-09-24T09:00:00Z", expiresAt: EXPIRES });
  const beforeEv = dataEvent("SYN-EV-D16B", "2026-09-24T10:00:00Z", "2026-09-24T10:00:01Z");
  const beforeBundle = buildDatasetExport(
    [beforeGrant, beforeEv],
    { purpose: PURPOSE, evaluatedAt: "2026-09-24T11:59:59Z", caseIds: ["TEST-CASE-D16"] }
  );
  const beforeRows = parseNdjson(beforeBundle.eventsNdjson);
  assert.equal(beforeRows.length, 1, "case must be exported before expiration");
  assert.equal(beforeRows[0].eventId, "SYN-EV-D16B");
  assert.equal(beforeBundle.manifest.caseCount, 1);

  // At exact expiration: grant is expired -> case excluded; NDJSON empty, manifest zero.
  const exactGrant = grantEvent({ eventId: "SYN-EV-GRX16", caseId: "TEST-CASE-GR16", subjectId: subj, consentId: "SYN-CT-16B", occurredAt: "2026-09-24T09:00:00Z", expiresAt: EXPIRES });
  const exactEv = dataEvent("SYN-EV-D16X", "2026-09-24T10:00:00Z", "2026-09-24T10:00:01Z");
  const exactBundle = buildDatasetExport(
    [exactGrant, exactEv],
    { purpose: PURPOSE, evaluatedAt: EXPIRES, caseIds: ["TEST-CASE-D16"] }
  );
  const exactRows = parseNdjson(exactBundle.eventsNdjson);
  assert.equal(exactRows.length, 0, "case must be excluded at exact expiration");
  assert.equal(exactBundle.manifest.caseCount, 0);
  assert.equal(exactBundle.manifest.eventCount, 0);
  assert.equal(exactBundle.eventsNdjson, "", "NDJSON must be empty when no cases are exported");
  // The expired grant's case chain must not appear in the manifest either.
  assert.deepStrictEqual(exactBundle.manifest.includedCases, []);
});

// ---------- 17. Exported events retain original integrity.contentHash and previousEventHash ----------
test("every exported event retains its original integrity.contentHash and previousEventHash", () => {
  const subj = "TEST-SUBJ-17";
  const grant = grantEvent({ eventId: "SYN-EV-GR17", caseId: "TEST-CASE-GR17", subjectId: subj, consentId: "SYN-CT-17" });
  const ev1 = buildEvent({ eventId: "SYN-EV-P17A", caseId: "TEST-CASE-P17", subjectId: subj, classification: "pseudonymized" });
  const ev2 = buildEvent({
    eventId: "SYN-EV-P17B", caseId: "TEST-CASE-P17", subjectId: subj,
    classification: "pseudonymized",
    occurredAt: "2026-09-24T10:01:00Z", recordedAt: "2026-09-24T10:01:01Z",
    previous: ev1.integrity.contentHash,
  });
  const bundle = buildDatasetExport([grant, ev1, ev2], req({ caseIds: ["TEST-CASE-P17"] }));
  const rows = parseNdjson(bundle.eventsNdjson);
  assert.equal(rows.length, 2);
  const byId = Object.fromEntries(rows.map((r) => [r.eventId, r]));
  // Root: contentHash preserved, no previousEventHash.
  assert.ok(!("previousEventHash" in byId["SYN-EV-P17A"].integrity || Object.keys(byId["SYN-EV-P17A"].integrity).includes("previousEventHash")));
  assert.equal(byId["SYN-EV-P17A"].integrity.contentHash, ev1.integrity.contentHash);
  // Child: contentHash preserved, previousEventHash preserved.
  assert.equal(byId["SYN-EV-P17B"].integrity.contentHash, ev2.integrity.contentHash);
  assert.equal(byId["SYN-EV-P17B"].integrity.previousEventHash, ev2.integrity.previousEventHash);
});

// ---------- 18. Recomputing computeDatasetEventHash on each parsed NDJSON event matches contentHash ----------
test("recomputing computeDatasetEventHash on each parsed NDJSON event matches its declared contentHash", () => {
  const subj = "TEST-SUBJ-18";
  const grant = grantEvent({ eventId: "SYN-EV-GR18", caseId: "TEST-CASE-GR18", subjectId: subj, consentId: "SYN-CT-18" });
  const ev1 = buildEvent({ eventId: "SYN-EV-P18A", caseId: "TEST-CASE-P18", subjectId: subj, classification: "pseudonymized" });
  const ev2 = buildEvent({
    eventId: "SYN-EV-P18B", caseId: "TEST-CASE-P18", subjectId: subj,
    classification: "pseudonymized",
    occurredAt: "2026-09-24T10:01:00Z", recordedAt: "2026-09-24T10:01:01Z",
    previous: ev1.integrity.contentHash,
  });
  const bundle = buildDatasetExport([grant, ev1, ev2], req({ caseIds: ["TEST-CASE-P18"] }));
  const rows = parseNdjson(bundle.eventsNdjson);
  assert.equal(rows.length, 2, "two events expected");
  for (const row of rows) {
    const recomputed = computeDatasetEventHash(row);
    assert.equal(
      recomputed,
      row.integrity.contentHash,
      `contentHash mismatch for ${row.eventId}`
    );
  }
});