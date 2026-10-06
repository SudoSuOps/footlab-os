import { createHomeSession, acceptHomeEvent } from '../packages/home-device/src/index.mjs';
let session=createHomeSession('FLO-DEMO-C6','demo-boot');
for (const [sequence,type] of ['heartbeat','checkin_requested'].entries()) {
  const result=acceptHomeEvent(session,{version:1,deviceId:session.deviceId,bootId:session.bootId,sequence,type,uptimeMs:sequence*1000});
  session=result.session;
  console.log(JSON.stringify(result));
}
console.log('Synthetic protocol simulation only; no hardware, SMS or clinical action.');
