import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { DAYS, TIMEZONE, timerUnit } from '../packages/messaging/src/personal-schedule.mjs';
import { loadSmsCredentials } from '../packages/messaging/src/credentials.mjs';
import { pilotControl } from './pilot-control.mjs';
process.umask(0o077);
const home = resolve(process.env.FLO_PILOT_HOME ?? join(homedir(), 'flo-private'));
const env = {};
loadSmsCredentials({ home, env }); // Requires saved credentials; never relies on terminal exports.
const health = await pilotControl(join(home, 'control.sock'), { action: 'health' });
if (health.mode !== 'private-pilot') throw new Error('Start the private FLO pilot first.');
const { sessions } = await pilotControl(join(home, 'control.sock'), { action: 'list' });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const remaining = DAYS.filter(d => d >= today && !existsSync(join(home, 'daily-sends', `${d}.json`))).length;
if (!remaining) throw new Error('The authorized 30-day schedule is finished.');
if (sessions.length + remaining > 32) throw new Error('Pilot session capacity is insufficient for this schedule; preserve the vault and resolve capacity first.');
const app = fileURLToPath(new URL('..', import.meta.url));
function quote(value) {
  if (/[\n\r%]/.test(value)) throw new Error('Unsupported service path.');
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
}
const service = `[Unit]\nDescription=FLO personal daily SMS (owner only)\nAfter=flo-private-pilot.service\nRequires=flo-private-pilot.service\n\n[Service]\nType=oneshot\nWorkingDirectory=${quote(app)}\nEnvironment=${quote('FLO_PILOT_HOME=' + home)}\nExecStart=${quote(process.execPath)} ${quote(join(app, 'scripts/run-personal-daily.mjs'))}\nUMask=0077\nNoNewPrivileges=true\nTimeoutStartSec=90\nRestart=no\n`;
const root = join(homedir(), '.config/systemd/user');
mkdirSync(root, { recursive: true, mode: 0o700 });
for (const [name, content] of [['flo-personal-daily.service', service], ['flo-personal-daily.timer', timerUnit()]]) {
  const path = join(root, name);
  if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw new Error('Existing FLO schedule differs; refusing to overwrite.');
  writeFileSync(path, content, { mode: 0o600 });
}
execFileSync('systemd-analyze', ['verify', join(root, 'flo-personal-daily.service'), join(root, 'flo-personal-daily.timer')], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'enable', '--now', 'flo-personal-daily.timer'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'list-timers', 'flo-personal-daily.timer', '--no-pager'], { stdio: 'inherit' });
console.log('Installed: 9am America/New_York, October 7–November 5, 2026. No SMS sent by this installer.');
