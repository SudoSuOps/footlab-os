import test from 'node:test';
import assert from 'node:assert/strict';
import { DAYS, dueDay, timerUnit, claimDailyAttempt } from '../src/personal-schedule.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('exactly 30 dates; 9am local survives November daylight saving transition', () => {
  assert.equal(DAYS.length, 30); assert.equal(new Set(DAYS).size, 30);
  assert.equal(DAYS[0], '2026-10-07'); assert.equal(DAYS.at(-1), '2026-11-05');
  assert.equal(dueDay(new Date('2026-10-07T13:00:00Z')), '2026-10-07');
  assert.equal(dueDay(new Date('2026-11-01T14:00:00Z')), '2026-11-01');
  for (const date of ['2026-10-06T13:00:00Z', '2026-11-06T14:00:00Z', '2026-11-01T13:00:00Z', '2026-10-07T13:05:00Z']) assert.equal(dueDay(new Date(date)), null);
  assert.equal(timerUnit().match(/OnCalendar=/g).length, 30);
  assert.match(timerUnit(), /Persistent=false/);
});
test('durable attempt marker prevents retry after interrupted or uncertain send', () => {
  const home = mkdtempSync(join(tmpdir(), 'flo-daily-'));
  try {
    assert.equal(claimDailyAttempt(home, new Date('2026-10-07T12:00:00Z')), null);
    const first = claimDailyAttempt(home, new Date('2026-10-07T13:00:00Z'));
    assert.equal(JSON.parse(readFileSync(first.path)).state, 'attempt-started');
    assert.equal(claimDailyAttempt(home, new Date('2026-10-07T13:01:00Z')), null);
    assert.ok(claimDailyAttempt(home, new Date('2026-10-08T13:00:00Z')));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
