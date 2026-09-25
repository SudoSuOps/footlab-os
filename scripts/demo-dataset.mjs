// FLO Dataset Engine end-to-end demonstration.
//
// All identifiers are fictional (TEST-/SYN- prefixed) and all payloads are
// harmless invented values. dataClassification is "pseudonymized" to
// exercise the consent rules; this does NOT demonstrate a deidentification
// process. No networking, SMS, or model calls. The durable demonstration
// uses a temporary local journal and removes it on completion.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryDatasetEventStore,
  DurableDatasetEventStore,
  DatasetStoreError,
  buildDatasetExport,
  computeDatasetEventHash,
  evaluateConsent,
} from "../packages/dataset-engine/src/index.ts";

// ---------- fixed fictional scenario constants ----------

const PURPOSE = "model_training";

const TS = {
  grant: "2026-09-24T09:00:00Z",
  obs1: "2026-09-24T10:00:00Z",
  obs1Recorded: "2026-09-24T10:00:01Z",
  obs2: "2026-09-24T10:30:00Z",
  obs2Recorded: "2026-09-24T10:30:01Z",
  export1: "2026-09-24T12:00:00Z",
  revoke: "2026-09-24T13:00:00Z",
  export2: "2026-09-24T14:00:00Z",
};

const IDS = {
  subject: "TEST-SUBJ-0001",
  consentCase: "TEST-CASE-CONSENT-0001",
  dataCase: "TEST-CASE-DATA-0001",
  consentId: "TEST-CT-0001",
  grantEvent: "TEST-EV-GRANT-0001",
  obs1Event: "TEST-EV-OBS-0001",
  obs2Event: "TEST-EV-OBS-0002",
  revokeEvent: "TEST-EV-REVOKE-0001",
  actor: "SYN-ACTOR-DEMO",
  producer: "SYN-DEMO-PRODUCER",
};

function makeEvent({
  eventId,
  caseId,
  eventType,
  occurredAt,
  recordedAt,
  evidenceEvaluatedAt,
  payload,
  previousEventHash,
}) {
  // All non-integrity fields are finalized before the content hash is
  // computed; the placeholder is overwritten with the canonical hash.
  const event = {
    schemaVersion: "1.0.0",
    eventId,
    caseId,
    subjectId: IDS.subject,
    eventType,
    occurredAt,
    recordedAt,
    actor: { id: IDS.actor, type: "system" },
    dataClassification: "pseudonymized",
    source: { producerName: IDS.producer, producerVersion: "1.0.0" },
    consentEvidence: {
      decision: "allowed",
      purpose: PURPOSE,
      evaluatedAt: evidenceEvaluatedAt,
      evidenceEventIds: [],
      reason: "active_consent",
    },
    artifactReferences: [],
    provenance: { inputEventIds: [] },
    payload,
    integrity: {
      algorithm: "sha256",
      contentHash: "0".repeat(64),
      ...(previousEventHash ? { previousEventHash } : {}),
    },
  };
  event.integrity.contentHash = computeDatasetEventHash(event);
  return event;
}

// ---------- 1. construction: valid events, hashed after finalization ----------

const grant = makeEvent({
  eventId: IDS.grantEvent,
  caseId: IDS.consentCase,
  eventType: "consent_granted",
  occurredAt: TS.grant,
  recordedAt: TS.grant,
  evidenceEvaluatedAt: TS.grant,
  payload: { consentId: IDS.consentId, purpose: PURPOSE },
});

const obs1 = makeEvent({
  eventId: IDS.obs1Event,
  caseId: IDS.dataCase,
  eventType: "observation_recorded",
  occurredAt: TS.obs1,
  recordedAt: TS.obs1Recorded,
  evidenceEvaluatedAt: TS.export1,
  payload: {
    note: "Invented observation: fictitious step cadence",
    metricName: "invented-step-cadence",
    value: 1,
  },
});

// Data-case chain: observation 2 links to observation 1's content hash.
const obs2 = makeEvent({
  eventId: IDS.obs2Event,
  caseId: IDS.dataCase,
  eventType: "observation_recorded",
  occurredAt: TS.obs2,
  recordedAt: TS.obs2Recorded,
  evidenceEvaluatedAt: TS.export1,
  payload: {
    note: "Invented observation: fictitious gait phase",
    metricName: "invented-gait-phase",
    value: 0.5,
  },
  previousEventHash: obs1.integrity.contentHash,
});

assert.equal(
  obs2.integrity.previousEventHash,
  obs1.integrity.contentHash,
  "data case chain must link observation 2 to observation 1",
);
for (const event of [grant, obs1, obs2]) {
  assert.ok(
    /^[0-9a-f]{64}$/.test(event.integrity.contentHash),
    "every event must carry a 64-char lowercase sha256 contentHash",
  );
}
console.log(
  "1. construction: 3 valid events built (1 consent grant, 2 linked " +
    "observations); fields finalized before canonical sha256 hashing",
);

