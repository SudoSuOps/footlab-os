import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  constants, openSync, closeSync, fstatSync, lstatSync, mkdirSync, chmodSync,
  readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, existsSync,
} from "node:fs";
export const SMS_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"];
const defaultHome = () => process.env.FLO_PILOT_HOME ?? join(homedir(), "flo-private");
function privateFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077))
      throw new Error("Twilio settings must be owned by this user and private (mode 600)");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}
export function loadSmsCredentials({ home = defaultHome(), env = process.env } = {}) {
  if (SMS_KEYS.every((key) => env[key])) return;
  const path = join(home, "twilio.json");
  if (!existsSync(path)) throw new Error("Twilio settings are missing. Run node scripts/configure-sms.mjs once using the hidden credential prompts.");
  let saved;
  const raw = privateFile(path);
  try { saved = JSON.parse(raw); } catch { throw new Error("Twilio settings file is invalid; configure it again with --replace"); }
  if (!saved || SMS_KEYS.some((key) => typeof saved[key] !== "string" || !saved[key]))
    throw new Error("Twilio settings file is incomplete");
  for (const key of SMS_KEYS) if (!env[key]) env[key] = saved[key];
}
export function saveSmsCredentials(values, { home = defaultHome(), replace = false } = {}) {
  if (!/^AC[0-9a-f]{32}$/i.test(values.TWILIO_ACCOUNT_SID ?? "") ||
      !/^[0-9a-f]{32}$/i.test(values.TWILIO_AUTH_TOKEN ?? "") ||
      !/^\+[1-9]\d{7,14}$/.test(values.TWILIO_FROM_NUMBER ?? ""))
    throw new Error("Enter a valid Twilio Account SID, Auth Token and E.164 sender number");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const directory = lstatSync(home);
  if (!directory.isDirectory() || directory.uid !== process.getuid()) throw new Error("SMS settings directory must belong to this user");
  chmodSync(home, 0o700);
  const path = join(home, "twilio.json");
  if (existsSync(path)) {
    privateFile(path);
    if (!replace) throw new Error("Twilio settings are already saved. Use --replace only when updating them");
  }
  const temporary = join(home, ".twilio-" + randomUUID());
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, JSON.stringify(Object.fromEntries(SMS_KEYS.map((key) => [key, values[key]]))) + "\n");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try {
    renameSync(temporary, path);
    const dir = openSync(home, "r");
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
