import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { issueCaptureLink, captureLinkState, tokenMatches } from '../src/index.ts';
import { CAPTURE_VIEWS, validateCaptureSubmission } from '../src/submission.mjs';
import { createCaptureDemo } from '../../../scripts/demo-capture-server.mjs';
const payload=()=>({captures:CAPTURE_VIEWS.map(viewId=>({viewId,mimeType:'image/jpeg',size:1024,fileName:'private-name.jpg'})),checkIn:{meaningfulChange:'unsure',note:''}});
test('link lifetime is bounded and invalid expiry fails closed',()=>{
  const link=issueCaptureLink({requestId:'r',clientId:'c',issuedAt:new Date('2026-10-06T00:00:00Z'),ttlMinutes:1});
  assert.equal(tokenMatches(link.rawToken,link.record.tokenHash),true);
  assert.equal(tokenMatches('wrong',link.record.tokenHash),false);
  assert.equal(captureLinkState(link.record,new Date(link.record.expiresAt)),'expired');
  assert.equal(captureLinkState({...link.record,expiresAt:'bad'}),'expired');
  for(const ttlMinutes of [0,-1,Infinity,10081]) assert.throws(()=>issueCaptureLink({requestId:'r',clientId:'c',ttlMinutes}));
});
test('rejects duplicate views and invalid metadata; strips filenames',()=>{
  assert.equal('fileName' in validateCaptureSubmission(payload()).captures[0],false);
  for(const patch of [{viewId:'unknown'},{mimeType:'text/html'},{size:0},{size:20971521}]) {
    const p=payload();p.captures[0]={...p.captures[0],...patch};assert.throws(()=>validateCaptureSubmission(p));
  }
  const p=payload();p.captures[1]=p.captures[0];assert.throws(()=>validateCaptureSubmission(p));
});
test('HTTP preview does not start; completion validates body and cannot be replayed',async t=>{
  const {server,issueDemoLink,events}=createCaptureDemo();
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,token=issueDemoLink(),url=base+'/api/capture/'+token;
  assert.equal((await fetch(base+'/c/'+token)).status,200);
  assert.equal(events.some(e=>e.type==='capture_started'),false);
  const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal((await fetch(url+'/complete',post(JSON.stringify(payload())))).status,409);
  await fetch(url+'/start',post('{}'));await fetch(url+'/start',post('{}'));
  assert.equal(events.filter(e=>e.type==='capture_started').length,1);
  assert.equal((await fetch(url+'/complete',post('{'))).status,400);
  assert.equal((await fetch(url+'/complete',post(' '.repeat(17000)))).status,413);
  assert.equal((await fetch(url+'/complete',post(JSON.stringify({captures:[]})))).status,400);
  assert.equal((await fetch(url+'/complete',post(JSON.stringify(payload())))).status,200);
  assert.equal((await fetch(url+'/complete',post(JSON.stringify(payload())))).status,410);
  assert.equal(events.filter(e=>e.type==='capture_completed').length,1);
});
