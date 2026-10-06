import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, chmodSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveSmsCredentials, loadSmsCredentials } from "../src/credentials.mjs";
const values = { TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "2".repeat(32), TWILIO_FROM_NUMBER: "+15615818015" };
function fixture(t) { const home = mkdtempSync(join(tmpdir(), "flo-sms-settings-")); t.after(() => rmSync(home, { recursive: true, force: true })); return home; }
test("saved SMS credentials load without prompts and preserve explicit environment overrides", (t) => {
  const home = fixture(t);
  saveSmsCredentials(values, { home });
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.equal(statSync(join(home, "twilio.json")).mode & 0o777, 0o600);
  const env = { TWILIO_FROM_NUMBER: "+16105551234" };
  loadSmsCredentials({ home, env });
  assert.equal(env.TWILIO_AUTH_TOKEN, values.TWILIO_AUTH_TOKEN);
  assert.equal(env.TWILIO_FROM_NUMBER, "+16105551234");
  assert.throws(() => saveSmsCredentials(values, { home }), /already saved/);
  saveSmsCredentials({ ...values, TWILIO_AUTH_TOKEN: "3".repeat(32) }, { home, replace: true });
  const replaced = {}; loadSmsCredentials({ home, env: replaced });
  assert.equal(replaced.TWILIO_AUTH_TOKEN, "3".repeat(32));
});
test("SMS loader rejects readable-by-others files, symlinks and corrupt content without echoing secrets", (t) => {
  const home = fixture(t), path = join(home, "twilio.json");
  saveSmsCredentials(values, { home });
  chmodSync(path, 0o644);
  assert.throws(() => loadSmsCredentials({ home, env: {} }), /private/);
  chmodSync(path, 0o600);
  writeFileSync(path, 'broken secret: ' + values.TWILIO_AUTH_TOKEN);
  assert.throws(() => loadSmsCredentials({ home, env: {} }), (error) => !error.message.includes(values.TWILIO_AUTH_TOKEN) && /invalid/.test(error.message));
  rmSync(path); symlinkSync(join(home, "real-settings"), path);
  writeFileSync(join(home, "real-settings"), JSON.stringify(values), { mode: 0o600 });
  assert.throws(() => loadSmsCredentials({ home, env: {} }));
});
test("invalid credentials never create a saved configuration; complete environment requires no file", (t) => {
  const home = fixture(t);
  assert.throws(() => saveSmsCredentials({ ...values, TWILIO_AUTH_TOKEN: "login-password" }, { home }), /valid/);
  assert.throws(() => readFileSync(join(home, "twilio.json")));
  assert.doesNotThrow(() => loadSmsCredentials({ home, env: { ...values } }));
  assert.throws(() => loadSmsCredentials({ home, env: {} }), /configure-sms/);
});
