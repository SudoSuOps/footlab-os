# FootLabOS V1 System Architecture

## System objective

Coordinate five surfaces around one longitudinal client record without forcing the client to manage accounts, dashboards, or raw clinical/technical data.

## Surfaces

### 1. Client Link
A short-lived secure link delivered by SMS. It supports guided photos, a minimal check-in, upload progress, consent prompts when needed, and a completion receipt.

### 2. Operator
The operations cockpit. Primary navigation:

`TODAY | NEEDS REVIEW | CLIENTS | FLIGHTS | MANUFACTURING | EDGE`

The operator sees exceptions first, not raw system noise.

### 3. Clinical Review
A human review workspace for observations that meet configured review thresholds. It shows current capture, comparable prior captures, client-reported changes, relevant Flight Sheet history, and the reason the item entered review.

### 4. Manufacturing
Tracks design intent through fabrication and feedback:

`requirement -> design version -> material/process -> print -> QA -> delivery -> wear check -> adjustment`

### 5. Edge Console
Administers the local appliance: device identity, encrypted storage, model versions, queues, backups, sync policy, audit events, and appliance health.

## Core event loop

1. Scheduler creates a `capture_request`.
2. Client receives a one-tap link.
3. Capture session validates required views and basic image quality.
4. Data lands in the local client vault.
5. Local pipeline creates observations and longitudinal comparisons.
6. Rules decide whether an item is routine, needs operator review, or needs human clinical review.
7. Approved observations append to the client's Foot Profile and Flight Sheet timeline.
8. If the observation implies a manufacturing question, FootLabOS creates a design requirement instead of silently altering a device.
9. Manufacturing creates a versioned artifact and QA record.
10. Delivery starts a wear-feedback loop.

## Trust boundaries

- Client browser receives only the minimum data needed for the active session.
- Edge storage is the system of record for client media and longitudinal history in V1.
- Models read scoped inputs and return structured observations; they do not write authoritative clinical conclusions.
- Human approvals are attributable and timestamped.
- External sharing requires explicit consent scope and creates an audit event.

## V1 deployment shape

```text
Phone browser
   |
   | short-lived secure link
   v
FootLab Edge Appliance
   |- API / session service
   |- encrypted client vault
   |- capture media store
   |- observation pipeline
   |- local model runtime
   |- Flight Engine
   |- audit/event store
   |- operator + review UI
   |- manufacturing queue
   `- optional encrypted backup/sync connector
```

## Architecture rule

No component may bypass the event/audit boundary to mutate a client Flight Sheet, consent state, or manufacturing status invisibly.
