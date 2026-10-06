import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { openLocalVault } from '../packages/capture-links/src/local-vault.mjs';
import { reviewSession, saveReview, readReviews } from '../packages/capture-links/src/local-review.mjs';

process.umask(0o077);
const home = process.env.FLO_PILOT_HOME ?? join(homedir(), 'flo-private');
const args = process.argv.slice(2);
function value(flag) { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }
const requestId = value('--request'), model = value('--model');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function api(path, body, timeout = 15000) {
  // Fixed loopback only. No environment endpoint, remote fallback or redirects.
  const response = await fetch(`http://127.0.0.1:11434/api/${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`Local Ollama ${path} failed (HTTP ${response.status}).`);
  return response.json();
}
try {
  if (args.includes('--probe')) {
    const tags = await api('tags');
    const models = [];
    for (const entry of tags.models ?? []) {
      if (!/medgemma/i.test(entry.name)) continue;
      const info = await api('show', { model: entry.name });
      models.push({ name: entry.name, digest: entry.digest, vision: info.capabilities?.includes('vision') === true,
        remote: Boolean(info.remote_host || info.remote_model || entry.remote_host || entry.remote_model || /(?:^|[-:])cloud(?:$|[-:])/i.test(entry.name)) });
    }
    console.log(JSON.stringify({ endpoint: '127.0.0.1:11434', medgemmaModels: models, photosRead: 0 }, null, 2));
    if (!models.length) console.log('No installed MedGemma model found. No model downloaded and no photos sent.');
  } else {
    if (!uuid.test(requestId ?? '')) throw new Error('Provide --request with the completed receipt UUID.');
    for (const path of [home, join(home, 'vault.key'), join(home, 'vault'), ...(existsSync(join(home, 'reviews')) ? [join(home, 'reviews')] : [])]) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('Private pilot paths must be owner-only and not symlinks.');
    }
    if (args.includes('--show')) {
      const reviews = readReviews(home, requestId);
      if (!reviews.length) throw new Error('No saved review for this check-in.');
      console.log(JSON.stringify(reviews.at(-1), null, 2));
    } else {
      if (!model || !/medgemma/i.test(model)) throw new Error('Provide --model with an installed MedGemma vision model name from --probe.');
      const tags = await api('tags'), entry = tags.models?.find(m => m.name === model);
      if (!entry) throw new Error('Model is not installed locally. Run --probe.');
      const info = await api('show', { model });
      if (info.remote_host || info.remote_model || entry.remote_host || entry.remote_model || /(?:^|[-:])cloud(?:$|[-:])/i.test(model)) throw new Error('Remote/cloud models are not allowed.');
      if (!info.capabilities?.includes('vision')) throw new Error('Installed model does not advertise vision support.');
      const vault = openLocalVault(join(home, 'vault'), { keyPath: join(home, 'vault.key') });
      const review = await reviewSession({ vault, requestId, model, modelDigest: entry.digest,
        chat: async body => (await api('chat', body, 300000)).message?.content,
        progress: (done, total) => console.log(`Processed ${done}/${total}. Unverified experimental output.`) });
      const path = saveReview(home, review);
      console.log(`Encrypted experimental observations saved: ${path}`);
      console.log('No capture records changed. No SMS sent. Human review required.');
    }
  }
} catch (error) {
  // Never print provider bodies, photos, prompts, tokens or model output on failure.
  console.error(error.message.startsWith('fetch') ? 'Local Ollama is unavailable. Start Ollama and run --probe.' : error.message);
  process.exitCode = 1;
}
