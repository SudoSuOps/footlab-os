# FLO Home — personal prototype

## Decision

Build a FLO-owned device protocol and application. Reuse verified board support for display, touch and power rather than rewriting drivers. The first hardware target is Donovan's ESP32-C6-Touch-AMOLED-2.16. This commit provides a tested host-side protocol, not flashable firmware or a live messaging endpoint.

Waveshare documents a 480 × 480 AMOLED, CO5300 QSPI display, CST9220 I2C touch controller, AXP2101 power management, 512 KB HP SRAM and 16 MB flash. Confirm the board revision and battery/EN variant against the physical unit before flashing. Do not substitute pin maps from the 2.06 or S3 boards.

Sources inspected October 6, 2026:
- https://docs.waveshare.com/ESP32-C6-Touch-AMOLED-2.16
- https://github.com/waveshareteam/ESP32-C6-Touch-AMOLED-2.16
- https://github.com/facebookincubator/muse-gadget-sdk/tree/main/esp32
- https://gadgets.muse.ai/

## Responsibility split

| Component | Responsibility |
| --- | --- |
| FLO Home C6 | Touch action, connection state, receipt confirmation |
| Phone | SMS link, guided photos, personal answers |
| FootLab Edge | Device authentication, consent, request deduplication, media, records, human review |
| Twilio | Generic notification transport; no photos or clinical details |

The device is a companion, not the Edge vault or a diagnostic instrument. Initial UI states: connecting, ready, requesting, request received, unavailable. “Request received” requires an authenticated Edge acknowledgement. Offline does not imply the request was sent. Never display “foot healthy”, clearance, or a model-derived clinical conclusion.

## Protocol v1

```json
{"version":1,"deviceId":"FLO-DEMO-C6","bootId":"demo-boot","sequence":1,"type":"checkin_requested","uptimeMs":1000}
```

Only heartbeat and checkin_requested are accepted. IDs identify devices and sessions, not people. Extra fields are rejected to keep notes/media/clinical data out of this channel. Sequence numbers increase within an explicitly approved boot session; uptime cannot move backwards. Edge supplies receipt time and persists session state. Never initialize a fresh session from an arbitrary incoming bootId: doing so bypasses replay protection.

`packages/home-device/src/index.mjs` validates events and reduces session state. It does not authenticate devices or create SMS. The caller must bind credentials to the registered device before calling it. A check-in intent still needs consent, a cooldown, an idempotency key and authorized client mapping at Edge. Retry the identical event after a lost acknowledgement; an authenticated transport adapter should return the stored prior receipt rather than send another SMS. That adapter is not implemented in this pass.

## Hardware bring-up sequence

1. Record exact board revision; run the matching vendor display/touch/power example first. Pin the vendor source and toolchain versions and inspect licenses before importing code.
2. Build a minimal FLO screen with a large touch target, readable connection text, and no personal details. Keep microphones and voice features disabled initially.
3. Connect to a local synthetic Edge adapter. Provision a per-device credential physically; verify the Edge certificate, protect credentials at rest, and redact logs. Keep Twilio credentials on Edge.
4. Exercise disconnect, double tap, retransmission, device reboot and Edge restart. Confirm that offline/replay cannot send duplicate notifications.
5. Integrate the existing capture service rather than create a parallel image store. Then test the personal end-to-end flow with explicit consent.

No hardware build or flash has been performed. Display rendering, touch accuracy, power behavior and networking remain unverified on the physical board.

## MUSE evaluation

MUSE's ESP32 SDK offers Muse app pairing, voice/device integration and a Home Link network tunnel. Its documentation says tunneling requires PSRAM and is unavailable on ESP32-C6; it also requires a Muse SDK token/account connection. That makes it a poor default foundation for this C6 local-first capture companion. These are integration constraints, not evidence that MUSE cannot run any features on a C6.

Keep the clinical workflow FLO-owned. Consider MUSE later as an optional voice integration if useful, with a separate data-flow review. No MUSE source is copied in this change. The SDK lists Apache 2.0 with separately licensed bundled/managed components; preserve notices and review those components before reuse.

## Run the host simulation

Node 24 or later:

```sh
npm run demo:home
npm test
```

The simulation emits synthetic heartbeat/button events only. It never contacts a board or sends SMS.
