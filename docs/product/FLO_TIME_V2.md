# FLO time — bilateral capture V2

## Client journey

The reminder is a generic FootLab SMS: “It's FLO time.” One opaque link opens the check-in without an account or password. Opening the link does not start or complete it. The client explicitly starts.

The required order is right top, right sides, right bottom, then left top, left sides, left bottom. This version interprets “sides” as one side-view photo per foot: the UI suggests using an optional extra for the opposite side. It does not claim both sides were captured. Up to four extra photos can follow the six required photos, making 6–10 photos total.

Each step lets the client take/choose a photo, preview, retake and confirm before continuing. Next remains disabled until the server confirms receipt. The optional step supports replacing, retrying and removing extras. Review shows all chosen photos, the change question and an optional 500-character note. Success shows a server receipt after durable local storage.

## Version boundary

Protocol ID: `flo-bilateral-v2`. Canonical slots:

| Order | Slot | Label |
| --- | --- | --- |
| 1 | right-top | Right · Top |
| 2 | right-sides | Right · Sides |
| 3 | right-plantar | Right · Bottom |
| 4 | left-top | Left · Top |
| 5 | left-sides | Left · Sides |
| 6 | left-plantar | Left · Bottom |
| optional | extra-1 through extra-4 | Extra photos |

The legacy four-photo validator remains in `submission.mjs`. Do not silently change existing V1 capture events or `expected_images=4` rows. `issue-checkin.py` remains a V1 production issuer. V2 needs an explicitly versioned backend migration and deployed adapter before that issuer can route clients into this new UI.

## Local upload API

| Method | Path under /api/capture/:token | Purpose |
| --- | --- | --- |
| GET | / | State, protocol, uploaded slot metadata, receipt |
| POST | /start | Explicit, idempotent start |
| PUT | /photos/:slot | Raw image bytes; upsert/retake one slot |
| GET | /photos/:slot | Authenticated-by-token preview for an open session |
| DELETE | /photos/:slot | Remove a selected image |
| POST | /complete | Validate six required slots, optional extras and answers; persist receipt |

Mutations require `X-FLO-Request: 1`. The server does not enable CORS. Uploads are limited to 20 MiB each and JSON to 16 KiB. Client normalization uses browser image decoding and canvas JPEG output at original dimensions, up to 24 megapixels. It removes source file metadata but re-encodes the image, so it is not a lossless original-image archive. HEIF/WebP work only where the browser can decode them; otherwise the UI requests JPEG/PNG. The server screens PNG/JPEG containers and derives MIME from bytes. Full decoder validation, image-quality checks and clinical ingestion remain the responsibility of the production adapter; these local files must not be treated as validated clinical images.

Slots are session-scoped. Unknown tokens, unsupported slots and missing uploads cannot complete. Start and completion are durable. Identical completion retries return the existing receipt; different payloads cannot change a completed check-in. Reloading an open link restores uploaded photos. Unsent answers are kept during navigation/retries but not after a full browser reload.

## Local vault and development scope

`npm run demo:capture` runs the prototype on `127.0.0.1:4174` and prints a fresh synthetic link. The default `.flo-local-vault/` is ignored by Git. `FLO_VAULT_DIR` can select a directory outside the repo. Photos and the session registry are AES-256-GCM encrypted with random nonces; only token hashes are stored. Writes use temporary files and rename, with rollback for failed registry writes. This is single-process development storage, not a multi-worker or power-loss-tested database.

A randomly generated development key lives beside the ciphertext with restrictive file permissions. This prevents plaintext media in ordinary storage, but does not protect against an attacker who obtains both the key and files. Production needs independently managed keys, encrypted backups and a retention/deletion policy. Temporary/orphan files and expired sessions need an operator cleanup policy; automated retention is not implemented here. Use synthetic photos for this local prototype. No clinical notification occurs.

No existing production Caddy routes, PostgreSQL records or media pipeline were modified. Do not expose this server to the Internet. Production integration still needs managed secrets, TLS, rate limits, durable transactional storage, signed delivery callbacks, consent checks, controlled ingestion and human review routing.

## Text transport

`composeFloCheckinSms` supplies generic V2 reminder copy with an HTTPS opaque URL and STOP language. It does not send a message. `send-test-sms.mjs` remains an explicitly invoked live transport test with an inactive TEST-LINK, now branded FLO and using `/c/`. No live SMS was sent during development.

## Validation

Run `npm test` and `npm run check`. `npm run preview:client` builds a self-contained visual preview from the actual client source, with simulated uploads and receipts. The browser smoke test passed in Chromium at 390 × 844: ordered capture, interrupted upload retry, four extras, removal/replacement, review, interrupted completion retry, reload receipt and no horizontal overflow or JavaScript errors. Screenshots live in `docs/preview/`. The test is `scripts/test-client-browser.mjs`; it requires Playwright and a Chromium installation. `FLO_PLAYWRIGHT_MODULE` and `FLO_BROWSER_PATH` optionally select existing installations. Actual iPhone/Android camera and physical-device testing remain before release. The automated server tests cover real synthetic photo-byte roundtrip, replacement, deletion, encrypted files, missing/extra slots, rejected uploads, completion replay and restart recovery.

Implementation references:
- https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html
- https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload
