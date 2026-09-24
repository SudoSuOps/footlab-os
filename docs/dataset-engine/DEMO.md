# FLO Dataset Engine — End-to-End Demo

A single-command, in-process demonstration of the dataset engine pipeline:
valid event construction, consent evaluation, append-only storage, permitted
export, and exclusion after revocation.

## Command

```bash
npm run demo:dataset
```

Runs `node --experimental-strip-types scripts/demo-dataset.mjs` (the same
Node type-stripping approach used by `test:dataset`).

## Expected behavior

The script prints one short result line per stage and a final `PASS`, and
exits zero. Any assertion failure throws and exits nonzero:

1. **construction** — three events are built: one `consent_granted` in the
   consent case and two linked `observation_recorded` events in the data
   case. Every field is finalized before `integrity.contentHash` is
   computed, and observation 2 preserves the per-case
   `previousEventHash` chain (it links to observation 1's content hash).
2. **storage** — events are appended through the real
   `InMemoryDatasetEventStore` API; the store rejects a duplicate
   `eventId` as `duplicate_event_id` and remains unchanged (append-only).
3. **consent** — `evaluateConsent` over the stored snapshot reports
   `allowed` (`active_consent`) for the subject, the
   `pseudonymized` classification, and the `model_training` purpose.
4. **export #1** — `buildDatasetExport` with explicit
   `caseIds: [data case]` and a fixed evaluation time exports exactly the
   two observation events. The grant lives in its own consent case: it is
   available as consent evidence but its case is not selected, and it does
   not appear in the bundle. Exported events preserve their original
   content hashes, and recomputing the canonical hash over the exported
   bytes matches.
5. **revocation** — a `consent_revoked` event linked to the consent case
   head (the grant) is appended through the store.
6. **export #2** — a second export at a later fixed evaluation time again
   selecting only the data case exports zero events; the manifest reports
   the data case as excluded with reason `consent_revoked`, citing both
   the grant and the revocation as evidence. The stored grant and
   observations are byte-identical to before the append.
7. **bundle #1 unchanged** — the first export bundle is exactly the
   artifact produced in stage 4 (manifest bytes, manifest hash, and event
   bytes all match the snapshot taken after stage 4). Revocation changes
   subsequent export eligibility only; it cannot recall an already
   produced export.

All timestamps are fixed constants (no `Date.now()`), and the single
purpose is `model_training`.

## Fictional data and classification

Every identifier is an invented `TEST-` or `SYN-` value; every payload is a
harmless invented value (a fictitious step cadence and gait phase). No real
client data is used, and nothing is read from the environment, files, or
the network.

`dataClassification` is `"pseudonymized"` so the fictional scenario
exercises the consent rules that apply to pseudonymized data. This does
**not** demonstrate a deidentification process — no pseudonymization or
deidentification is performed anywhere in the demo.

## Explicit selection

Exports are opt-in: the demo always passes `caseIds: [TEST-CASE-DATA-0001]`
explicitly. The consent grant's case is used by the consent evaluation as
evidence (a grant authorizes the subject's cases across the complete
validated collection) but is never selected and never appears in the
exported NDJSON or manifest.

## Revocation limitation

A revocation affects only exports built after it is recorded, at evaluation
times where it is in force. The already-produced first bundle is an
immutable artifact: the demo verifies its bytes and manifest hash are
unchanged after the revocation is appended. The demo does **not**
demonstrate recall or retraction of distributed copy artifacts; the
export engine has no such facility.

## In-memory limitation

`InMemoryDatasetEventStore` lives entirely in process memory: on exit the
event log, case chains, and both export bundles are gone. Nothing is
persisted to disk, and the demo performs no networking, SMS, or model
calls. This demonstrates the pipeline's behavior, not durable storage — a
production deployment needs a persistent, tamper-evident event log.
