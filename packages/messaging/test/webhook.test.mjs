import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTwilioFormSignature } from '../src/webhook.mjs';
test('form signatures bind exact public URL and all fields; unsupported formats fail closed', () => {
  const publicUrl='https://example.com/twilio/status?source=flo',authToken='synthetic-test-token';
  const form=new URLSearchParams({MessageStatus:'delivered',MessageSid:'SMdemo'});
  const signature=createHmac('sha1',authToken).update(publicUrl+'MessageSidSMdemoMessageStatusdelivered').digest('base64');
  const input={publicUrl,authToken,form,signature};
  assert.equal(verifyTwilioFormSignature(input),true);
  for(const patch of [{publicUrl:publicUrl+'&extra=1'}, {authToken:'wrong'}, {signature:''}, {form:new URLSearchParams({MessageStatus:'failed',MessageSid:'SMdemo'})}, {form:{}}, {publicUrl:'http://example.com'}]) assert.equal(verifyTwilioFormSignature({...input,...patch}),false);
  form.append('MessageSid','another');
  assert.equal(verifyTwilioFormSignature(input),false);
});

import { composeFloCheckinSms } from '../src/checkin-copy.mjs';
test('FLO reminder uses generic care copy and an opaque HTTPS link',()=>{
  const text=composeFloCheckinSms('https://check.footlabos.com/c/'+'a'.repeat(43));
  assert.match(text,/It's FLO time/);assert.match(text,/Reply STOP/);assert.doesNotMatch(text,/diabet|expires today/i);
  for(const url of ['http://example.com/c/'+'a'.repeat(43),'https://example.com/c/F001','https://example.com/c/'+'a'.repeat(43)+'?name=client'])assert.throws(()=>composeFloCheckinSms(url));
});
