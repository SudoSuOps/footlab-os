# Client Vault V1 — Trusted NAS Record

## Purpose

The Client Vault is the durable, client-scoped system of record for FootLabOS after an Edge capture is verified and ingested.

The Edge appliance performs capture, validation, temporary staging, hashing, manifest generation, and handoff. The trusted NAS retains the durable client record.

## Canonical root

```text
/mnt/synology/openfootlab/footos/clients/<CLIENT_ID>
```

Observed BlockZero client:

```text
/mnt/synology/openfootlab/footos/clients/F001
```

## V1 directory contract

```text
F001/
├── README.md
├── audit/
├── block-zero/
│   ├── BLOCK-ZERO.md
│   ├── COMMUNICATION-PREFERENCES.md
│   ├── FOOT-BASELINE.md
│   ├── IDS.md
│   ├── MONITORING-PLAN.md
│   └── STATUS.txt
├── care-team/
├── cgm-context/
├── flights/
├── geometry/
├── inserts/
├── in-service/
├── intake/
├── photos/
│   ├── originals/
│   └── derived/
├── private/
├── reports/
├── shoes/
└── wellness/
```

## Capture package contract

Original captures are retained by event and date:

```text
photos/originals/YYYY/MM/YYYY-MM-DD/<EVENT_ID>/
├── CAPTURE-GUIDE.md
├── INGEST-RECEIPT.md
├── INGEST-RECEIPT.sha256
├── manifest.json
├── manifest.sha256
├── originals.sha256
└── originals/
    ├── 01-right-plantar.jpg
    ├── 02-left-plantar.jpg
    ├── 03-right-targeted.jpg
    └── 04-left-targeted.jpg
```

The database field `trusted_store_path` points to this event-scoped trusted location after successful ingest.

## Domain ownership

- `private/`: identity/contact data; highest access sensitivity.
- `block-zero/`: initial operating baseline, identifiers, communication preferences, and monitoring plan.
- `intake/`: intake and build-plan inputs.
- `photos/originals/`: immutable source captures after trusted ingest.
- `photos/derived/`: generated/processed media derived from source captures.
- `flights/`: longitudinal operating records projected from canonical events.
- `audit/`: event- or operation-scoped audit records and receipts.
- `geometry/`: scans, measurements, and geometry artifacts.
- `inserts/`: device/insert lineage and versions.
- `in-service/`: post-delivery use, follow-up, and maintenance records.
- `shoes/`: shoe library and fit context.
- `care-team/`: consent-aware care-team context and routing references.
- `wellness/` and `cgm-context/`: optional longitudinal context governed by the client's monitoring plan.
- `reports/`: generated client/operator reports.

## Invariants

1. The NAS Client Vault is the durable trusted store; the Edge spool is temporary staging.
2. A source capture is not considered trusted until ingest completes and the event is marked `INGESTED`.
3. Original media is retained separately from derived media.
4. Hashes and ingest receipts preserve chain-of-custody evidence.
5. Client-facing/operator surfaces read from canonical data and project into the vault; they do not create competing shadow records.
6. The Flight Sheet in `flights/` is the longitudinal human-readable projection of canonical events.
7. Identity/contact data remains separated under `private/` from routine operational artifacts.
8. Folder names and event IDs are stable interfaces once used in production.

## BlockZero reference

The first proven package is:

```text
Client: F001
Event:  PHE-F001-000001
Flight: FLT-F001-000001
Status: INGESTED
```

This structure is the baseline contract for future client vaults unless a versioned migration explicitly changes it.
