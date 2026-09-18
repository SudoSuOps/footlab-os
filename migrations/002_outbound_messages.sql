BEGIN;

CREATE TABLE IF NOT EXISTS outbound_messages (
    message_id          UUID PRIMARY KEY,
    event_id            TEXT NOT NULL
                        REFERENCES capture_events(event_id)
                        ON DELETE CASCADE,
    channel             TEXT NOT NULL DEFAULT 'sms',
    provider            TEXT NOT NULL DEFAULT 'twilio',
    provider_message_id TEXT,
    recipient_sha256    CHAR(64) NOT NULL,
    recipient_last4     CHAR(4) NOT NULL,
    template_key        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'CREATED',
    error_code          TEXT,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (channel = 'sms'),
    CHECK (provider = 'twilio'),
    CHECK (
        status IN (
            'CREATED',
            'QUEUED',
            'SENT',
            'DELIVERED',
            'FAILED'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_messages_provider_id
ON outbound_messages(provider_message_id)
WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_messages_event
ON outbound_messages(event_id);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_status
ON outbound_messages(status);

COMMIT;
