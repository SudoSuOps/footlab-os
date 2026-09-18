# Flight Sheet — V1 Specification

## Definition

A Flight Sheet is the concise, chronological operating record for one client's FootLab journey. It is designed to make changes, actions, devices, feedback, and ownership understandable without forcing a reviewer to reconstruct the story from folders of images.

It is not a substitute for a licensed clinician's medical record.

## Canonical projection

The Flight Sheet is a human-readable projection of canonical FootLabOS events into the client's trusted NAS vault:

```text
/mnt/synology/openfootlab/footos/clients/<CLIENT_ID>/flights/
```

Observed BlockZero example:

```text
FLT-F001-000001.md
```

The Flight Sheet is not a second database and must not become a manually maintained shadow record. PostgreSQL/event state, trusted capture packages, manifests, receipts, device lineage, and explicit human dispositions remain the underlying sources of truth.

## Sections

### Header
- Client reference
- Flight ID
- Enrollment/start date
- Monitoring cadence
- Current device/insert version
- Current open actions
- Consent/share state summary

### Baseline
- Capture set used as baseline
- Foot/side coverage
- Relevant client-reported context
- Reviewer/date
- References to BlockZero baseline/monitoring-plan artifacts

### Timeline events
Each event contains:
- event ID
- timestamp
- type
- author/actor
- source
- structured facts
- attachments/references
- review status
- follow-up due date if any

### Capture lineage
- capture request/event ID
- required image slots
- capture completion
- trusted ingest status
- manifest reference/hash
- ingest receipt reference/hash
- trusted NAS store path

### Device lineage
- Design requirement ID
- Insert/device version
- Design revision
- material/process
- fabrication record
- QA result
- delivery date
- wear feedback
- superseded-by relation

### Open actions
An action has one owner, one state, and one next expected step.

## Event types

- `capture_requested`
- `sms_queued`
- `sms_sent`
- `sms_delivered`
- `sms_failed`
- `capture_link_opened`
- `capture_started`
- `capture_completed`
- `capture_ready_for_ingest`
- `capture_ingested`
- `observation_created`
- `change_flagged`
- `operator_reviewed`
- `clinical_review_requested`
- `clinical_review_recorded`
- `client_message_sent`
- `design_requirement_created`
- `design_version_created`
- `fabrication_started`
- `fabrication_qa_recorded`
- `device_delivered`
- `wear_feedback_recorded`
- `adjustment_requested`
- `consent_changed`

## Storage relationship

The Client Vault directory contract is defined in:

```text
docs/architecture/CLIENT_VAULT_SPEC.md
```

A Flight Sheet may reference files in the vault, but should not duplicate original media or private identity/contact data.

## Design rule

The Flight Sheet is generated from canonical events and trusted artifacts. Staff should not manually maintain a second shadow narrative that can drift from the event history.
