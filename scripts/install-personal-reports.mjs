import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { privateJson, REPORT_TO } from '../packages/capture-links/src/report-pipeline.mjs';
process.umask(0o077);
const home = process.env.FLO_PILOT_HOME ?? join(homedir(), 'flo-private');
const config = privateJson(join(home, 'report-email.json'));
if (config.to !== REPORT_TO) throw new Error('Personal recipient mismatch.');
const app = fileURLToPath(new URL('..', import.meta.url));
if (/[\n\r%"]/.test(home + app + process.execPath)) throw new Error('Unsupported service paths.');
if (spawnSync(config.python, [join(app, 'scripts/render-flo-report.py'), '--check'], { stdio: 'ignore' }).status !== 0) throw new Error('Report PDF dependency missing.');
const root = join(homedir(), '.config/systemd/user'); mkdirSync(root, { recursive: true, mode: 0o700 });
const service = `[Unit]\nDescription=FLO personal encrypted report queue\nAfter=flo-private-pilot.service\nRequires=flo-private-pilot.service\n\n[Service]\nType=oneshot\nWorkingDirectory=${app}\nEnvironment="FLO_PILOT_HOME=${home}"\nExecStart="${process.execPath}" "${join(app, 'scripts/process-personal-reports.mjs')}"\nUMask=0077\nNoNewPrivileges=true\nTimeoutStartSec=2h\nRestart=no\n`;
const timer = '[Unit]\nDescription=FLO personal report queue scan\n[Timer]\nOnBootSec=2min\nOnUnitInactiveSec=60s\nUnit=flo-personal-reports.service\n[Install]\nWantedBy=timers.target\n';
for (const [name, text] of [['flo-personal-reports.service', service], ['flo-personal-reports.timer', timer]]) {
  const path = join(root, name);
  if (existsSync(path) && readFileSync(path, 'utf8') !== text) throw new Error('Existing report service differs; refusing overwrite.');
  writeFileSync(path, text, { mode: 0o600 });
}
execFileSync('systemd-analyze', ['verify', join(root, 'flo-personal-reports.service'), join(root, 'flo-personal-reports.timer')], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'enable', '--now', 'flo-personal-reports.timer'], { stdio: 'inherit' });
// Explicitly start existing completed personal captures too. This WILL submit their report emails.
execFileSync('systemctl', ['--user', 'start', '--no-block', 'flo-personal-reports.service'], { stdio: 'inherit' });
console.log('Report queue enabled for the authorized personal recipient. Existing completed check-in is queued.');
