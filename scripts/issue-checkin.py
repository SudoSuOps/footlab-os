#!/usr/bin/env python3
"""
FootLabOS BlockOne issuer.

Creates one OPEN capture event, generates a 256-bit bearer token,
sends the raw magic link directly to Twilio, and stores only hashes/
provider audit metadata.

The raw token is never written to PostgreSQL or printed to stdout.
If SMS submission fails, the capture event is revoked because the
raw token is intentionally not retained for retry.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

import psycopg


CLIENT_RE = re.compile(r"^[A-Z0-9-]+$")
E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")

DB_DSN = os.getenv(
    "FOOTOS_DB_DSN",
    "dbname=footos user=footos host=/var/run/postgresql",
)

PUBLIC_BASE = os.getenv(
    "FOOTOS_PUBLIC_CAPTURE_BASE",
    "https://check.footlabos.com",
).rstrip("/")

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
TWILIO_MESSAGING_SERVICE_SID = os.getenv(
    "TWILIO_MESSAGING_SERVICE_SID",
    "",
)
TWILIO_STATUS_CALLBACK = os.getenv(
    "TWILIO_STATUS_CALLBACK",
    "",
)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mask_phone(value: str) -> str:
    return f"***{value[-4:]}"


def next_event_id(cur, client_id: str) -> str:
    # Serialize numbering for this client without introducing a
    # separate counter table into the BlockZero schema.
    cur.execute(
        "SELECT pg_advisory_xact_lock(hashtext(%s))",
        (f"footos-event:{client_id}",),
    )

    pattern = f"^PHE-{client_id}-([0-9]{{6}})$"

    cur.execute(
        """
        SELECT COALESCE(
            MAX(
                (regexp_match(event_id, %s))[1]::integer
            ),
            0
        ) + 1
        FROM capture_events
        WHERE client_id = %s
          AND event_id ~ %s
        """,
        (pattern, client_id, pattern),
    )

    number = cur.fetchone()[0]
    return f"PHE-{client_id}-{number:06d}"


def create_capture_and_message(
    client_id: str,
    phone: str,
    hours: int,
):
    token = secrets.token_urlsafe(32)
    token_hash = sha256_text(token)
    recipient_hash = sha256_text(phone)
    message_id = uuid.uuid4()
    expires = datetime.now(timezone.utc) + timedelta(hours=hours)

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            event_id = next_event_id(cur, client_id)

            cur.execute(
                """
                INSERT INTO capture_events (
                    event_id,
                    client_id,
                    token_hash,
                    expected_images,
                    status,
                    expires_at
                )
                VALUES (%s, %s, %s, 4, 'OPEN', %s)
                """,
                (
                    event_id,
                    client_id,
                    token_hash,
                    expires,
                ),
            )

            cur.execute(
                """
                INSERT INTO outbound_messages (
                    message_id,
                    event_id,
                    recipient_sha256,
                    recipient_last4,
                    template_key,
                    status
                )
                VALUES (%s, %s, %s, %s, %s, 'CREATED')
                """,
                (
                    message_id,
                    event_id,
                    recipient_hash,
                    phone[-4:],
                    "capture_checkin_v1",
                ),
            )

    return {
        "event_id": event_id,
        "message_id": message_id,
        "token": token,
        "expires": expires,
    }


def twilio_send(phone: str, capture_url: str):
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        raise RuntimeError(
            "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required"
        )

    if not TWILIO_FROM_NUMBER and not TWILIO_MESSAGING_SERVICE_SID:
        raise RuntimeError(
            "Set TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID"
        )

    body = (
        "OpenFootLab: Your secure foot check-in is ready. "
        f"{capture_url} "
        "Link expires today. Reply STOP to opt out."
    )

    fields = {
        "To": phone,
        "Body": body,
    }

    if TWILIO_MESSAGING_SERVICE_SID:
        fields["MessagingServiceSid"] = TWILIO_MESSAGING_SERVICE_SID
    else:
        fields["From"] = TWILIO_FROM_NUMBER

    if TWILIO_STATUS_CALLBACK:
        fields["StatusCallback"] = TWILIO_STATUS_CALLBACK

    encoded = urllib.parse.urlencode(fields).encode("utf-8")

    endpoint = (
        "https://api.twilio.com/2010-04-01/Accounts/"
        f"{TWILIO_ACCOUNT_SID}/Messages.json"
    )

    basic = base64.b64encode(
        f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode("utf-8")
    ).decode("ascii")

    request = urllib.request.Request(
        endpoint,
        data=encoded,
        method="POST",
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "FootLabOS-BlockOne/0.1",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = {"message": raw[:500]}

        error = RuntimeError(
            detail.get("message") or f"Twilio HTTP {exc.code}"
        )
        error.twilio_code = str(detail.get("code") or "")
        raise error

    provider_sid = payload.get("sid")
    if not provider_sid:
        raise RuntimeError("Twilio response did not include a message SID")

    return {
        "sid": provider_sid,
        "status": str(payload.get("status") or "queued").upper(),
    }


def mark_message(
    message_id,
    event_id,
    *,
    status,
    provider_sid=None,
    error_code=None,
    error_message=None,
    revoke_event=False,
):
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE outbound_messages
                SET
                    status = %s,
                    provider_message_id = COALESCE(%s, provider_message_id),
                    error_code = %s,
                    error_message = %s,
                    updated_at = NOW()
                WHERE message_id = %s
                """,
                (
                    status,
                    provider_sid,
                    error_code,
                    (error_message or "")[:500] or None,
                    message_id,
                ),
            )

            if revoke_event:
                cur.execute(
                    """
                    UPDATE capture_events
                    SET status = 'REVOKED'
                    WHERE event_id = %s
                      AND status = 'OPEN'
                    """,
                    (event_id,),
                )


