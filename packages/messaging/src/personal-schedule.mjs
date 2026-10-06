export const TIMEZONE = 'America/New_York';
export const START_DATE = '2026-10-07';
export const DAYS = Object.freeze(Array.from({ length: 30 }, (_, i) => {
  const day = new Date('2026-10-07T12:00:00Z');
  day.setUTCDate(day.getUTCDate() + i);
  return day.toISOString().slice(0, 10);
}));
export function dueDay(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return DAYS.includes(day) && parts.hour === '09' && Number(parts.minute) < 5 ? day : null;
}
export function timerUnit() {
  return `[Unit]\nDescription=FLO personal 30-day 9am Eastern check-in\n\n[Timer]\n${DAYS.map(day => `OnCalendar=${day} 09:00:00 ${TIMEZONE}`).join('\n')}\nAccuracySec=1s\nRandomizedDelaySec=0\nPersistent=false\nUnit=flo-personal-daily.service\n\n[Install]\nWantedBy=timers.target\n`;
}
export function claimDailyAttempt(home, now = new Date()) {
  const day = dueDay(now);
  if (!day) return null;
  const root = join(home, 'daily-sends');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const path of [home, root]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error('Schedule paths must be private and owned by this user.');
  }
  const path = join(root, `${day}.json`);
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  try {
    writeFileSync(fd, JSON.stringify({ day, state: 'attempt-started', startedAt: now.toISOString() }) + '\n');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const dir = openSync(root, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  return { day, path };
}
import { join } from 'node:path';
import { openSync, closeSync, writeFileSync, fsyncSync, mkdirSync, lstatSync } from 'node:fs';
