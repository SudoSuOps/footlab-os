# Owner's 30-day daily FLO SMS

Authorized recipient: the existing personal pilot owner's phone only, ending 7120. Exact schedule: 09:00 America/New_York, October 7 through November 5, 2026 inclusive. The 30 explicit calendar dates account for the November daylight saving transition. No scheduled events occur afterward. This schedules check-in SMS only, not inference, reports or clinical monitoring. No immediate SMS is sent by installation.

The schedule executes on defendable, which already has the Twilio credentials and the private control socket. A ChatGPT task cannot reach this service/credential store and must not be substituted for the requested SMS automation.

## Install on defendable

```bash
cd "$HOME/flo-pilot-app"
git fetch origin feat/flo-home-checkin-hardening
git checkout --detach origin/feat/flo-home-checkin-hardening
sudo loginctl enable-linger "$USER"
bash scripts/setup-personal-daily.sh
```

The setup prompts for credentials once only if private saved settings are absent. The existing sender is reused. Linger lets the user's systemd manager run after logout and at boot; the host still must be powered on, awake and online. No wake-from-suspend is configured. The private pilot and Tailscale route must be available. The owner phone needs Tailscale connected to open the link. Existing links expire one hour after issuance, so a 9am link should be opened before 10am.

The installer checks saved settings and the running private control service, validates the generated units, enables the timer and lists its next trigger. Confirm the list shows the next 9am Eastern trigger; installation is not complete until these commands succeed on the host. The current pilot caps sessions at 32; setup verifies capacity for the remaining schedule. With the two existing sessions, the 30 new scheduled sessions fill that capacity. Additional manual issuance consumes capacity; no automatic archive or deletion is performed.

## Reliability and status

At most one automatic attempt per date. Before invoking Twilio, the runner creates and syncs an exclusive private ledger entry in `~/flo-private/daily-sends/`. Concurrent invocations or uncertain submissions never trigger an automatic duplicate. A failed preflight also consumes the day's automatic attempt. There is no automatic retry or late catch-up: a host that misses 9am may miss that day's text. Sends are permitted only between 09:00 and 09:04:59 on the authorized dates. The timer has one-second accuracy, no randomized delay, no persistence, and the service has no restart policy. SMS carrier delivery may be delayed; successful submission is not delivery confirmation. The vault keeps the provider SID and submission status.

```bash
systemctl --user list-timers flo-personal-daily.timer --no-pager
journalctl --user -u flo-personal-daily.service --since today --no-pager
node scripts/private-pilot-status.mjs
```

Service logs include the date and generic outcome, not photos, credentials, raw capture links or phone numbers. Child issuer logs are suppressed. Ledger entries are owner-only metadata. Saved credentials are local private plaintext, not managed secrets. Existing pilot encryption and retention limits remain.

## Stop

```bash
systemctl --user disable --now flo-personal-daily.timer
```

Do not remove ledger entries to retry an uncertain Twilio submission. Confirm provider status first. Installation or stopping the timer never deletes captures or reviews. Personal healing observations remain experimental and require independent human/clinical review.
