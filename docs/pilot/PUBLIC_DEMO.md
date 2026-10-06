# Public sample-only FLO demo

Carlo, Mom and Barry are authorized for one demo SMS each. The sender permits only their three explicitly supplied E.164 numbers. This is a static experience using built-in sample illustrations, six required steps and four optional extras. File selection is replaced with sample buttons; the receipt is simulated. Notes and selections stay in browser memory until reload. There is no photo receiver or storage service behind this page. CSP prohibits outbound connections. The real private pilot and its vault remain behind Tailscale Serve on 8443.

Expose only this exact static file on a separate public Funnel port:

```bash
cd "$HOME/flo-pilot-app"
git fetch origin feat/flo-home-checkin-hardening
git checkout --detach origin/feat/flo-home-checkin-hardening
sudo tailscale funnel --bg --https=10000 "$HOME/flo-pilot-app/docs/preview/flo-public-demo.html"
tailscale funnel status
```

Expected URL after successful configuration: `https://defendable.tail80f341.ts.net:10000/`. If Funnel prints an account enablement link, follow that setup before sending. Do not expose the private server on 4175, its vault directory, or a directory containing other files. Source: https://tailscale.com/docs/reference/tailscale-cli/funnel . Funnel supports port 10000 independently of private Serve port 8443.

Run the existing hidden SID/Auth Token prompts, export the approved sender, and invoke each command once:

```bash
node scripts/send-public-demo-sms.mjs +16107247873
node scripts/send-public-demo-sms.mjs +16103563850
node scripts/send-public-demo-sms.mjs +12678724505
```

The sender first checks the public page is reachable and identifies itself as the sample-only CSP-restricted demo. It never issues capture tokens or sends private links. It reports Twilio's submission state, not carrier delivery. Do not automatically resend after a timeout or uncertain submission. No messages were sent by development tools.

Disable only the public demo with `sudo tailscale funnel --https=10000 off`. Preserve private 8443 routing. The link stays public while Funnel remains enabled; it has no per-recipient expiry or identity authentication because it serves only public sample content.

Build with `node scripts/build-public-demo.mjs`. Test with `node scripts/test-public-demo.mjs` using the existing Playwright/Chromium environment. The mobile browser test completes all ten sample images and verifies no file inputs, outbound requests, horizontal overflow or JavaScript errors.
