# Flight Sheet — V1 Specification

## Definition

A Flight Sheet is the concise, chronological operating record for one client's FootLab journey. It is designed to make changes, actions, devices, feedback, and ownership understandable without forcing a reviewer to reconstruct the story from folders of images.

It is not a substitute for a licensed clinician's medical record.

## Sections

### Header
- Client reference
- Enrollment date
- Monitoring cadence
- Current device/insert version
- Current open actions
- Consent/share state summary

### Baseline
- Capture set used as baseline
- Foot/side coverage
- Relevant client-reported context
- Reviewer/date

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
- `capture_completed`
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

## Design rule

The Flight Sheet is generated from canonical events. Staff should not manually maintain a second shadow narrative that can drift from the event history.
