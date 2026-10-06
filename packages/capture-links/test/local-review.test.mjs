import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openLocalVault } from '../src/local-vault.mjs';
import { reviewSession, selectSession, saveReview, readReviews } from '../src/local-review.mjs';
import { ALL_SLOTS, PROTOCOL_ID } from '../src/protocol.mjs';

test('personal completed ten-view review stays ordered, encrypted and outside capture state', async () => {
  const home = mkdtempSync(join(tmpdir(), 'flo-review-'));
  try {
    const keyPath = join(home, 'vault.key'); writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
    const vault = openLocalVault(join(home, 'vault'), { keyPath });
    const uploads = Object.fromEntries(ALL_SLOTS.map(slot => [slot, vault.putImage(Buffer.from([255,216,255,1,255,217]))]));
    const requestId = '3cc3d0fa-8ff1-47f5-85d0-dcaf4880e6db';
    vault.save({ links: [{ requestId, clientId: 'F-PERSONAL-001', completedAt: '2026-10-06T19:24:09Z', protocolId: PROTOCOL_ID, receipt: { photoCount: 10 }, uploads }], events: [] });
    const before = readFileSync(join(home, 'vault', 'sessions.enc'));
    const calls = [];
    const review = await reviewSession({ vault, requestId, model: 'medgemma-test', modelDigest: 'test', chat: async body => {
      calls.push(body); assert.equal(body.stream, false); assert.equal(body.messages[1].images.length, 1);
      return 'Unverified visible feature';
    } });
    assert.deepEqual(review.observations.map(o => o.slot), ALL_SLOTS);
    assert.equal(calls.length, 10); assert.equal(review.humanReviewed, false);
    const path = saveReview(home, review);
    assert.equal(readFileSync(path).includes(Buffer.from('Unverified visible feature')), false);
    assert.deepEqual(readReviews(home, requestId), [review]);
    assert.deepEqual(readFileSync(join(home, 'vault', 'sessions.enc')), before);
    const ciphertext = readFileSync(path); ciphertext[30] ^= 1; writeFileSync(path, ciphertext);
    assert.throws(() => readReviews(home, requestId));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('incomplete/non-personal sessions rejected; checksum failure never calls model', async () => {
  const requestId = 'test';
  assert.throws(() => selectSession({ links: [{ requestId, clientId: 'F-PERSONAL-001' }] }, requestId));
  assert.throws(() => selectSession({ links: [{ requestId, clientId: 'F-DEMO-001', completedAt: 'now' }] }, requestId));
  const uploads = Object.fromEntries(ALL_SLOTS.map(s => [s, { id: '3cc3d0fa-8ff1-47f5-85d0-dcaf4880e6db', sha256: 'wrong' }]));
  const record = { requestId, clientId: 'F-PERSONAL-001', completedAt: 'now', protocolId: PROTOCOL_ID, receipt: { photoCount: 10 }, uploads };
  await assert.rejects(reviewSession({ vault: { load: () => ({ links: [record] }), readImage: () => Buffer.from('altered') }, requestId, model: 'medgemma', chat: () => assert.fail('must not call model') }), /checksum/);
});
