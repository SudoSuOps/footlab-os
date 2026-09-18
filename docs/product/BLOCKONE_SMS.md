# BlockOne — Secure Check-In Issuance + SMS

## Starting point

BlockZero is production-proven:

```text
/c/<token>
  -> token hash lookup
  -> OPEN capture event
  -> four image upload
  -> per-file SHA-256 + MIME + size
  -> atomic spool package
  -> manifest
  -> READY_FOR_INGEST
  -> trusted NAS ingest
  -> INGESTED
```

BlockOne adds automated issuance and transport without changing the proven
photo-ingestion path.

## Intended operator action

```bash
footos-checkin F001 +15615551212
```

The issuer:

1. serializes event numbering per client;
2. creates the next `PHE-<CLIENT>-NNNNNN` event;
3. creates 256 bits of random token material;
4. stores only the SHA-256 token digest;
5. stores only a recipient phone hash + last four digits in its audit table;
6. sends the raw `/c/<token>` URL directly to Twilio;
7. discards the raw token;
8. records Twilio's provider SID and initial state;
9. revokes the capture event if SMS submission fails.

## Secrets

Secrets belong in a root/service-owned environment file, never Git:

```text
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
# OR:
TWILIO_MESSAGING_SERVICE_SID=

FOOTOS_PUBLIC_CAPTURE_BASE=https://check.footlabos.com
FOOTOS_DB_DSN=dbname=footos user=footos host=/var/run/postgresql
```

Optional after the delivery webhook is installed:

```text
TWILIO_STATUS_CALLBACK=https://check.footlabos.com/api/v1/twilio/status
```

## Database migration

Apply `migrations/002_outbound_messages.sql` before using the issuer.

The audit table deliberately does not persist the destination phone number
in plaintext. It stores a SHA-256 digest and last four digits for correlation.

## Delivery callbacks

The initial issuer records Twilio's synchronous submission result
(`QUEUED`, `SENT`, or failure).

True carrier delivery status is the next step. It requires:

- a narrow public callback route;
- Twilio request-signature validation;
- idempotent updates by provider message SID;
- mapping delivery states to FootLabOS Flight events.

Do not expose an unsigned status endpoint.
