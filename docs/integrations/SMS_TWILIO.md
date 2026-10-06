# Twilio SMS — FootLabOS V1

## Purpose

Twilio is an outbound transport for a generic FootLabOS service notification. It is not the system of record and should not receive client photos, Flight Sheets, observations, or diagnosis-like content.

## V1 message

```text
OpenFootLab: Your secure check-in is ready.
https://check.footlabos.com/c/<opaque-token>
Link expires today. Reply STOP to opt out.
```

Keep message content generic.

## Secrets

Never commit credentials. Use environment variables:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` during trial
- `TWILIO_MESSAGING_SERVICE_SID` for production Messaging Service
- `PUBLIC_CAPTURE_BASE_URL`
- `PUBLIC_API_URL`

## Trial test

Twilio trial accounts may only send to verified recipient numbers.

```bash
export TWILIO_ACCOUNT_SID='...'
export TWILIO_AUTH_TOKEN='...'
export TWILIO_FROM_NUMBER='+1...'
export PUBLIC_CAPTURE_BASE_URL='https://check.footlabos.com'

node scripts/send-test-sms.mjs +1XXXXXXXXXX
```

The test script deliberately sends a nonfunctional `TEST-LINK`. It verifies transport only.

## Production flow

```text
capture_requested
  -> sms_queued
  -> sms_sent
  -> sms_delivered
  -> capture_link_opened
  -> capture_started
  -> capture_completed
```

Failures append `sms_failed` and appear in the Operator TODAY queue.

## Link security

- Generate at least 256 bits of cryptographically random token material.
- Put only the opaque token in the URL.
- Store a one-way hash of the raw token, not the raw token itself.
- Give the request a short expiration.
- Do not consume the token on the first HTTP GET; carrier/security scanners can pre-open links.
- Create the authenticated capture session only after explicit client interaction.
- Revoke the request after successful submission or explicit cancellation.
- Audit issuance, start, completion, expiration, and revocation.

## Webhooks

Production should accept Twilio delivery callbacks and validate the provider signature before appending delivery-state events.

Do not trust arbitrary public POSTs to the webhook endpoint.

## Form webhook verification helper

`packages/messaging/src/webhook.mjs` verifies Twilio form POST signatures with HMAC-SHA1, alphabetically sorted parameters and constant-time comparison. Reference: https://www.twilio.com/docs/usage/security . Supply the exact configured public HTTPS URL including its query; do not derive it from incoming Host/forwarded headers. Verify before mutating delivery state. Duplicate form keys, JSON body signatures and WebSocket signatures are unsupported and rejected. Use the official SDK for those formats. This helper is tested but is not wired into a deployed callback handler in this repository.

## FLO time V2 reminder

`composeFloCheckinSms` prepares the new generic reminder: `FootLab: It's FLO time. Tap to start your foot check-in: <HTTPS opaque link> No app or password. Reply STOP to opt out.` It never includes a client name or condition and does not claim a same-day expiry. It is a tested composer, not a deployed V2 issuer; see [V2 migration boundary](../product/FLO_TIME_V2.md).
