import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createCaptureDemo } from "../../../scripts/demo-capture-server.mjs";
import { openLocalVault } from "../src/local-vault.mjs";

test("private vault fails closed without a private external key", () => {
  const home = mkdtempSync(join(tmpdir(), "flo-key-"));
  try {
    const keyPath = join(home, "key");
    assert.throws(() => openLocalVault(join(home, "vault"), { keyPath }), /key must exist/);
    writeFileSync(keyPath, randomBytes(32), { mode: 0o644 });
    assert.throws(() => openLocalVault(join(home, "vault"), { keyPath }), /private/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("private pilot: decoded uploads, origin rejection, completion, SMS audit and restart", async (t) => {
  const probe = spawnSync("python3", ["-c", "from PIL import Image; import sys; print(sys.executable)"], { encoding: "utf8" });
  if (probe.status !== 0) return t.skip("Pillow is required for the private-pilot integration test");
  const home = mkdtempSync(join(tmpdir(), "flo-private-test-"));
  const origin = "https://test.synthetic.ts.net:8443";
  writeFileSync(join(home, "config.json"), JSON.stringify({ origin, python: probe.stdout.trim() }));
  writeFileSync(join(home, "vault.key"), randomBytes(32), { mode: 0o600 });
  const fixture = spawnSync(probe.stdout.trim(), ["-c", "from PIL import Image; import sys; Image.new('RGB',(64,64),'blue').save(sys.stdout.buffer,format='PNG')"]).stdout;
  let service;
  let base;
  async function start() {
    service = createCaptureDemo({ vaultDir: join(home, "vault"), keyPath: join(home, "vault.key"), pilotOrigin: origin,
      validateImage: async (bytes) => {
        const result = spawnSync(probe.stdout.trim(), ["scripts/pilot-image-check.py"], { input: bytes });
        if (result.status !== 0) throw new Error("Invalid photo");
      },
    });
    service.server.listen(0, "127.0.0.1");
    await once(service.server, "listening");
    base = `http://127.0.0.1:${service.server.address().port}`;
  }
  async function stop() { await new Promise((resolve) => service.server.close(resolve)); }
  t.after(async () => { await stop(); rmSync(home, { recursive: true, force: true }); });
  function request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(url.replace(/^http:\/\/127\.0\.0\.1:\d+/, base), { method: options.method ?? "GET", headers: { Host: "127.0.0.1:4175", ...options.headers } }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.on("error", reject);
      req.end(options.body);
    });
  }
  await start();
  assert.equal((await request(base + "/healthz")).status, 200);
  assert.equal((await request(base + "/healthz", { headers: { Host: "evil.invalid" } })).status, 403);
  const issued = { token: service.issueDemoLink() };
  const endpoint = `${base}/api/capture/${issued.token}`;
  const mutate = (body) => ({ method: "POST", headers: { Origin: origin, "X-FLO-Request": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await request(endpoint + "/start", { ...mutate({}), headers: { "X-FLO-Request": "1" } })).status, 403);
  const state = await (await request(endpoint)).json();
  assert.equal(state.privatePilot, true);
  assert.equal((await request(endpoint + "/start", mutate({}))).status, 200);
  assert.equal((await request(endpoint + "/photos/right-top", { method: "PUT", headers: { Origin: origin, "X-FLO-Request": "1" }, body: Buffer.from([255,216,255,217]) })).status, 400);
  const slots = ["right-top", "right-sides", "right-plantar", "left-top", "left-sides", "left-plantar"];
  const body = { protocolId: "flo-bilateral-v2", slots, checkIn: { meaningfulChange: "no", note: "Synthetic pilot fixture" } };
  assert.equal((await request(endpoint + "/complete", mutate(body))).status, 400);
  for (const slot of slots) assert.equal((await request(endpoint + "/photos/" + slot, { method: "PUT", headers: { Origin: origin, "X-FLO-Request": "1" }, body: fixture })).status, 200);
  const delivery = { sid: "SM" + "1".repeat(32), status: "queued" };
  service.recordDelivery(issued.token, delivery);
  const completed = await (await request(endpoint + "/complete", mutate(body))).json();
  assert.equal(completed.receipt.photoCount, 6);
  await stop();
  await start();
  assert.deepEqual((await (await request(endpoint + "/complete", mutate(body))).json()).receipt, completed.receipt);
  assert.equal((await request(endpoint + "/complete", mutate({ ...body, checkIn: { meaningfulChange: "yes", note: "Changed" } }))).status, 409);
  const listed = { sessions: service.listSessions() };
  assert.equal(listed.sessions[0].delivery.sid, delivery.sid);
  assert.equal(listed.sessions[0].state, "completed");
  assert.ok(!JSON.stringify(listed).includes(issued.token));
  const revoked = { token: service.issueDemoLink() };
  service.revokeLink(revoked.token);
  assert.equal((await request(`${base}/api/capture/${revoked.token}/start`, mutate({}))).status, 410);
  for (const name of readdirSync(join(home, "vault"))) {
    const encrypted = readFileSync(join(home, "vault", name));
    assert.ok(!encrypted.includes(Buffer.from(issued.token)));
    assert.ok(!encrypted.includes(Buffer.from("Synthetic pilot fixture")));
    assert.ok(!encrypted.equals(fixture));
  }
});

test("private control service and issuer use real socket with mocked Twilio only", async (t) => {
  const python = spawnSync("python3", ["-c", "from PIL import Image; import sys; print(sys.executable)"], { encoding: "utf8" });
  if (python.status !== 0) return t.skip("Pillow required");
  const { pilotControl } = await import("../../../scripts/pilot-control.mjs");
  const home = mkdtempSync(join(tmpdir(), "flo-issuer-test-"));
  const origin = "https://test.synthetic.ts.net:8443";
  writeFileSync(join(home, "config.json"), JSON.stringify({ origin, python: python.stdout.trim() }));
  writeFileSync(join(home, "vault.key"), randomBytes(32), { mode: 0o600 });
  const env = { ...process.env, FLO_PILOT_HOME: home };
  const child = spawn(process.execPath, ["scripts/serve-private-pilot.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    rmSync(home, { recursive: true, force: true });
  });
  const ready = await new Promise((resolve, reject) => {
    let output = "", errors = "";
    const timer = setTimeout(() => reject(new Error("Pilot startup timed out")), 10000);
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("ready on")) { clearTimeout(timer); resolve(true); } });
    child.once("exit", () => { clearTimeout(timer); errors.includes("EPERM") ? resolve(false) : reject(new Error(errors)); });
  });
  if (!ready) return t.skip("This workspace disallows Unix socket binding; real-socket integration runs in CI");
  assert.equal((await fetch("http://127.0.0.1:4175/healthz")).status, 200);
  const mockPath = join(home, "mock.mjs");
  writeFileSync(mockPath, `globalThis.fetch = async (url) => {
    if (url === ${JSON.stringify(origin + "/healthz")}) return new Response(JSON.stringify({ mode: 'private-pilot', protocolId: 'flo-bilateral-v2' }));
    if (url === 'https://api.twilio.com/2010-04-01/Accounts/AC' + '1'.repeat(32) + '/Messages.json') {
      return process.env.FLO_MOCK_FAILURE ? new Response(JSON.stringify({code:21610}), {status:400}) : new Response(JSON.stringify({sid:'SM'+'2'.repeat(32),status:'queued'}));
    }
    throw new Error('Unexpected network request blocked by test');
  };`);
  async function issue(failure) {
    return new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, ["--import", mockPath, "scripts/issue-private-checkin.mjs", "+15615327120"], {
        env: { ...env, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "synthetic-token", TWILIO_FROM_NUMBER: "+15615818015", FLO_MOCK_FAILURE: failure ? "1" : "" }, stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "", errors = "";
      proc.stdout.on("data", (chunk) => { out += chunk; });
      proc.stderr.on("data", (chunk) => { errors += chunk; });
      proc.on("error", reject);
      proc.on("exit", (code) => resolve({ code, out, errors }));
    });
  }
  const accepted = await issue(false);
  assert.equal(accepted.code, 0, accepted.errors);
  assert.equal(JSON.parse(accepted.out).status, "queued");
  assert.ok(!accepted.out.includes("/c/"));
  const failed = await issue(true);
  assert.equal(failed.code, 1);
  const listed = await pilotControl(join(home, "control.sock"), { action: "list" });
  assert.equal(listed.sessions[0].delivery.status, "queued");
  assert.equal(listed.sessions[1].state, "revoked");
});
