# Persistent SMS settings on defendable

The explicit SMS commands can load Twilio settings from `~/flo-private/twilio.json`. This is a local plaintext configuration protected by owner-only directory/file permissions (700/600), not encrypted secret management. It is outside the repository, outside the NAS vault, and never included in the public demo. The loader rejects symlinks, files owned by another user and files accessible to group/other users. Explicit environment variables take precedence. No phone numbers beyond the approved sender are stored in this settings file.

Configure once with hidden terminal prompts:

```bash
(
set -e
cd "$HOME/flo-pilot-app"
read -r -p "Twilio Account SID: " TWILIO_ACCOUNT_SID
read -r -s -p "Twilio Auth Token: " TWILIO_AUTH_TOKEN
printf '\n'
export TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN
export TWILIO_FROM_NUMBER="+15615818015"
node scripts/configure-sms.mjs
)
```

This writes the private configuration only; it sends nothing. Future invocations of `issue-private-checkin.mjs`, `send-public-demo-sms.mjs` and `send-test-sms.mjs` load it automatically, without prompts or manual exports. Recipient restrictions and link readiness checks remain in place. Saving settings does not start recurring sends, resend queued messages or add recipients. The V1 Python production issuer is unchanged.

For credential rotation, repeat the prompts with the new Auth Token and invoke `node scripts/configure-sms.mjs --replace`. Keep this file out of Git, public directories and shared backups. Root or processes running as the same user can read it; production needs a service-owned secret store and restricted credentials. Never paste its contents into chat.

`FLO_PILOT_HOME` can select a different private settings directory for isolated testing. The normal owner pilot uses the default path above.