// ---------- 2. append-only storage through the real store API ----------

const store = new InMemoryDatasetEventStore();
store.append(grant);
store.append(obs1);
store.append(obs2);
assert.equal(store.size, 3, "store must hold the three appended events");

// Append-only: re-appending an existing eventId is rejected and leaves the
// store unchanged.
assert.throws(
  () => store.append(obs1),
  (err) =>
    err instanceof DatasetStoreError && err.code === "duplicate_event_id",
  "duplicate eventId must be rejected as duplicate_event_id",
);
assert.equal(store.size, 3, "rejected append must leave the store unchanged");
assert.equal(
  store
    .listByCaseId(IDS.dataCase)
    .map((e) => e.eventId)
    .join(","),
  `${IDS.obs1Event},${IDS.obs2Event}`,
  "data case must contain exactly the two observation events",
);
assert.equal(
  store.getCaseHead(IDS.dataCase).contentHash,
  obs2.integrity.contentHash,
  "data case head must be observation 2",
);
console.log(
  "2. storage: 3 events appended (per-case hash chains preserved); " +
    "duplicate re-append rejected, store unchanged",
);

// ---------- 3. consent evaluation over the stored snapshot ----------

const consentBefore = evaluateConsent(store.listAll(), {
  subjectId: IDS.subject,
  dataClassification: "pseudonymized",
  purpose: PURPOSE,
  evaluatedAt: TS.export1,
});
assert.equal(consentBefore.decision, "allowed");
assert.equal(consentBefore.reason, "active_consent");
assert.deepEqual(consentBefore.evidenceEventIds, [IDS.grantEvent]);
console.log(
  `3. consent: ${consentBefore.decision} (${consentBefore.reason}), ` +
    `evidence [${consentBefore.evidenceEventIds.join(", ")}]`,
);

// ---------- 4. permitted export selecting only the data case ----------

const bundle1 = buildDatasetExport(store.listAll(), {
  purpose: PURPOSE,
  evaluatedAt: TS.export1,
  caseIds: [IDS.dataCase],
});
assert.equal(bundle1.manifest.eventCount, 2);
assert.equal(bundle1.manifest.caseCount, 1);
assert.equal(bundle1.manifest.excludedCaseCount, 0);
assert.deepEqual(
  bundle1.manifest.includedCases.map((c) => c.caseId),
  [IDS.dataCase],
);
assert.equal(bundle1.manifest.includedCases[0].consentDecision, "allowed");
assert.deepEqual(
  bundle1.manifest.includedCases[0].consentEvidenceEventIds,
  [IDS.grantEvent],
);

const exported1 = bundle1.eventsNdjson
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => JSON.parse(line));
assert.equal(exported1.length, 2);
assert.deepEqual(
  exported1.map((e) => e.eventId).sort(),
  [IDS.obs1Event, IDS.obs2Event],
  "exactly the two observation events must be exported",
);
for (const line of exported1) {
  // Original hashes preserved through export...
  assert.equal(
    line.integrity.contentHash,
    store.getByEventId(line.eventId).integrity.contentHash,
    `exported event ${line.eventId} must preserve its original contentHash`,
  );
  // ...and the exported bytes still hash to the same canonical value.
  assert.equal(
    computeDatasetEventHash(line),
    line.integrity.contentHash,
    `recomputed hash must match for event ${line.eventId}`,
  );
}
// The grant's consent case was used only as consent evidence; it is not
// selected and must not appear in the bundle.
assert.ok(!bundle1.eventsNdjson.includes(IDS.consentCase));
assert.ok(!bundle1.manifestJson.includes(IDS.consentCase));

// Snapshot the produced artifact now; stage 7 proves it is unchanged after
// the revocation is appended.
const bundle1Snapshot = {
  manifestJson: bundle1.manifestJson,
  eventsNdjson: bundle1.eventsNdjson,
  manifestSha256: createHash("sha256")
    .update(bundle1.manifestJson, "utf8")
    .digest("hex"),
};

console.log(
  `4. export #1 @ ${TS.export1} caseIds=[data case]: 2 observations ` +
    "exported, original hashes preserved and recomputed OK; grant case " +
    "used as consent evidence only, absent from the bundle",
);

// ---------- 5. append a revocation linked into the consent case ----------

