const allowed = new Set(["+16107247873", "+16103563850", "+12678724505"]);
const to = process.argv[2];
if (!allowed.has(to)) throw new Error("Use an explicitly authorized demo recipient number");
for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"])
  if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
const demo = "https://defendable.tail80f341.ts.net:10000/";
const page = await fetch(demo, { redirect: "error", signal: AbortSignal.timeout(15000) });
const html = await page.text();
if (!page.ok || !html.includes("PUBLIC DEMO · Sample images only") || !html.includes("connect-src 'none'"))
  throw new Error("Public sample-only demo is not reachable yet. No SMS sent");
const body = `FootLab: It's FLO time. Try our sample-only demo: ${demo} No app or password. Nothing is uploaded or saved. Reply STOP to opt out.`;
const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
  headers: { Authorization: "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: body }),
});
const result = await response.json();
if (!response.ok || !/^SM[0-9a-f]{32}$/i.test(result.sid ?? ""))
  throw new Error(`SMS not accepted (code ${Number(result.code) || response.status}). Do not retry automatically`);
console.log({ sid: result.sid, status: result.status, to: "***" + to.slice(-4), mode: "sample-only public demo" });
