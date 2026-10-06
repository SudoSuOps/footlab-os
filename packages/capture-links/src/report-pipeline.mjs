import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, mkdirSync, renameSync, fsyncSync, existsSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
export const REPORT_TO = 'minechain@proton.me';
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function outputFlags(review, profile = {}) {
  return review.observations.flatMap(o => {
    const t = o.unverifiedModelText, flags = [];
    if (/\b(forearm|hand|elbow)\b/i.test(t)) flags.push('possible-wrong-body-part');
    if (/no (?:visible |clear )?(?:signs?|indication).*?(?:injury|infection|inflammation|abnormal)/i.test(t) || /generally intact|relatively normal/i.test(t)) flags.push('unsupported-reassurance');
    if (/possibly (?:a )?(?:corn|callus)|\bdiagnosis\b/i.test(t)) flags.push('diagnostic-speculation');
    const sentences = t.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 20);
    if (sentences.length - new Set(sentences).size >= 2) flags.push('repetitive-output');
    if (profile.leftGreatToeAbsent && o.slot.startsWith('left-') && /great toe/i.test(t)) flags.push('conflict-with-user-reported-anatomy');
    return flags.map(code => ({ slot: o.slot, code }));
  });
}
export function proofManifest(record, review, profile = {}) {
  const manifest = { schema: 'proof-of-flo-v1', reportTemplate: 'flo-personal-pdf-v1', receipt: record.receipt, checkIn: record.checkIn ?? null,
    review, profile: { source: 'user-reported', ...profile }, qualityFlags: outputFlags(review, profile) };
  return { manifest, proofHash: sha256(canonical(manifest)) };
}
export function privateJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.uid !== process.getuid() || s.mode & 0o077) throw new Error('Private settings permissions invalid.');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
}
export function reportStore(home) {
  const root = join(home, 'reports');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const path of [home, root, join(home, 'vault.key')]) {
    const s = lstatSync(path);
    if (s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o077) throw new Error('Report paths must be private.');
  }
  const key = readFileSync(join(home, 'vault.key'));
  if (key.length !== 32) throw new Error('Invalid report encryption key.');
  const file = name => { if (!/^[a-z0-9.-]+$/.test(name)) throw new Error('Invalid artifact name.'); return join(root, name + '.enc'); };
  function put(name, bytes) {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([c.update(bytes), c.final()]);
    const path = file(name), tmp = path + '.' + randomUUID();
    try {
      writeFileSync(tmp, Buffer.concat([iv, c.getAuthTag(), encrypted]), { mode: 0o600, flag: 'wx' });
      const fd = openSync(tmp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, path);
      const dir = openSync(root, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    } finally { if (existsSync(tmp)) unlinkSync(tmp); }
  }
  function get(name) {
    const bytes = readFileSync(file(name)), d = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12));
    d.setAuthTag(bytes.subarray(12,28)); return Buffer.concat([d.update(bytes.subarray(28)), d.final()]);
  }
  return { root, put, get, exists: name => existsSync(file(name)),
    load: name => JSON.parse(get(name)), save: (name, obj) => put(name, Buffer.from(JSON.stringify(obj))) };
}
export function transition(store, requestId, state, fields = {}) {
  const name = requestId + '.job';
  const job = store.exists(name) ? store.load(name) : { requestId, events: [] };
  const previousHash = job.events.at(-1)?.hash ?? null;
  const event = { state, at: new Date().toISOString(), previousHash, ...fields };
  job.events.push({ ...event, hash: sha256(canonical(event)) });
  job.state = state; Object.assign(job, fields); store.save(name, job); return job;
}
export async function sendReport({ config, pdf, proofHash, proof, fetchImpl = fetch }) {
  if (config.to !== REPORT_TO || !/^re_[A-Za-z0-9_-]+$/.test(config.apiKey ?? '') || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(config.from ?? '')) throw new Error('Invalid owner-only report email settings.');
  const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `flo-${proofHash}` },
    body: JSON.stringify({ from: `FootLabOS FLO <${config.from}>`, to: [REPORT_TO], subject: 'Your FLO check-in report — experimental observations',
      text: 'Your personal FLO report is attached. It contains unverified model observations and requires independent human review. It is not a diagnosis or an all-clear. Proof of FLO: ' + proofHash,
      attachments: [{ filename: 'FLO-check-in-report.pdf', content: pdf.toString('base64') },
        ...(proof ? [{ filename: 'Proof-of-FLO.json', content: Buffer.from(JSON.stringify({ ...proof, pdfSha256: sha256(pdf) }, null, 2)).toString('base64') }] : [])] }) });
  if (!response.ok) throw new Error(`Report email was not accepted (HTTP ${response.status}).`);
  const result = await response.json();
  if (typeof result.id !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(result.id)) throw new Error('Invalid report email receipt.');
  return result.id;
}
