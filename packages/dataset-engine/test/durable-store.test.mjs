import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DurableDatasetEventStore,
  DurableStoreError,
  DatasetStoreError,
  computeDatasetEventHash,
  buildDatasetExport,
} from "../src/index.ts";

function event(id, caseId = "SYN-CASE-DURABLE", previousEventHash) {
  const value = {
    schemaVersion: "1.0.0",
    eventId: id,
    caseId,
    subjectId: "SYN-SUBJECT-DURABLE",
    eventType: "observation_recorded",
    occurredAt: "2026-09-24T10:00:00Z",
    recordedAt: "2026-09-24T10:00:00Z",
    actor: { id: "SYN-ACTOR", type: "system" },
    dataClassification: "synthetic",
    source: { producerName: "SYN-TEST", producerVersion: "1" },
    consentEvidence: {
      decision: "synthetic_exemption",
      evaluatedAt: "2026-09-24T10:00:00Z",
      evidenceEventIds: [],
      reason: "synthetic_data",
    },
    artifactReferences: [],
    provenance: { inputEventIds: [] },
    payload: { note: "fictional" },
    integrity: { algorithm: "sha256", contentHash: "0".repeat(64),
      ...(previousEventHash === undefined ? {} : { previousEventHash }) },
  };
  value.integrity.contentHash = computeDatasetEventHash(value);
  return value;
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "flo-journal-test-"));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function assertDurableCode(fn, code) {
  assert.throws(fn, (error) => error instanceof DurableStoreError && error.code === code);
}

test("durable: commit batches, reopen, preserve event hashes and case heads", () => withDir((dir) => {
  const first = event("SYN-EV-ONE");
  const second = event("SYN-EV-TWO", first.caseId, first.integrity.contentHash);
  let store = DurableDatasetEventStore.open(dir);
  assert.deepEqual(store.appendBatch([first, second]).map((e) => e.eventId), [first.eventId, second.eventId]);
  const head = store.getJournalHead();
  assert.equal(head.sequence, 1);
  store.close();

  store = DurableDatasetEventStore.open(dir);
  assert.equal(store.size, 2);
  assert.deepEqual(store.getByEventId(first.eventId), first);
  assert.equal(store.getCaseHead(first.caseId).contentHash, second.integrity.contentHash);
  assert.deepEqual(store.getJournalHead(), head);
  const third = event("SYN-EV-THREE", first.caseId, second.integrity.contentHash);
  store.append(third);
  store.close();

  store = DurableDatasetEventStore.open(dir);
  assert.equal(store.size, 3);
  assert.equal(store.getJournalHead().sequence, 2);
  assert.deepEqual(store.listByCaseId(first.caseId).map((e) => e.eventId),
    [first.eventId, second.eventId, third.eventId]);
  store.close();
}));

test("durable: rejected batch makes no disk change and the next append succeeds", () => withDir((dir) => {
  const store = DurableDatasetEventStore.open(dir);
  const first = event("SYN-EV-ONE");
  store.append(first);
  const before = readdirSync(dir).filter((s) => s.endsWith(".json"));
  assert.throws(() => store.appendBatch([
    event("SYN-EV-TWO", first.caseId, first.integrity.contentHash),
    event("SYN-EV-ONE", first.caseId, first.integrity.contentHash),
  ]), (error) => error instanceof DatasetStoreError && error.code === "duplicate_event_id");
  assert.deepEqual(readdirSync(dir).filter((s) => s.endsWith(".json")), before);
  assert.equal(store.size, 1);
  store.append(event("SYN-EV-TWO", first.caseId, first.integrity.contentHash));
  store.close();
  const reopened = DurableDatasetEventStore.open(dir);
  assert.equal(reopened.size, 2);
  reopened.close();
}));

test("durable: one writer lock and closed handles cannot read or write", () => withDir((dir) => {
  const store = DurableDatasetEventStore.open(dir);
  assertDurableCode(() => DurableDatasetEventStore.open(dir), "locked");
  store.close();
  assertDurableCode(() => store.append(event("SYN-EV-ONE")), "closed");
  assertDurableCode(() => store.listAll(), "closed");
  const reopened = DurableDatasetEventStore.open(dir);
  reopened.close();
}));

