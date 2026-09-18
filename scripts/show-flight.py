#!/usr/bin/env python3
"""
Read-only FootLabOS Flight Sheet projector for one capture event.

Builds a deterministic timeline from existing BlockZero capture tables and,
when present, BlockOne outbound_messages. It does not mutate production data.
"""

import argparse
import json
import os
from datetime import timezone

import psycopg
from psycopg.rows import dict_row


DB_DSN = os.getenv(
    "FOOTOS_DB_DSN",
    "dbname=footos user=footos host=/var/run/postgresql",
)


def iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def table_exists(cur, name: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = %s
        )
        """,
        (name,),
    )
    return bool(cur.fetchone()["exists"])


def event(kind, at, source, detail):
    return {
        "type": kind,
        "occurred_at": iso(at),
        "source": source,
        "detail": detail,
    }


def build(event_id: str):
    with psycopg.connect(DB_DSN, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    event_id,
                    client_id,
                    expected_images,
                    status,
                    created_at,
                    expires_at,
                    completed_at,
                    ingested_at,
                    ingest_receipt_sha256,
                    ingest_manifest_sha256,
                    trusted_store_path
                FROM capture_events
                WHERE event_id = %s
                """,
                (event_id,),
            )
            capture = cur.fetchone()

            if not capture:
                raise SystemExit(f"Capture event not found: {event_id}")

            cur.execute(
                """
                SELECT
                    slot,
                    stored_name,
                    detected_type,
                    size_bytes,
                    sha256,
                    received_at
                FROM capture_uploads
                WHERE event_id = %s
                ORDER BY id
                """,
                (event_id,),
            )
            uploads = list(cur.fetchall())

            messages = []
            if table_exists(cur, "outbound_messages"):
                cur.execute(
                    """
                    SELECT
                        message_id,
                        provider,
                        provider_message_id,
                        recipient_last4,
                        template_key,
                        status,
                        error_code,
                        created_at,
                        updated_at
                    FROM outbound_messages
                    WHERE event_id = %s
                    ORDER BY created_at, message_id
                    """,
                    (event_id,),
                )
                messages = list(cur.fetchall())

    timeline = [
        event(
            "capture_requested",
            capture["created_at"],
            "capture_events",
            {
                "status": "OPEN",
                "expected_images": capture["expected_images"],
                "expires_at": iso(capture["expires_at"]),
            },
        )
    ]

    for message in messages:
        timeline.append(
            event(
                "sms_queued" if message["status"] in {"CREATED", "QUEUED"} else f"sms_{message['status'].lower()}",
                message["created_at"],
                "outbound_messages",
                {
                    "provider": message["provider"],
                    "provider_message_id": message["provider_message_id"],
                    "recipient_last4": message["recipient_last4"],
                    "template_key": message["template_key"],
                    "status": message["status"],
                    "error_code": message["error_code"],
                },
            )
        )

        if (
            message["updated_at"]
            and message["updated_at"] != message["created_at"]
            and message["status"] not in {"CREATED", "QUEUED"}
        ):
            timeline.append(
                event(
                    f"sms_{message['status'].lower()}",
                    message["updated_at"],
                    "outbound_messages",
                    {
                        "provider_message_id": message["provider_message_id"],
                        "status": message["status"],
                    },
                )
            )

    if capture["completed_at"]:
        timeline.append(
            event(
                "capture_completed",
                capture["completed_at"],
                "capture_events",
                {
                    "image_count": len(uploads),
                    "slots": [row["slot"] for row in uploads],
                },
            )
        )

        timeline.append(
            event(
                "capture_ready_for_ingest",
                capture["completed_at"],
                "capture_events",
                {
                    "manifest_expected": True,
                    "image_count": len(uploads),
                },
            )
        )

    if capture["ingested_at"]:
        timeline.append(
            event(
                "capture_ingested",
                capture["ingested_at"],
                "capture_events",
                {
                    "trusted_store_path": capture["trusted_store_path"],
                    "ingest_receipt_sha256": capture["ingest_receipt_sha256"].strip()
                    if capture["ingest_receipt_sha256"]
                    else None,
                    "ingest_manifest_sha256": capture["ingest_manifest_sha256"].strip()
                    if capture["ingest_manifest_sha256"]
                    else None,
                },
            )
        )

    timeline.sort(key=lambda item: item["occurred_at"] or "")

    return {
        "schema": "footos.flight-sheet.capture.v1",
        "event_id": capture["event_id"],
        "client_id": capture["client_id"],
        "current_status": capture["status"],
        "expected_images": capture["expected_images"],
        "captured_images": [
            {
                "slot": row["slot"],
                "stored_name": row["stored_name"],
                "detected_type": row["detected_type"],
                "size_bytes": row["size_bytes"],
                "sha256": row["sha256"].strip(),
                "received_at": iso(row["received_at"]),
            }
            for row in uploads
        ],
        "timeline": timeline,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("event_id")
    parser.add_argument(
        "--compact",
        action="store_true",
        help="Emit compact JSON",
    )
    args = parser.parse_args()

    result = build(args.event_id)
    if args.compact:
        print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    else:
        print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
