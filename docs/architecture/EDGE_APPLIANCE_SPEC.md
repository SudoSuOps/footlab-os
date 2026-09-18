# FootLab Edge Appliance — V1 Specification

## Purpose

The Edge Appliance is the local trust anchor for a FootLab deployment. It stores the client's longitudinal record, performs local processing, serves staff workflows, and controls what may leave the local environment.

## Required capabilities

### Identity
- Unique appliance ID
- Site/owner binding
- Device certificate/key material
- Software and model version inventory

### Local client vault
- Client identifiers separated from media/object identifiers
- Encrypted media at rest
- Encrypted structured records at rest
- Retention policy metadata
- Export/delete workflow with audit events

### Capture service
- Issue short-lived, single-purpose capture sessions
- Required-view checklist
- Client-side and server-side quality gates
- Idempotent uploads
- Interrupted-upload recovery
- Session expiration and revocation

### Local intelligence
- Image quality assessment
- Structured visual observation extraction
- Longitudinal comparison against selected baselines
- Change/risk signal generation
- Confidence/uncertainty capture
- Rule-based routing to humans

The model output is **advisory structured data**, never an autonomous diagnosis or clearance.

### Flight Engine
- Append-only timeline events
- Current insert/device version
- Open actions
- Human review records
- Manufacturing lineage
- Client feedback

### Audit
Every security- or care-relevant action records:
- event ID
- timestamp
- actor type and actor ID
- action
- object/resource ID
- reason/context when required
- outcome
- software/model version when relevant

### Backup / sync
V1 default: local system of record.

Optional sync must be:
- encrypted
- explicitly configured
- scope-limited
- observable in the console
- resumable
- revocable

## Health telemetry

The Edge Console should expose:
- service health
- disk utilization
- vault integrity state
- pending capture jobs
- inference queue depth
- backup status
- model versions
- last successful audit checkpoint
- clock drift

Telemetry should avoid sending client content when appliance-level metrics are sufficient.

## Failure behavior

- Internet unavailable: local staff workflows continue where possible; outbound SMS/link creation may queue.
- Model unavailable: capture is retained and routed for human review; no fake result is generated.
- Disk pressure: stop accepting nonessential jobs before risking corruption; alert operator.
- Clock anomaly: block security-sensitive token issuance until reconciled.
- Backup failure: local record remains authoritative; surface failure prominently.
