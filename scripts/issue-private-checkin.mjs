import { homedir } from "node:os";
import { join } from "node:path";
import { pilotControl } from "./pilot-control.mjs";
import { composeFloCheckinSms } from "../packages/messaging/src/checkin-copy.mjs";

// This pilot is deliberately restricted to the owner's authorized test phone.
const to = process.argv[2];
if (to !== "+15615327120") throw new Error("Personal pilot only: use the authorized owner test number");
for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"])
  if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
if (!/^AC[0-9a-f]{32}$/i.test(process.env.TWILIO_ACCOUNT_SID)) throw new Error("Invalid Account SID");
if (!/^\+[1-9]\d{7,14}$/.test(process.env.TWILIO_FROM_NUMBER)) throw new Error("Invalid sender number");
const socket = join(process.env.FLO_PILOT_HOME ?? join(homedir(), "flo-private"), "control.sock");
const health = await pilotControl(socket, { action: "health" });
if (health.mode !== "private-pilot" || !/^https:\/\/[a-z0-9.-]+\.ts\.net:8443$/.test(health.origin)) throw new Error("Private pilot configuration is invalid");
// Refuse to text a link until its HTTPS route reaches the running V2 service.
const probe = await fetch(health.origin + "/healthz", { signal: AbortSignal.timeout(10000), redirect: "error" });
const info = await probe.json();
if (!probe.ok || info.mode !== "private-pilot" || info.protocolId !== "flo-bilateral-v2") throw new Error("Private HTTPS capture route is not ready");
const issued = await pilotControl(socket, { action: "issue" });
try {
  const body = composeFloCheckinSms(`${issued.origin}/c/${issued.token}`);
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: body }),
  });
  const result = await response.json();
  if (!response.ok || !/^SM[0-9a-f]{32}$/i.test(result.sid ?? "")) throw new Error(`Twilio did not accept the message (code ${Number(result.code) || response.status})`);
  await pilotControl(socket, { action: "delivery", token: issued.token, delivery: { sid: result.sid, status: result.status } });
  console.log(JSON.stringify({ sid: result.sid, status: result.status, to: "***7120", protocol: "flo-bilateral-v2", expiresInMinutes: 60, access: "Phone must be connected to your Tailscale network" }, null, 2));
} catch (error) {
  try { await pilotControl(socket, { action: "revoke", token: issued.token }); }
  catch { console.error("Could not revoke issued link; stop the pilot service before retrying"); }
  console.error("SMS submission failed or is uncertain. The link was revoked if possible; do not retry automatically.");
  console.error(error.message);
  process.exitCode = 1;
}
