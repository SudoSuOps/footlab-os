import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  issueCaptureLink,
  captureLinkState,
  tokenMatches,
} from "../src/index.ts";
import {
  CAPTURE_VIEWS,
  validateCaptureSubmission,
} from "../src/submission.mjs";
import {
  PROTOCOL_ID,
  CAPTURE_STEPS,
  EXTRA_SLOTS,
  validateCompletion,
} from "../src/protocol.mjs";
import { createCaptureDemo } from "../../../scripts/demo-capture-server.mjs";
// A real, synthetic 1x1 PNG fixture; never a client image.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const slots = CAPTURE_STEPS.map((s) => s.id);
const completion = () => ({
  protocolId: PROTOCOL_ID,
  slots: [...slots],
  checkIn: { meaningfulChange: "unsure", note: "Synthetic test note" },
});
const headers = { "X-FLO-Request": "1", "Content-Type": "application/json" };
const post = (value) => ({
  method: "POST",
  headers,
  body: JSON.stringify(value),
});
async function setup(t, dir) {
  const vaultDir = dir ?? mkdtempSync(join(tmpdir(), "flo-test-"));
  const demo = createCaptureDemo({ vaultDir });
  demo.server.listen(0, "127.0.0.1");
  await once(demo.server, "listening");
  t.after(async () => {
    await new Promise((resolve) => demo.server.close(resolve));
    if (!dir) rmSync(vaultDir, { recursive: true, force: true });
  });
  return {
    ...demo,
    vaultDir,
    base: `http://127.0.0.1:${demo.server.address().port}`,
  };
}
test("link lifetime bounded and invalid expiry fails closed", () => {
  const link = issueCaptureLink({
    requestId: "r",
    clientId: "c",
    issuedAt: new Date("2026-10-06T00:00:00Z"),
    ttlMinutes: 1,
  });
  assert.equal(tokenMatches(link.rawToken, link.record.tokenHash), true);
  assert.equal(tokenMatches("wrong", link.record.tokenHash), false);
  assert.equal(
    captureLinkState(link.record, new Date(link.record.expiresAt)),
    "expired",
  );
  assert.equal(
    captureLinkState({ ...link.record, expiresAt: "bad" }),
    "expired",
  );
  for (const ttlMinutes of [0, -1, Infinity, 10081])
    assert.throws(() =>
      issueCaptureLink({ requestId: "r", clientId: "c", ttlMinutes }),
    );
});
test("legacy V1 metadata contract remains separate from six-photo V2", () => {
  const p = {
    captures: CAPTURE_VIEWS.map((viewId) => ({
      viewId,
      mimeType: "image/jpeg",
      size: 100,
      fileName: "private.jpg",
    })),
    checkIn: { meaningfulChange: "no", note: "" },
  };
  assert.equal("fileName" in validateCaptureSubmission(p).captures[0], false);
  p.captures[1] = p.captures[0];
  assert.throws(() => validateCaptureSubmission(p));
  assert.deepEqual(slots, [
    "right-top",
    "right-sides",
    "right-plantar",
    "left-top",
    "left-sides",
    "left-plantar",
  ]);
});
test("V2 accepts 0–4 extras and rejects missing views, duplicate slots, unknown slots and absent uploads", () => {
  const uploads = Object.fromEntries(
    [...slots, ...EXTRA_SLOTS].map((s) => [s, { id: s }]),
  );
  for (let count = 0; count <= 4; count++)
    assert.equal(
      validateCompletion(
        { ...completion(), slots: [...slots, ...EXTRA_SLOTS.slice(0, count)] },
        uploads,
      ).slots.length,
      6 + count,
    );
  for (const selected of [
    slots.slice(1),
    [...slots, "extra-5"],
    [...slots, slots[0]],
  ])
    assert.throws(() =>
      validateCompletion({ ...completion(), slots: selected }, uploads),
    );
  assert.throws(() => validateCompletion(completion(), {}));
  assert.throws(() =>
    validateCompletion(
      { ...completion(), checkIn: { meaningfulChange: "", note: "" } },
      uploads,
    ),
  );
});
test("real upload: token preview, start, bounded body, spoof rejection, roundtrip, retake, extras and receipt", async (t) => {
  const demo = await setup(t),
    token = demo.issueDemoLink(),
    url = demo.base + "/api/capture/" + token;
  assert.equal((await fetch(demo.base + "/c/" + token)).status, 200);
  assert.equal(
    demo.events.some((e) => e.type === "capture_started"),
    false,
  );
  assert.equal(
    (await fetch(url + "/complete", post(completion()))).status,
    409,
  );
  assert.equal((await fetch(url + "/start", { method: "POST" })).status, 403);
  await fetch(url + "/start", post({}));
  await fetch(url + "/start", post({}));
  assert.equal(
    demo.events.filter((e) => e.type === "capture_started").length,
    1,
  );
  assert.equal(
    (await fetch(url + "/complete", { method: "POST", headers, body: "{" }))
      .status,
    400,
  );
  assert.equal(
    (
      await fetch(url + "/complete", {
        method: "POST",
        headers,
        body: " ".repeat(17000),
      })
    ).status,
    413,
  );
  assert.equal(
    (await fetch(url + "/complete", post(completion()))).status,
    400,
  );
  assert.equal(
    (
      await fetch(url + "/photos/right-top", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "image/png" },
        body: "not an image",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url + "/photos/extra-5", {
        method: "PUT",
        headers,
        body: png,
      })
    ).status,
    405,
  );
  for (const slot of [...slots, ...EXTRA_SLOTS])
    assert.equal(
      (
        await fetch(url + "/photos/" + slot, {
          method: "PUT",
          headers,
          body: png,
        })
      ).status,
      200,
    );
  const before = (await (await fetch(url)).json()).uploads["right-top"].id;
  await fetch(url + "/photos/right-top", { method: "PUT", headers, body: png });
  assert.notEqual(
    (await (await fetch(url)).json()).uploads["right-top"].id,
    before,
  );
  assert.equal(readdirSync(demo.vaultDir).includes(before + ".enc"), false);
  assert.deepEqual(
    Buffer.from(await (await fetch(url + "/photos/right-top")).arrayBuffer()),
    png,
  );
  assert.equal(
    (await fetch(demo.base + "/api/capture/wrong/photos/right-top")).status,
    404,
  );
  const payload = { ...completion(), slots: [...slots, ...EXTRA_SLOTS] },
    response = await fetch(url + "/complete", post(payload)),
    data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.receipt.photoCount, 10);
  const retry = await (await fetch(url + "/complete", post(payload))).json();
  assert.deepEqual(retry.receipt, data.receipt);
  assert.equal(
    (
      await fetch(
        url + "/complete",
        post({ ...payload, checkIn: { meaningfulChange: "yes", note: "" } }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await fetch(url + "/photos/right-top", {
        method: "PUT",
        headers,
        body: png,
      })
    ).status,
    410,
  );
  assert.equal(
    demo.events.filter((e) => e.type === "capture_completed").length,
    1,
  );
  const stored = readFileSync(join(demo.vaultDir, "sessions.enc"));
  assert.equal(stored.includes(Buffer.from(token)), false);
  assert.equal(stored.includes(Buffer.from("Synthetic test note")), false);
  const photoId = (await (await fetch(url)).json()).uploads["right-top"].id;
  assert.equal(
    readFileSync(join(demo.vaultDir, photoId + ".enc")).includes(png),
    false,
  );
});
test("uploaded photos and completion receipt survive server restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flo-restart-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = await setup(t, dir),
    token = a.issueDemoLink(),
    url = a.base + "/api/capture/" + token;
  await fetch(url + "/start", post({}));
  for (const slot of slots)
    await fetch(url + "/photos/" + slot, { method: "PUT", headers, body: png });
  await fetch(url + "/complete", post(completion()));
  await new Promise((resolve) => a.server.close(resolve));
  const b = await setup(t, dir),
    info = await (await fetch(b.base + "/api/capture/" + token)).json();
  assert.equal(info.state, "completed");
  assert.equal(info.receipt.photoCount, 6);
  assert.equal(Object.keys(info.uploads).length, 6);
});
test("extra removal frees a slot without deleting the six required uploads", async (t) => {
  const demo = await setup(t),
    url = demo.base + "/api/capture/" + demo.issueDemoLink();
  await fetch(url + "/start", post({}));
  await fetch(url + "/photos/extra-1", { method: "PUT", headers, body: png });
  assert.equal(
    (await fetch(url + "/photos/extra-1", { method: "DELETE", headers }))
      .status,
    200,
  );
  assert.equal((await fetch(url + "/photos/extra-1")).status, 404);
  assert.deepEqual((await (await fetch(url)).json()).uploads, {});
});
