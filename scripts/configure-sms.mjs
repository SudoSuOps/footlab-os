import { saveSmsCredentials } from "../packages/messaging/src/credentials.mjs";
if (process.argv.slice(2).some((arg) => arg !== "--replace")) throw new Error("Usage: node scripts/configure-sms.mjs [--replace]");
saveSmsCredentials(process.env, { replace: process.argv.includes("--replace") });
console.log("Twilio settings saved privately on this rig. Future SMS commands load them automatically. No SMS sent.");
