# Secure Capture Link — V1

## Objective

Give a client a low-friction path from an SMS notification to a scoped FootLabOS capture session without a standing password or app install.

## Link lifecycle

```text
capture request created
  -> random 256-bit token generated
  -> raw token placed in SMS URL
  -> SHA-256 token hash stored
  -> client opens URL
  -> link validated but NOT consumed
  -> client explicitly taps Start Check-In
  -> session becomes started
  -> required capture views + minimal check-in
  -> successful submission
  -> capture completed
  -> token can no longer start/submit another session
```

## Why opening does not consume the token

SMS carriers, security software, and link-preview systems may request URLs before the intended recipient taps them. Treating the first HTTP GET as token consumption can lock the actual client out.

## V1 controls

- At least 256 bits of random token material.
- Only an opaque token appears in the URL.
- Persist only the token hash.
- Short expiration.
- Explicit start action.
- Completion/revocation prevents reuse.
- No PHI or client identity encoded into the URL.
- Cache disabled on token/API responses.
- Link/session actions become canonical events.
- Rate limiting and abuse controls are required before Internet production use.

## Required capture set

Initial V1 default:

1. left plantar
2. left dorsal
3. right plantar
4. right dorsal

The capture protocol must eventually be configurable by client and monitoring plan.

## Demo boundary

The repository demo previews image files locally in the browser and submits only metadata. It does **not** upload or persist image bytes.

The production ingestion path must add:

- authenticated/scoped media upload
- encrypted storage
- MIME/signature validation
- size/resolution limits
- EXIF handling policy
- malware/content handling policy
- idempotency
- server-side quality checks
- audit linkage between media objects and capture events
