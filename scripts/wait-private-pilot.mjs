import { setTimeout as delay } from "node:timers/promises";
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:4175/healthz", { signal: AbortSignal.timeout(500) });
    const data = await response.json();
    if (response.ok && data.mode === "private-pilot" && data.protocolId === "flo-bilateral-v2") {
      console.log("FLO private pilot is ready. Configure Tailscale Serve next.");
      ready = true;
      break;
    }
  } catch { /* Startup may still be decoding the environment check. */ }
  await delay(300);
}
if (!ready) throw new Error("Pilot did not become ready. Run: systemctl --user status flo-private-pilot.service --no-pager");
