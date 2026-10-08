import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredConnections, LocalConnections } from '../src/local-connections.js';
const config=()=>({bridge:{name:'Main',port:51000,pin:'123-45-678'},platforms:[
  {platform:'Other',name:'Garage devices',_bridge:{username:'AA',port:51001}},
  {platform:'GDoorAndBoltCoordinator',_bridge:{username:'BB',port:51002}},
  {platform:'deCONZ',hosts:['192.0.2.20:8080','http://192.0.2.20:8080','http://key@192.0.2.21','http://192.0.2.22/api/secret']}
],accessories:[{accessory:'Switch',name:'Shared bridge',_bridge:{username:'AA',port:51009}},
{accessory:'Switch',name:'No port',_bridge:{username:'CC',pin:'234-56-789'}}]});
function fixture(){let cfg=config();const keys={},reads=[],writes=[];const service=new LocalConnections({readConfig:async()=>cfg,readKeys:async()=>keys,
inspect:async(...args)=>reads.push(args),saveKey:async row=>{writes.push(row);keys[row.reference]=row.secret;return {saved:true};}});
return {service,keys,reads,writes,cfg};}
test('documented config yields main/child bridges and deCONZ addresses; no private cache keys or coordinator bridge',()=>{
  const rows=configuredConnections(config());assert.equal(rows.length,4);
  assert.equal(rows.find(r=>r.name==='Garage devices').pin,'123-45-678');
  assert.equal(rows.find(r=>r.name==='No port').baseUrl,'');
  assert.equal(rows.filter(r=>r.type==='deconz').length,1);
  assert.equal(rows.some(r=>r.baseUrl.includes('51002')),false);
  assert.equal(rows.some(r=>r.name==='Shared bridge'),false);
  const cfg=config();cfg.platforms[0]._bridge.pin='invalid';
  assert.equal(configuredConnections(cfg).find(r=>r.name==='Garage devices').pin,null);
});
test('listing exposes no PIN, performs no device read/write, and import privately saves only after read check',async()=>{
 const f=fixture();const result=await f.service.list();
 assert.equal(JSON.stringify(result).includes('123-45-678'),false);
 assert.equal(JSON.stringify(result).includes('234-56-789'),false);
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);
 const selected=result.candidates.find(c=>c.name==='Garage devices');
 const saved=await f.service.importPin(selected.id);
 assert.deepEqual(f.reads,[['http://127.0.0.1:51001','123-45-678']]);
 assert.equal(saved.reference,selected.credentialRef);assert.equal(f.keys[saved.reference],'123-45-678');
 await f.service.importPin(selected.id);assert.equal(f.writes.length,1,'repeat import reuses a matching key');
 assert.equal(JSON.stringify(saved).includes('123-45-678'),false);
});
test('missing port/key and gateway rows cannot import; config drift or unknown IDs cannot send a PIN',async()=>{
 for(const change of ['address','pin','deleted','unknown']){
  const f=fixture(),result=await f.service.list(),row=result.candidates.find(r=>r.name==='Garage devices');
  if(change==='address')f.cfg.platforms[0]._bridge.port=51009;
  if(change==='pin')f.cfg.bridge.pin='345-67-890';
  if(change==='deleted')f.cfg.platforms.splice(0,1);
  await assert.rejects(f.service.importPin(change==='unknown'?'unknown':row.id));assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);
 }
 const f=fixture(),rows=(await f.service.list()).candidates;
 for(const row of rows.filter(r=>!r.canImportPin))await assert.rejects(f.service.importPin(row.id));
});
test('failed bridge access saves nothing; existing key matches are reused and conflicts never overwritten',async()=>{
 const f=fixture();f.keys.existing='123-45-678';
 const row=(await f.service.list()).candidates.find(r=>r.name==='Garage devices');assert.equal(row.credentialRef,'existing');
 f.service.inspect=async()=>{throw Error('unavailable');};await assert.rejects(f.service.importPin(row.id));assert.deepEqual(f.writes,[]);
 f.service.inspect=async()=>{};f.keys.existing='changed';await assert.rejects(f.service.importPin(row.id));assert.deepEqual(f.writes,[]);
 const next=(await f.service.list()).candidates.find(r=>r.name==='Garage devices');assert.notEqual(next.credentialRef,'existing');
});
