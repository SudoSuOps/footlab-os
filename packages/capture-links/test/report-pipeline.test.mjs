import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openLocalVault } from '../src/local-vault.mjs';
import { saveReview } from '../src/local-review.mjs';
import { ALL_SLOTS, PROTOCOL_ID } from '../src/protocol.mjs';
import { reportStore, proofManifest, canonical, sha256, transition, outputFlags, sendReport, REPORT_TO } from '../src/report-pipeline.mjs';
test('Proof of FLO canonicalizes keys and binds source, model, text and receipt', () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  const record = { receipt: { requestId: 'test', photoCount: 1 } };
  const review = { modelDigest: 'one', observations: [{ slot: 'left-plantar', sourceSha256: 'source', unverifiedModelText: 'great toe possibly a corn' }] };
  const proof = proofManifest(record, review, { leftGreatToeAbsent: true });
  assert.equal(proof.proofHash, sha256(canonical(proof.manifest)));
  for (const field of ['sourceSha256', 'unverifiedModelText']) {
    const changed = structuredClone(review); changed.observations[0][field] += 'changed';
    assert.notEqual(proof.proofHash, proofManifest(record, changed, { leftGreatToeAbsent: true }).proofHash);
  }
  assert.notEqual(proof.proofHash, proofManifest(record, { ...review, modelDigest: 'two' }, { leftGreatToeAbsent: true }).proofHash);
  assert.ok(proof.manifest.qualityFlags.some(f => f.code === 'conflict-with-user-reported-anatomy'));
});
test('flags wording defects without treating unflagged output as validated', () => {
  const flags = outputFlags({ observations: [{ slot: 'extra-3', unverifiedModelText: 'A forearm. No visible sign of acute injury or inflammation. Long repeated orientation sentence. Long repeated orientation sentence. Long repeated orientation sentence.' }] });
  assert.deepEqual(flags.map(f => f.code), ['possible-wrong-body-part','unsupported-reassurance','repetitive-output']);
});
test('PDF and hash-chained audit are encrypted and authenticated', () => {
  const home = mkdtempSync(join(tmpdir(), 'flo-report-'));
  try {
    writeFileSync(join(home, 'vault.key'), randomBytes(32), { mode: 0o600 });
    const store = reportStore(home);
    store.put('test.pdf', Buffer.from('%PDF-sensitive'));
    assert.equal(readFileSync(join(store.root, 'test.pdf.enc')).includes(Buffer.from('sensitive')), false);
    assert.equal(store.get('test.pdf').toString(), '%PDF-sensitive');
    transition(store, 'test', 'pdf-ready', { proofHash: 'abc' });
    const job = transition(store, 'test', 'email-submission-started');
    assert.equal(job.events[1].previousHash, job.events[0].hash);
    const { hash, ...event } = job.events[1]; assert.equal(hash, sha256(canonical(event)));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('email transport binds attachment and proof, rejects unapproved recipients', async () => {
  const config = { apiKey: 're_TEST', from: 'flo@example.com', to: REPORT_TO };
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.headers['Idempotency-Key'], 'flo-proof');
    const body = JSON.parse(options.body); assert.deepEqual(body.to, [REPORT_TO]);
    assert.equal(Buffer.from(body.attachments[0].content, 'base64').toString(), '%PDF-test');
    return { ok: true, json: async () => ({ id: '12345678-1234-1234-1234-123456789abc' }) };
  };
  assert.equal(await sendReport({ config, pdf: Buffer.from('%PDF-test'), proofHash: 'proof', fetchImpl }), '12345678-1234-1234-1234-123456789abc');
  await assert.rejects(sendReport({ config: { ...config, to: 'other@example.com' }, pdf: Buffer.from('test'), proofHash: 'proof', fetchImpl }));
  assert.equal(calls, 1);
});
test('queue prepares real PDF from encrypted completed capture and matching review without email', t => {
  const python = process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? 'python3';
  if (spawnSync(python, ['-c', 'import reportlab,pypdf']).status !== 0) { t.skip('ReportLab and pypdf unavailable'); return; }
  const home = mkdtempSync(join(tmpdir(), 'flo-queue-'));
  try {
    writeFileSync(join(home, 'vault.key'), randomBytes(32), { mode: 0o600 });
    const vault = openLocalVault(join(home, 'vault'), { keyPath: join(home, 'vault.key') });
    const requestId = '3cc3d0fa-8ff1-47f5-85d0-dcaf4880e6db';
    const uploads = Object.fromEntries(ALL_SLOTS.map(slot => [slot, vault.putImage(Buffer.from([255,216,255,1,255,217]))]));
    const record = { requestId, clientId: 'F-PERSONAL-001', issuedAt: '2026-10-06T19:19:22Z', completedAt: '2026-10-06T19:24:09Z', protocolId: PROTOCOL_ID,
      receipt: { requestId, receivedAt: '2026-10-06T19:24:09Z', photoCount: 10, protocolId: PROTOCOL_ID }, uploads, checkIn: { meaningfulChange: 'unsure', note: 'Synthetic test only' } };
    vault.save({ links: [record], events: [] });
    const before = readFileSync(join(home, 'vault/sessions.enc'));
    const modelDigest = 'a'.repeat(64);
    saveReview(home, { requestId, model: 'medgemma1.5:4b', modelDigest, generatedAt: '2026-10-06T20:10:00Z', humanReviewed: false,
      observations: ALL_SLOTS.map(slot => ({ slot, sourceSha256: uploads[slot].sha256, unverifiedModelText: 'Synthetic unverified observation. Medical accuracy not evaluated.' })) });
    writeFileSync(join(home, 'report-email.json'), JSON.stringify({ to: REPORT_TO, from: 'flo@example.com', apiKey: 're_TEST', model: 'medgemma1.5:4b', modelDigest, python,
      expiresAt: '2099-01-01T00:00:00Z' }), { mode: 0o600 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../../scripts/process-personal-reports.mjs', import.meta.url)), '--prepare-only'], { env: { ...process.env, FLO_PILOT_HOME: home }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const store = reportStore(home), job = store.load(requestId + '.job'), proof = store.load(requestId + '.manifest'), pdf = store.get(requestId + '.pdf');
    assert.equal(job.state, 'pdf-ready'); assert.equal(job.pdfSha256, sha256(pdf)); assert.equal(job.proofHash, proof.proofHash);
    assert.ok(!job.events.some(e => e.state.startsWith('email-')));
    const check = spawnSync(python, ['-c', 'import sys,io;from pypdf import PdfReader;r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));print("\\n".join(p.extract_text() for p in r.pages))'], { input: pdf });
    assert.equal(check.status, 0); const text = check.stdout.toString();
    assert.ok(text.includes('Proof of FLO')); assert.ok(text.includes(proof.proofHash.slice(0,32))); assert.ok(text.includes('Synthetic test only'));
    assert.deepEqual(readFileSync(join(home, 'vault/sessions.enc')), before);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
