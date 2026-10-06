# FLO personal private pilot

This is the owner's single-person phone pilot, not a public client deployment. It uses the six required views plus up to four extras and the existing client UI. The rig stores encrypted media locally, with a separate mode-600 key. The NAS mount is not written by this pilot. No clinician notification, automated interpretation or clinical clearance occurs. A receipt means the local service saved the submitted photos and answers.

## Isolated install on defendable

Preserve the existing `main` checkout. Create a detached worktree of the reviewed feature branch:

```bash
cd /home/swarm/Desktop/footlab-os
git fetch origin feat/flo-home-checkin-hardening
git worktree add --detach "$HOME/flo-pilot-app" origin/feat/flo-home-checkin-hardening
cd "$HOME/flo-pilot-app"
python3 -m venv "$HOME/flo-private/venv"
"$HOME/flo-private/venv/bin/pip" install Pillow
node scripts/init-private-pilot.mjs
systemctl --user daemon-reload
systemctl --user enable --now flo-private-pilot.service
node scripts/wait-private-pilot.mjs
```

The runtime scripts use JavaScript supported by Node 22. The full repository checks still require Node 24. Initialization requires an already connected Tailscale node with a `.ts.net` DNS name and a working Pillow decoder. It refuses an existing Serve route on port 8443 or a conflicting pilot configuration. It never changes Tailscale routing itself. If Python reports `ensurepip` unavailable, install Ubuntu's `python3-venv` package and rerun the venv command.

## Private HTTPS

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:4175
tailscale serve status
```

Serve provides private HTTPS through Tailscale. The phone must be connected to the same tailnet and allowed access by its policy. Do not enable Funnel. Keep existing routes on other ports. If prompted to enable HTTPS, follow the Tailscale-provided account setup link. Source: https://tailscale.com/docs/reference/tailscale-cli/serve .

## Send one actual capture link

Use the same hidden terminal prompts that passed the transport test. Do not enter account credentials into chat. The issuer is restricted to the owner's authorized test number. It checks the live HTTPS health route, creates a one-hour random token, sends it directly to Twilio, and persists the provider SID and submission state. Raw tokens and destination numbers are not saved in the vault. A timeout is an uncertain submission; the issuer revokes the link if possible and never automatically resends.

```bash
cd "$HOME/flo-pilot-app"
read -r -p "Twilio Account SID: " TWILIO_ACCOUNT_SID
read -r -s -p "Twilio Auth Token: " TWILIO_AUTH_TOKEN
printf '\n'
export TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN
export TWILIO_FROM_NUMBER="+15615818015"
node scripts/issue-private-checkin.mjs +15615327120
unset TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER
```

After completing on the phone, inspect receipts without revealing bearer tokens:

```bash
node scripts/private-pilot-status.mjs
```

## Operating limits

- One process, one personal user. Control commands are available only through a mode-600 Unix socket. The HTTP service binds loopback only. Exact Host and mutation Origin checks, 240 requests/minute globally, eight connections, bounded bodies and decoder deadlines constrain the private endpoint.
- Image acceptance requires full Pillow JPEG/PNG verification and decode, a 20 MiB file maximum, one frame, and at most 24 million pixels. This detects malformed files; it does not judge clinical quality or framing.
- Storage uses encrypted files and an encrypted registry with file and directory fsync. It is not a transactional database across media and registry files; a crash can leave an encrypted orphan after upload/replacement. Completion uses the registry as the source of truth; identical retries return the saved receipt.
- The key lives in `~/flo-private/vault.key`, separately from `~/flo-private/vault/`. Protect and back up the key separately; losing it makes the vault unreadable. The same user account can access both. This is not managed-key production security.
- Up to 32 issued sessions per vault; no automatic retention cleanup. Each session can hold ten 20 MiB files. Archive/export and retention management must be implemented before ongoing client use. Disk and filesystem behavior on the actual rig still need verification.
- User services run while the user manager is active; logout/reboot behavior depends on the host's existing linger policy. This setup does not silently enable lingering.
- Twilio submission status is stored, not carrier delivery updates. There is no delivery callback in this pilot. Production V1 routes and four-image database rows are unchanged.

Stop capture with `systemctl --user stop flo-private-pilot.service`. Disable only this HTTPS port with `sudo tailscale serve --https=8443 off`; do not reset all Serve routes. Preserve the vault and key when stopping.