test("durable: reject accessible or symlinked journal directories", () => withDir((dir) => {
  chmodSync(dir, 0o755);
  assertDurableCode(() => DurableDatasetEventStore.open(dir), "invalid_directory");
  chmodSync(dir, 0o700);
  const link = `${dir}-link`;
  symlinkSync(dir, link);
  try {
    assertDurableCode(() => DurableDatasetEventStore.open(link), "invalid_directory");
  } finally {
    rmSync(link);
  }
}));

test("durable: orphan pending file cannot become an event", () => withDir((dir) => {
  const store = DurableDatasetEventStore.open(dir);
  store.append(event("SYN-EV-ONE"));
  store.close();
  writeFileSync(join(dir, `.pending-${"a".repeat(32)}`), "partial");
  const reopened = DurableDatasetEventStore.open(dir);
  assert.equal(reopened.size, 1);
  reopened.close();
}));

test("durable: reject changed journal bytes and never load unverified data", () => withDir((dir) => {
  const store = DurableDatasetEventStore.open(dir);
  store.append(event("SYN-EV-ONE"));
  store.close();
  const name = readdirSync(dir).find((s) => s.endsWith(".json"));
  const path = join(dir, name);
  writeFileSync(path, readFileSync(path, "utf8").replace("fictional", "altered"));
  assertDurableCode(() => DurableDatasetEventStore.open(dir), "corrupt_journal");
  assert.ok(!readdirSync(dir).includes(".writer-lock"));
}));

test("durable: external checkpoint detects missing tail and verifies the complete log", () => withDir((dir) => {
  const store = DurableDatasetEventStore.open(dir);
  const first = event("SYN-EV-ONE");
  store.append(first);
  store.append(event("SYN-EV-TWO", first.caseId, first.integrity.contentHash));
  const checkpoint = store.getJournalHead();
  store.close();
  const complete = DurableDatasetEventStore.open(dir, checkpoint);
  assert.equal(complete.size, 2);
  complete.close();
  const last = readdirSync(dir).find((name) => name.startsWith("000000000002-"));
  rmSync(join(dir, last));
  assertDurableCode(() => DurableDatasetEventStore.open(dir, checkpoint), "corrupt_journal");
}));

test("durable: reject gaps, unknown files, and unexpected directory links", () => withDir((dir) => {
  const store = DurableDatasetEventStore.open(dir);
  store.append(event("SYN-EV-ONE"));
  store.close();
  const name = readdirSync(dir).find((s) => s.endsWith(".json"));
  const path = join(dir, name);
  const bytes = readFileSync(path);
  rmSync(path);
  writeFileSync(join(dir, name.replace(/^000000000001/, "000000000002")), bytes);
  assertDurableCode(() => DurableDatasetEventStore.open(dir), "corrupt_journal");
  rmSync(join(dir, name.replace(/^000000000001/, "000000000002")));
  writeFileSync(join(dir, "unknown.txt"), "unexpected");
  assertDurableCode(() => DurableDatasetEventStore.open(dir), "corrupt_journal");
  assertDurableCode(() => DurableDatasetEventStore.open(join(dir, "unknown.txt")), "invalid_directory");
}));

test("durable: export from recovered store keeps original hashes and consent semantics", () => withDir((dir) => {
  const store = DurableDatasetEventStore.open(dir);
  const first = event("SYN-EV-ONE");
  store.append(first);
  store.close();
  const reopened = DurableDatasetEventStore.open(dir);
  const bundle = buildDatasetExport(reopened.listAll(), {
    purpose: "model_training", evaluatedAt: "2026-09-24T12:00:00Z", caseIds: [first.caseId],
  });
  assert.equal(bundle.manifest.eventCount, 1);
  assert.equal(JSON.parse(bundle.eventsNdjson).integrity.contentHash, first.integrity.contentHash);
  reopened.close();
}));
