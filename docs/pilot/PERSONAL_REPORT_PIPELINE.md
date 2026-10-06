# Owner-only automatic FLO report pipeline

Personal authorization: completed owner check-ins → local MedGemma observations → PDF → email to the owner's explicitly supplied `minechain@proton.me`. Resend is the user-selected email transport. No other recipients, clinician notifications or client deployments are included. Existing completed personal captures are processed when installed; new completions are discovered by the local timer, approximately a minute after the previous scan finishes. Inference runtime adds further delay. The 9am SMS timer is separate.

## Setup on defendable

```bash
cd "$HOME/flo-pilot-app"
git fetch origin feat/flo-home-checkin-hardening
git checkout --detach origin/feat/flo-home-checkin-hardening
bash scripts/setup-personal-reports.sh
```

This installs ReportLab in the existing private Python environment, prompts for a hidden Resend API key and a verified sender email address, checks that sender domain with a read-only Resend API call, stores owner-only settings at `~/flo-private/report-email.json`, validates the units and enables the report queue. The existing personally authorized check-in will generate an email when setup succeeds. The key needs domain-read permission for the setup check. No new Resend account/domain is provisioned, no DNS is modified, and no unverified sender is assumed. Never paste API keys into chat.

The config pins the installed MedGemma model digest. Cached observations are reused only when model and source hashes match; otherwise local inference runs. The private pilot's same-user/key-management limitations remain. Current supported model is the owner's installed `medgemma1.5:4b`; the runner checks local-only vision support. The baseline context is the owner's previously reported left great-toe absence, labeled user-reported, not clinician verified. It only adds a wording conflict flag; it does not validate anatomy or change medical decisions.

## Report and Proof of FLO

The report includes capture date/time, receipt UUID/photo count, submitted change answer/note, model name/digest, per-view unverified descriptions, quality flags and the Proof of FLO SHA-256. Flags are limited wording heuristics for reassurance, repetition, non-foot descriptions, diagnostic speculation and a conflict with user-reported anatomy. No flags does not mean correct output. No prior-day comparison or healing score is implemented.

Proof of FLO v1 hashes a canonical JSON manifest: recursively lexicographically sorted object keys, preserved array order, JavaScript JSON scalar encoding, UTF-8. It binds the receipt, answers, exact review, ordered source image hashes, user-reported context and output-quality flags. Changing any bound field changes the digest. The final PDF's SHA-256 is recorded separately because embedding a final file's own hash changes its bytes. The email includes both the PDF and `Proof-of-FLO.json`, which carries the manifest and both hashes.

```bash
node scripts/verify-flo-proof.mjs /path/to/Proof-of-FLO.json /path/to/FLO-check-in-report.pdf
```

Hashes prove consistency with the supplied files, not clinical truth, model reliability, identity, trusted timestamps or tamper-proof custody. Local job events form a hash-linked trail; it is mutable by the owner holding the key and is not a signed or externally anchored ledger.

## Storage, email and failure behavior

Source images stay in the encrypted local vault; raw images are not emailed. Reviews stay under `~/flo-private/reviews/`. PDF, manifest and job/audit files stay encrypted under `~/flo-private/reports/`, using the existing separate vault key. Plaintext PDF generation and email payloads exist in process memory, without plaintext temporary files. The report and JSON manifest contain health information and are sent through Resend into the chosen mailbox: that emailed copy is outside the local encrypted vault. The email is not an end-to-end encrypted attachment. This implementation does not establish HIPAA compliance.

Stages: `analysis-started` → `pdf-ready` → `email-submission-started` → `email-submitted`. The trail retains receipt time, source hashes in the manifest, model digest, report hash, final PDF hash, event hash links and provider ID. Successful provider submission is NOT proof of inbox delivery or reading; delivery/bounce webhooks are not implemented.

Local processing failures retry at most three times, at least five minutes apart. A durable email-attempt marker precedes the external request, which also uses a Resend idempotency key. Failed/uncertain email attempts and interrupted attempts are held; no automatic resend, including beyond Resend's idempotency window. On startup a stale worker PID lock is recoverable; a live worker prevents concurrent processing. Completed emails are never automatically regenerated/resubmitted. Missing or changed data is not silently marked successful. A service timeout/crash may require operator inspection.

Capture eligibility: owner's check-ins issued from October 6 through November 5 Eastern; processing is disabled after November 7 midnight Eastern (a final catch-up window). The timer may remain enabled afterward but the worker sends nothing. No retention cleanup or NAS replication is implemented. Keep defendable awake/online. Existing capture session capacity remains 32.

## Status and pause

```bash
node scripts/process-personal-reports.mjs --status
journalctl --user -u flo-personal-reports.service --since today --no-pager
systemctl --user disable --now flo-personal-reports.timer
```

Disabling the timer prevents future scans; if the worker is currently running, also stop `flo-personal-reports.service` to cancel it. Inspect a started/uncertain email in Resend before any manual retry. Status shows audit metadata, not raw photo contents or secrets. The report is an experimental personal record, not clinician-reviewed diagnosis, management advice or an all-clear. No clinician is automatically monitoring this queue.

API references: [Resend send email](https://resend.com/docs/api-reference/emails/send-email), [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [list domains](https://resend.com/docs/api-reference/domains/list-domains).
