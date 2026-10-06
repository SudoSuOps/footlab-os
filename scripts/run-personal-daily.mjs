import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { claimDailyAttempt } from '../packages/messaging/src/personal-schedule.mjs';
process.umask(0o077);
const home = process.env.FLO_PILOT_HOME ?? join(homedir(), 'flo-private');
// Claim and sync BEFORE calling the issuer. Never retry an uncertain submission.
const claim = claimDailyAttempt(home);
if (!claim) { console.log('Not due or attempt already recorded; no SMS sent.'); process.exit(0); }
const { day, path } = claim;
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./issue-private-checkin.mjs', import.meta.url)), '+15615327120'], {
  stdio: 'ignore', timeout: 60000, env: process.env,
});
const state = result.status === 0 ? 'submitted' : 'failed-or-uncertain';
writeFileSync(path, JSON.stringify({ day, state, finishedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
console.log(`FLO daily ${day}: ${state}. Submission is not confirmation of delivery.`);
process.exitCode = result.status === 0 ? 0 : 1;
