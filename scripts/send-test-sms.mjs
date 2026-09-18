const required = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
}

const to = process.argv[2];
if (!to) {
  throw new Error("Usage: node scripts/send-test-sms.mjs +1XXXXXXXXXX");
}

const base = process.env.PUBLIC_CAPTURE_BASE_URL ?? "https://check.openfootlab.com";
const body = `OpenFootLab: Your secure check-in is ready. ${base}/s/TEST-LINK This test link is not active. Reply STOP to opt out.`;

const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
const form = new URLSearchParams({
  To: to,
  From: process.env.TWILIO_FROM_NUMBER,
  Body: body,
});

const auth = Buffer.from(
  `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
).toString("base64");

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: form,
});

const payload = await response.json();

if (!response.ok) {
  console.error(payload);
  process.exit(1);
}

console.log({
  sid: payload.sid,
  status: payload.status,
  to: payload.to,
});