const revoke = makeEvent({
  eventId: IDS.revokeEvent,
  caseId: IDS.consentCase,
  eventType: "consent_revoked",
  occurredAt: TS.revoke,
  recordedAt: TS.revoke,
  evidenceEvaluatedAt: TS.export2,
  payload: { consentId: IDS.consentId, reason: "subject_requested" },
  previousEventHash: grant.integrity.contentHash,
});
assert.equal(
  revoke.integrity.previousEventHash,
  grant.integrity.contentHash,
  "revocation must link to the consent case head (the grant)",
);
store.append(revoke);
assert.equal(
  store.getCaseHead(IDS.consentCase).eventId,
  IDS.revokeEvent,
  "consent case head must now be the revocation",
);
console.log(
  "5. revocation: linked to consent case head and appended via the store",
);

// ---------- 6. second export: excluded after revocation ----------

const bundle2 = buildDatasetExport(store.listAll(), {
  purpose: PURPOSE,
  evaluatedAt: TS.export2,
  caseIds: [IDS.dataCase],
});
assert.equal(bundle2.manifest.eventCount, 0, "no events may be exported");
assert.equal(bundle2.eventsNdjson, "");
assert.equal(bundle2.manifest.caseCount, 0);
assert.equal(bundle2.manifest.excludedCaseCount, 1);
assert.equal(bundle2.manifest.excludedCases[0].caseId, IDS.dataCase);
assert.equal(bundle2.manifest.excludedCases[0].reason, "consent_revoked");
assert.deepEqual(
  [...bundle2.manifest.excludedCases[0].consentEvidenceEventIds].sort(),
  [IDS.grantEvent, IDS.revokeEvent],
  "exclusion must cite both the grant and the revocation as evidence",
);

// Stored grant and observations remain unchanged by the revocation append.
assert.deepEqual(store.getByEventId(IDS.grantEvent), grant, "grant unchanged");
assert.deepEqual(store.getByEventId(IDS.obs1Event), obs1, "obs1 unchanged");
assert.deepEqual(store.getByEventId(IDS.obs2Event), obs2, "obs2 unchanged");
console.log(
  `6. export #2 @ ${TS.export2}: 0 events exported, data case excluded ` +
    "(consent_revoked); stored grant and observations unchanged",
);

// ---------- 7. the first bundle stands: revocation cannot recall exports ----------

assert.deepEqual(
  {
    manifestJson: bundle1.manifestJson,
    eventsNdjson: bundle1.eventsNdjson,
  },
  {
    manifestJson: bundle1Snapshot.manifestJson,
    eventsNdjson: bundle1Snapshot.eventsNdjson,
  },
  "bundle #1 bytes must be exactly what was produced in stage 4",
);
assert.equal(bundle1.manifestSha256, bundle1Snapshot.manifestSha256);
assert.deepEqual(
  JSON.parse(bundle1.manifestJson).includedCases.map((c) => c.caseId),
  [IDS.dataCase],
  "bundle #1 still reports the data case with its two observations",
);
console.log(
  "7. bundle #1 unchanged: revocation changes subsequent export " +
    "eligibility only; it cannot recall an already produced export",
);

// ---------- 8. persist, restart, verify, export, revoke, restart ----------

const journalDirectory = mkdtempSync(join(tmpdir(), "flo-dataset-demo-"));
let durable;
try {
  durable = DurableDatasetEventStore.open(journalDirectory);
  durable.appendBatch([grant, obs1, obs2]);
  const beforeHead = durable.getJournalHead();
  durable.close();
  durable = DurableDatasetEventStore.open(journalDirectory, beforeHead);
  assert.deepEqual(durable.listAll(), [grant, obs1, obs2]);
  const recoveredBundle1 = buildDatasetExport(durable.listAll(), {
    purpose: PURPOSE, evaluatedAt: TS.export1, caseIds: [IDS.dataCase],
  });
  assert.equal(recoveredBundle1.eventsNdjson, bundle1.eventsNdjson);
  assert.equal(recoveredBundle1.manifestJson, bundle1.manifestJson);
  durable.append(revoke);
  const afterHead = durable.getJournalHead();
  durable.close();
  durable = DurableDatasetEventStore.open(journalDirectory, afterHead);
  assert.equal(durable.size, 4);
  const recoveredBundle2 = buildDatasetExport(durable.listAll(), {
    purpose: PURPOSE, evaluatedAt: TS.export2, caseIds: [IDS.dataCase],
  });
  assert.equal(recoveredBundle2.eventsNdjson, "");
  assert.equal(recoveredBundle2.manifest.excludedCases[0].reason, "consent_revoked");
  console.log("8. durable journal: two reopen/replay cycles verified; consent-gated exports retain the same result");
} finally {
  durable?.close();
  rmSync(journalDirectory, { recursive: true, force: true });
}

console.log("PASS");
