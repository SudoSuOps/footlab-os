# Secure Capture Link — V1

## Objective

Give a client a low-friction path from an SMS notification to a scoped FootLabOS capture session without a standing password or app install.

## Production URL shape

```text
https://check.footlabos.com/c/<opaque-token>
```

The production Caddy ingress already routes `/c/*` and `/api/v1/capture/*` to the existing FootOS Capture service on `127.0.0.1:8000`.

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

BlockZero established the production V1 contract:

1. right plantar
2. left plantar
3. right targeted
4. left targeted

The capture protocol should later become configurable by client and monitoring plan without breaking event or manifest compatibility.

## BlockZero baseline

The existing production capture service demonstrated the four-photo path through `check.footlabos.com` into the canonical event package.

Observed package:

```text
PHE-F001-000001/
  manifest.json
  originals/
    01-right-plantar.jpg
    02-left-plantar.jpg
    03-right-targeted.jpg
    04-left-targeted.jpg
```

The manifest already records, per image:

- slot
- stored filename
- detected MIME type
- size in bytes
- SHA-256 digest
- received timestamp

That proven ingestion path is the production source of truth. The secure-link layer wraps it rather than introducing a second media pipeline.

## Demo boundary

The repository demo previews image files locally in the browser and submits only metadata. It does **not** upload or persist image bytes.

The production service is the source of truth for actual media ingestion and storage.
