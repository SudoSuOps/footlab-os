import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { openLocalVault } from '../packages/capture-links/src/local-vault.mjs';
import { readReviews, selectSession } from '../packages/capture-links/src/local-review.mjs';
import { reportStore, privateJson, proofManifest, transition, sendReport, sha256, REPORT_TO } from '../packages/capture-links/src/report-pipeline.mjs';
process.umask(0o077);
const home = process.env.FLO_PILOT_HOME ?? join(homedir(), 'flo-private');
const config = privateJson(join(home, 'report-email.json'));
if (config.to !== REPORT_TO || config.model !== 'medgemma1.5:4b' || !/^[a-f0-9]{64}$/.test(config.modelDigest)) throw new Error('Invalid personal report configuration.');
const store = reportStore(home);
if (process.argv.includes('--status')) {
  const vault = openLocalVault(join(home, 'vault'), { keyPath: join(home, 'vault.key') });
  console.log(JSON.stringify(vault.load().links.filter(r => r.completedAt).map(r => store.exists(r.requestId + '.job') ? store.load(r.requestId + '.job') : { requestId: r.requestId, state: 'awaiting-worker' }), null, 2));
  process.exit(0);
}
if (!Number.isFinite(Date.parse(config.expiresAt)) || Date.now() >= Date.parse(config.expiresAt)) {
  console.log('Personal report automation window ended. No email sent.'); process.exit(0);
}
const lock = join(store.root, 'worker.lock');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid worker lock; inspect locally.');
  try { process.kill(pid, 0); console.log('Report worker already running.'); process.exit(0); }
  catch (error) { if (error.code !== 'ESRCH') throw error; unlinkSync(lock); }
}
const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
try {
  const vault = openLocalVault(join(home, 'vault'), { keyPath: join(home, 'vault.key') });
  const completed = vault.load().links.filter(r => r.clientId === 'F-PERSONAL-001' && r.completedAt && r.issuedAt >= '2026-10-06T04:00:00Z' && r.issuedAt < '2026-11-06T05:00:00Z');
  for (const record of completed) {
    const { slots } = selectSession({ links: [record] }, record.requestId);
    let job = store.exists(record.requestId + '.job') ? store.load(record.requestId + '.job') : null;
    if (job && ['email-submitted', 'email-submission-started', 'email-failed-or-uncertain', 'failed'].includes(job.state)) continue;
    if (job?.state === 'analysis-failed' && Date.now() - Date.parse(job.events.at(-1).at) < 300000) continue;
    try {
      for (const slot of slots) if (sha256(vault.readImage(record.uploads[slot].id)) !== record.uploads[slot].sha256) throw new Error('Source checksum failed.');
      if (!job?.proofHash) {
        const attempts = (job?.analysisAttempts ?? 0) + 1;
        if (attempts > 3) { transition(store, record.requestId, 'failed', { reason: 'analysis-attempt-limit' }); continue; }
        transition(store, record.requestId, 'analysis-started', { analysisAttempts: attempts, captureReceivedAt: record.receipt.receivedAt });
        let reviews = existsSync(join(home, 'reviews')) ? readReviews(home, record.requestId) : [];
        let review = reviews.filter(r => r.modelDigest === config.modelDigest && r.observations.length === record.receipt.photoCount && r.observations.every(o => o.sourceSha256 === record.uploads[o.slot]?.sha256)).at(-1);
        if (!review) {
          const result = spawnSync(process.execPath, [fileURLToPath(new URL('./review-private-checkin.mjs', import.meta.url)), '--request', record.requestId, '--model', config.model], { stdio: 'ignore', timeout: 3600000, env: process.env });
          if (result.status !== 0) throw new Error('Local inference failed.');
          reviews = readReviews(home, record.requestId);
          review = reviews.filter(r => r.modelDigest === config.modelDigest && r.observations.length === record.receipt.photoCount && r.observations.every(o => o.sourceSha256 === record.uploads[o.slot]?.sha256)).at(-1);
          if (!review) throw new Error('Review does not match the configured model/source photos.');
        }
        const proof = proofManifest(record, review, config.profile ?? {});
        store.save(record.requestId + '.manifest', proof);
        const result = spawnSync(config.python, [fileURLToPath(new URL('./render-flo-report.py', import.meta.url))], { input: JSON.stringify(proof), maxBuffer: 16 * 1024 * 1024, timeout: 60000, stdio: ['pipe','pipe','ignore'] });
        if (result.status !== 0 || !result.stdout.subarray(0,5).equals(Buffer.from('%PDF-'))) throw new Error('PDF generation failed.');
        store.put(record.requestId + '.pdf', result.stdout);
        job = transition(store, record.requestId, 'pdf-ready', { proofHash: proof.proofHash, pdfSha256: sha256(result.stdout), modelDigest: review.modelDigest, qualityFlagCount: proof.manifest.qualityFlags.length });
      }
      const pdf = store.get(record.requestId + '.pdf');
      if (sha256(pdf) !== job.pdfSha256) throw new Error('PDF checksum mismatch.');
      if (process.argv.includes('--prepare-only')) { console.log(`FLO ${record.requestId}: encrypted PDF prepared; no email sent.`); continue; }
      transition(store, record.requestId, 'email-submission-started'); // durable claim before external side effect
      try {
        const proof = store.load(record.requestId + '.manifest');
        if (proof.proofHash !== job.proofHash) throw new Error('Report manifest mismatch.');
        const emailId = await sendReport({ config, pdf, proofHash: job.proofHash, proof });
        transition(store, record.requestId, 'email-submitted', { emailId });
        console.log(`FLO ${record.requestId}: report email submitted; delivery unconfirmed.`);
      } catch {
        transition(store, record.requestId, 'email-failed-or-uncertain');
        console.error(`FLO ${record.requestId}: email held for inspection; no automatic resend.`);
      }
    } catch {
      const current = store.exists(record.requestId + '.job') ? store.load(record.requestId + '.job') : null;
      if (!current || !current.state.startsWith('email-')) transition(store, record.requestId, 'analysis-failed');
      console.error(`FLO ${record.requestId}: processing failed; inspect local status.`);
    }
  }
} finally { unlinkSync(lock); }