def main():
    parser = argparse.ArgumentParser(
        description="Issue a secure FootLabOS capture check-in by SMS"
    )
    parser.add_argument("client_id")
    parser.add_argument("phone_e164")
    parser.add_argument(
        "--hours",
        type=int,
        default=24,
        help="Magic-link expiry, 1-168 hours (default: 24)",
    )
    args = parser.parse_args()

    client_id = args.client_id.upper().strip()
    phone = args.phone_e164.strip()

    if not CLIENT_RE.fullmatch(client_id):
        raise SystemExit("Invalid client ID")

    if not E164_RE.fullmatch(phone):
        raise SystemExit("Phone must be E.164, e.g. +15615551212")

    if args.hours < 1 or args.hours > 168:
        raise SystemExit("Expiry must be 1-168 hours")

    issued = create_capture_and_message(
        client_id,
        phone,
        args.hours,
    )

    capture_url = (
        f"{PUBLIC_BASE}/c/{issued['token']}"
    )

    try:
        sent = twilio_send(phone, capture_url)
    except Exception as exc:
        mark_message(
            issued["message_id"],
            issued["event_id"],
            status="FAILED",
            error_code=getattr(exc, "twilio_code", None),
            error_message=str(exc),
            revoke_event=True,
        )

        print(
            f"FAILED {issued['event_id']} -> {mask_phone(phone)}",
            file=sys.stderr,
        )
        print(
            "Capture event revoked; issue a new check-in after fixing SMS.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    status = sent["status"]
    if status not in {"QUEUED", "SENT", "DELIVERED"}:
        status = "QUEUED"

    mark_message(
        issued["message_id"],
        issued["event_id"],
        status=status,
        provider_sid=sent["sid"],
    )

    print("FOOTOS CHECK-IN ISSUED")
    print(f"Event:   {issued['event_id']}")
    print(f"To:      {mask_phone(phone)}")
    print(f"SMS SID: {sent['sid']}")
    print(f"Status:  {status}")
    print(f"Expires: {issued['expires'].isoformat()}")
    print("Raw magic token was sent directly to Twilio and not persisted.")


if __name__ == "__main__":
    main()
