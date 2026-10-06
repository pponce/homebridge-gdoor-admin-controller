import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { hardwareFixture } from './support/hardware.mjs';
import { loadIdentity } from '../src/storage.js';
import { CoordinatorRuntime } from '../src/runtime.js';
async function until(fn){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,'input operation timed out');await sleep(20);}}
test('real deCONZ WebSocket event drives its selected relay, while virtual keypad uses Tailwind',async t=>{
 const example=JSON.parse(await readFile(new URL('../examples/input-routing-config.json',import.meta.url),'utf8'));
 const p=example.controllers[0];p.inputs=p.inputs.slice(0,2);for(const i of p.inputs){i.rearmSeconds=0;i.timing={};i.busyBehavior='drop';}
 p.motorPaths[0].openPulseSeconds=.1;p.motorPaths[0].closePulseSeconds=.1;
 Object.assign(p.feedback,{openingSeconds:1,closedStableSeconds:0,boltSettleSeconds:0});p.timing={openRetractSettleSeconds:0,closeRetractSettleSeconds:0,idlePollSeconds:30};
 const hw=await hardwareFixture(p);hw.config.keypad={baseUrl:hw.config.bolt.baseUrl,gatewayId:p.bolt.gatewayId,alarmId:1,credentialRef:p.bolt.credentialRef};
 const storagePath=await mkdtemp(path.join(os.tmpdir(),'coordinator-live-'));await loadIdentity(storagePath);let now=0;
 const runtime=new CoordinatorRuntime({storagePath,configuration:{controllers:[hw.config]},credentials:async()=>hw.credentials,clock:{now:()=>now,wall:()=>Date.now(),sleep:async ms=>{now+=ms;}}});
 t.after(async()=>{await runtime.stop();await hw.close();await rm(storagePath,{recursive:true,force:true});});await runtime.start();assert.deepEqual(hw.state.requests,[]);
 await runtime.commission(p.id,{revision:1,previousControllerStopped:true,physicalSetupReviewed:true});await until(()=>runtime.entry(p.id).inputStates['indoor-button']==='ready');
 assert.deepEqual(hw.state.writes,[]);hw.emit('4',1002);await until(()=>runtime.entry(p.id).engine.state.phase==='open'&&!runtime.entry(p.id).engine.busy);
 assert.deepEqual(hw.state.writes,[['bolt',false],['motor',true],['motor',false]]);
 const ticket=runtime.keypadBegin(p.id,{gatewayId:p.bolt.gatewayId,alarmId:1});const after=await runtime.keypadAfter(ticket.token,'rejected','disarm',.1);assert.match(after.note,/Close requested/);await runtime.entry(p.id).job;
 assert.deepEqual(hw.state.writes.slice(3),[['bolt',false],['door','close'],['bolt',true]]);
 await until(()=>{const listener=runtime.entry(p.id).listeners.find(l=>l.profile.id==='physical-keypad');return listener.ready&&!listener.checking&&listener.contextKey===listener.context();});hw.emit('8','disarmed');await until(()=>runtime.entry(p.id).engine.state.phase==='open'&&!runtime.entry(p.id).engine.busy);
 assert.deepEqual(hw.state.writes.slice(6),[['bolt',false],['motor',true],['motor',false]]);
 await until(()=>{const listener=runtime.entry(p.id).listeners.find(l=>l.profile.id==='physical-keypad');return listener.ready&&!listener.checking&&listener.contextKey===listener.context();});
 hw.emit('8','invalid_code');await until(()=>runtime.entry(p.id).engine.state.phase==='closed'&&!runtime.entry(p.id).engine.busy);
 assert.deepEqual(hw.state.writes.slice(9),[['bolt',false],['motor',true],['motor',false],['bolt',true]]);
 await until(()=>{const listener=runtime.entry(p.id).listeners.find(l=>l.profile.id==='indoor-button');return listener.ready&&!listener.checking&&listener.contextKey===listener.context();});
 hw.emit('4',1002);await until(()=>runtime.entry(p.id).engine.state.phase==='open'&&!runtime.entry(p.id).engine.busy);
 assert.deepEqual(hw.state.writes.slice(13),[['bolt',false],['motor',true],['motor',false]]);
});
