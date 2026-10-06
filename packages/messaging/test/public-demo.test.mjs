import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("public demo sends only authorized recipients and only public sample link (mocked transport)", () => {
  const dir = mkdtempSync(join(tmpdir(), "flo-demo-sms-"));
  try {
    const mock = join(dir, "mock.mjs");
    writeFileSync(mock, `globalThis.fetch=async(url,options={})=>{
      if(url==='https://defendable.tail80f341.ts.net:10000/') return new Response(process.env.DEMO_BAD_PAGE?'wrong page':"PUBLIC DEMO · Sample images only connect-src 'none'");
      if(url==='https://api.twilio.com/2010-04-01/Accounts/ACsynthetic/Messages.json') {
        if(options.body.get('To')!==process.env.DEMO_EXPECTED_TO || !options.body.get('Body').includes(':10000/') || options.body.get('Body').includes(':8443')) throw Error('Wrong recipient or private link');
        return new Response(JSON.stringify({sid:'SM'+'3'.repeat(32),status:'queued'}));
      }
      throw Error('Unexpected network request blocked');
    };`);
    for (const to of ["+16107247873", "+16103563850", "+12678724505", "+15615327120"]) {
      const result = spawnSync(process.execPath, ["--import", mock, "scripts/send-public-demo-sms.mjs", to], { encoding: "utf8", env: { ...process.env, TWILIO_ACCOUNT_SID: "ACsynthetic", TWILIO_AUTH_TOKEN: "synthetic", TWILIO_FROM_NUMBER: "+15615818015", DEMO_EXPECTED_TO: to } });
      assert.equal(result.status, to === "+15615327120" ? 1 : 0, result.stderr);
    }
    const blocked = spawnSync(process.execPath, ["--import", mock, "scripts/send-public-demo-sms.mjs", "+16107247873"], { encoding: "utf8", env: { ...process.env, TWILIO_ACCOUNT_SID: "ACsynthetic", TWILIO_AUTH_TOKEN: "synthetic", TWILIO_FROM_NUMBER: "+15615818015", DEMO_BAD_PAGE: "1" } });
    assert.equal(blocked.status, 1);
    assert.ok(!blocked.stdout.includes("queued"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
