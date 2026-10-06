import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHomeSession, acceptHomeEvent, validateHomeEvent } from '../src/index.mjs';
const event = { version:1, deviceId:'FLO-DEMO', bootId:'boot-1', sequence:0, type:'checkin_requested', uptimeMs:100 };
test('button creates intent; replay, wrong device and unapproved reboot are rejected', () => {
  const initial = createHomeSession(event.deviceId,event.bootId);
  const result = acceptHomeEvent(initial,event);
  assert.equal(result.intent,'request_checkin');
  assert.equal(initial.lastSequence,-1);
  assert.throws(()=>acceptHomeEvent(result.session,event),/Stale/);
  assert.throws(()=>acceptHomeEvent(initial,{...event,deviceId:'other'}),/mismatch/);
  assert.throws(()=>acceptHomeEvent(initial,{...event,bootId:'boot-2'}),/mismatch/);
  assert.throws(()=>acceptHomeEvent(result.session,{...event,sequence:1,uptimeMs:99}),/Stale/);
});
test('heartbeat has no clinical or messaging action; clinical payloads cannot enter device protocol', () => {
  assert.equal(acceptHomeEvent(createHomeSession(event.deviceId,event.bootId),{...event,type:'heartbeat'}).intent,null);
  for (const patch of [{note:'private'}, {type:'healthy'}, {deviceId:undefined}, {sequence:NaN}, {uptimeMs:-1}]) {
    assert.throws(()=>validateHomeEvent({...event,...patch}),/Invalid/);
  }
});
