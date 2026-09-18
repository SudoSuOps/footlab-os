# Twilio SMS — FootLabOS V1

## Purpose

Twilio is an outbound transport for a generic FootLabOS service notification. It is not the system of record and should not receive client photos, Flight Sheets, observations, or diagnosis-like content.

## V1 message

```text
OpenFootLab: Your secure check-in is ready.
https://check.openfootlab.com/s/<opaque-token>
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
export PUBLIC_CAPTURE_BASE_URL='https://check.openfootlab.com'

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
