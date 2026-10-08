import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { discoverHomebridge, HomebridgeDoor, HomebridgeBolt, HomebridgeMotorRelay, HomebridgeInput, HapSubscription } from '../src/homebridge-devices.js';
const c=(type,iid,value,perms=['pr','pw','ev'])=>({type,iid,value,perms});
const info=(serial)=>({type:'3E',iid:1,characteristics:[c('20',2,'Fixture'),c('21',3,'Test'),c('30',4,serial),c('23',5,'Test accessory')]});
async function fixture(t){
 const data={accessories:[{aid:1,services:[info('AA:BB:CC:DD:EE:FF')]},{aid:2,services:[info('garage'),{type:'41',iid:10,characteristics:[c('E',11,1),c('24',12,false),c('32',13,1)]},{type:'49',iid:20,characteristics:[c('25',21,true)]},{type:'89',iid:30,characteristics:[c('73',31,null,['pr','ev'])]}]}]};const writes=[];let broken=false;
 const server=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'031-45-154');
  if(req.url==='/accessories')return res.end(JSON.stringify(data));
  if(req.method==='GET'){const ids=new URL(req.url,'http://test').searchParams.get('id').split(',');return res.end(JSON.stringify({characteristics:ids.map(id=>{const[aid,iid]=id.split('.').map(Number);const v=data.accessories.find(a=>a.aid===aid).services.flatMap(s=>s.characteristics).find(c=>c.iid===iid);return {aid,iid,...(broken?{status:-70402}:{value:v.value})};})}));}
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);writes.push(body);res.writeHead(204);res.end();
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const baseUrl='http://127.0.0.1:'+server.address().port;
 const found=await discoverHomebridge(baseUrl,'031-45-154');const connection=kind=>({type:'homebridge',baseUrl,credentialRef:'test',...found.services.find(s=>s.kind===kind)});
 return{data,writes,baseUrl,connection,broken:()=>{broken=true;}};
}
test('Homebridge adapters pin identity, read live characteristics and accept 204 writes once',async t=>{
 const f=await fixture(t);const cfg=f.connection('garage');const door=new HomebridgeDoor(cfg,'031-45-154',{readOnly:false,feedback:{opening:'sensor',closing:'sensor'}});
 assert.equal((await door.read()).door,'closed');await door.write('open');assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0],{characteristics:[{aid:2,iid:13,value:0}]});
 const bolt=new HomebridgeBolt({...f.connection('switch'),serviceType:'switch',lockedValue:false},'031-45-154',{readOnly:false});assert.equal((await bolt.read()).locked,false);await bolt.write(true);assert.equal(f.writes[1].characteristics[0].value,false);
 const motor=new HomebridgeMotorRelay({...f.connection('switch'),activeValue:true,inactiveWriteIdempotent:true},'031-45-154',{readOnly:false});assert.equal((await motor.read()).active,true);
 f.data.accessories[1].services[0].characteristics.find(c=>c.type==='30').value='replacement';await assert.rejects(door.write('close'),/identity_mismatch/);assert.equal(f.writes.length,2);
});
test('Homebridge errors and read-only mode do not write; button discovery is not an event',async t=>{
 const f=await fixture(t);const input=new HomebridgeInput({...f.connection('button'),kind:'button'},'031-45-154');assert.equal((await input.inspect()).value,null);assert.equal(f.writes.length,0);
 const door=new HomebridgeDoor(f.connection('garage'),'031-45-154',{feedback:{opening:'sensor',closing:'sensor'}});await assert.rejects(door.write('open'),/actuation_disabled/);f.broken();await assert.rejects(door.read(),/state_unavailable/);assert.equal(f.writes.length,0);
});
test('temporarily absent child-bridge services are unavailable while changed identities still reject',async t=>{
 const f=await fixture(t),door=new HomebridgeDoor(f.connection('garage'),'031-45-154',{feedback:{opening:'sensor',closing:'sensor'}});
 const accessory=f.data.accessories.pop();await assert.rejects(door.read(),/homebridge_service_unavailable/);
 f.data.accessories.push(accessory);assert.equal((await door.read()).door,'closed');
 accessory.services[0].characteristics.find(c=>c.type==='30').value='replaced';
 await assert.rejects(door.read(),/homebridge_service_identity_mismatch/);assert.deepEqual(f.writes,[]);
});
test('HAP live subscription parses split frames and repeated events without snapshot replay',async t=>{
 let peer;const server=net.createServer(s=>{peer=s;s.once('data',()=>s.write('HTTP/1.1 204 No Content\r\n\r\n'));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{peer?.destroy();server.close();});
 const stream=new HapSubscription('http://127.0.0.1:'+server.address().port,'031-45-154',2,31);const values=[];stream.on('value',v=>values.push(v));stream.start();await once(stream,'ready');assert.deepEqual(values,[]);
 const body=JSON.stringify({characteristics:[{aid:2,iid:31,value:0}]});const frame='EVENT/1.0 200 OK\r\nContent-Length: '+Buffer.byteLength(body)+'\r\n\r\n'+body;
 const first=once(stream,'value');peer.write(frame.slice(0,20));peer.write(frame.slice(20));await first;
 const second=once(stream,'value');peer.write(frame);await second;assert.deepEqual(values,[0,0]);const ended=once(stream,'closed');peer.end('EVENT/1.0 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n');await ended;
});
