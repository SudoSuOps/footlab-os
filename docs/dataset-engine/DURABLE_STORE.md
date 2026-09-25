# FLO Dataset Engine — Durable Local Journal V1

`DurableDatasetEventStore` adds local persistence to the validated event
contract. It is a single-writer file journal, with one atomic file per
nonempty batch. It has no database or external dependencies.

## Usage

```ts
import { DurableDatasetEventStore, buildDatasetExport } from
  "../../packages/dataset-engine/src/index.ts";

const store = DurableDatasetEventStore.open("/var/lib/footos/dataset-journal");
try {
  store.appendBatch(events); // throws before writing if an event is invalid
  const checkpoint = store.getJournalHead();
  // Save checkpoint in an independent, access-controlled backup or audit log.
  const bundle = buildDatasetExport(store.listAll(), request);
} finally {
  store.close();
}
```

Open with `DurableDatasetEventStore.open(path, checkpoint)` to detect a
missing/replaced tail relative to an independently retained checkpoint.
The API mirrors the in-memory store: `append`, `appendBatch`, `getByEventId`,
`listAll`, `listByCaseId`, `getCaseHead`, and `size`.

## Write and recovery contract

1. `open` creates the directory with mode `0700` if absent, acquires an
   exclusive `.writer-lock` directory, and replays every committed entry.
   Existing directories must also restrict group and other access; symlinked
   journal directories are rejected.
2. Replay requires contiguous sequence numbers, canonical serialization,
   SHA-256 batch hashes, global previous-batch hash links, valid event hashes,
   unique event IDs, and valid per-case chains. Unexpected entries fail closed.
3. `appendBatch` validates all events and case chains before writing. It writes
   a randomly named `.pending-*` file with mode `0600`, syncs the file, renames
   it to its sequence-and-hash name, and syncs the journal directory. An empty
   batch does not create a file. A failed validation leaves the journal alone.
4. After an uncertain I/O outcome, the instance closes and rejects further
   operations. Reopen to replay what actually committed; retry only after
   checking event IDs. Orphan `.pending-*` files are ignored on replay and can
   be examined or removed by an operator after stopping writers.
5. `close` releases the writer lock. A process crash may leave `.writer-lock`.
   Stop all writers, inspect the directory and mount, then remove the stale
   lock manually before reopening. No automatic stale-lock break is attempted.

Files are named `000000000001-<64-character-sha256>.json`. The batch hash
covers `format`, `sequence`, `previousBatchHash`, and the complete event array.
The first previous hash is 64 zeroes. The event hashes and case chains are
preserved, not recomputed into replacements.

## Deployment boundaries

- Use a trusted local filesystem with working file and directory `fsync`,
  atomic rename within the directory, and one writer process. NAS/CIFS/NFS
  crash and locking semantics must be validated separately before using this
  journal there. This package does not integrate with the Client Vault yet.
- The journal stores full event payloads in plaintext. Restrict filesystem
  access and use volume encryption and independent encrypted backups where
  client data is involved. The library does not encrypt or deidentify data.
- SHA-256 chains detect accidental changes and partial edits, but a party
  able to rewrite the whole directory can recalculate the hashes. Save the
  `{ sequence, batchHash }` checkpoint outside this directory to detect
  rollback or wholesale replacement. A checkpoint alone is not a signature.
- Back up the entire directory as a consistent stopped-writer snapshot;
  verify by opening the restored copy with its external checkpoint. Do not
  edit or selectively copy journal entries. Lock files and orphan pending
  files are operational state, not committed events.
- Replay and append preflight are currently linear in the event history. This
  foundation is for small local records; profile and migrate to a transaction
  database or segmented journal before large-scale production ingestion.
- A consent revocation gates subsequent exports. It cannot retract a bundle
  already sent to another recipient. Export distribution requires its own
  audited delivery and revocation process.

Try `npm run demo:dataset` to see a fictional consent grant, export, restart,
revocation, restart, and denied export. `npm run test:dataset` includes journal
recovery, corruption, lock, and checkpoint tests.
