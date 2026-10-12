import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { CoordinatorRuntime } from '../src/runtime.js';
import { webCoordinatorKeypad } from '../src/web-admin-coordinator.js';
import { WebAdminController } from '../src/web-admin-controller.js';
import { hardwareFixture } from './support/hardware.mjs';
import { loadIdentity } from '../src/storage.js';

const example=JSON.parse(await readFile(new URL('../examples/development-config.json',import.meta.url),'utf8'));
test('automatic web keypad coordinates the real primary drivers without a per-garage keypad setting',async t=>{
  const hw=await hardwareFixture(example.controllers[0]),directory=await mkdtemp(path.join(tmpdir(),'web-keypad-garage-'));
  await loadIdentity(directory);
  t.after(async()=>{await hw.close();await rm(directory,{recursive:true,force:true});});
  const p=hw.config;p.keypad=null;p.feedback.openingSeconds=1;p.feedback.closedStableSeconds=0;p.feedback.boltSettleSeconds=0;
  p.timing={idlePollSeconds:30,openRetractSettleSeconds:0,closeRetractSettleSeconds:0};
  let now=0;const runtime=new CoordinatorRuntime({storagePath:directory,configuration:{...example,controllers:[p]},
    credentials:async()=>hw.credentials,clock:{now:()=>now,wall:()=>Date.now(),sleep:async ms=>{now+=ms;}}});
  t.after(()=>runtime.stop());await runtime.start();
  await runtime.commission(p.id,{revision:runtime.state.revision,previousControllerStopped:true,physicalSetupReviewed:true});
  assert.deepEqual(hw.state.writes,[]);assert.equal(runtime.configuration.controllers[0].keypad,null);
  assert.throws(()=>runtime.keypadBegin(p.id,{gatewayId:p.bolt.gatewayId,alarmId:1}),/keypad_scope_mismatch/,'Legacy API does not acquire a new unauthenticated mapping');
  const registration={endpoint:p.bolt.baseUrl,identity:p.bolt.gatewayId.replaceAll(':','').toUpperCase()};
  const opening=webCoordinatorKeypad(runtime,registration,1)(performance.now()/1000);
  await opening.after('accepted','disarm');await runtime.entry(p.id).job;
  assert.equal(runtime.entry(p.id).engine.state.phase,'open');
  assert.deepEqual(hw.state.writes,[['bolt',false],['door','open']]);
  const closing=webCoordinatorKeypad(runtime,registration,1)(performance.now()/1000);
  await closing.after('rejected','disarm');await runtime.entry(p.id).job;
  assert.equal(runtime.entry(p.id).engine.state.phase,'closed');assert.equal(hw.state.locked,true);
  assert.deepEqual(hw.state.writes,[['bolt',false],['door','open'],['door','close'],['bolt',true]]);
  assert.equal(runtime.configuration.controllers[0].keypad,null);
});
test('an empty Controller page has no garage operations while web administration remains available',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'web-only-controller-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await loadIdentity(directory);
  const runtime=new CoordinatorRuntime({storagePath:directory,configuration:{platform:'GDoorAndBoltCoordinator',controllers:[]},
    drivers:()=>{throw Error('No garage driver should be created');}});
  t.after(()=>runtime.stop());await runtime.start();
  const controller=new WebAdminController(runtime);
  assert.deepEqual((await controller.dispatch('controller_settings',{})).controllers,[]);
  await assert.rejects(controller.dispatch('controller_check_state',{controllerId:'missing',revision:runtime.state.revision,bootId:runtime.bootId}),/controller_not_found/);
  assert.equal(webCoordinatorKeypad(runtime,{identity:'0011223344556677',endpoint:'http://example.invalid'},1)(0),null);
  assert.equal(runtime.entries.size,0);assert.equal(runtime.tickets.size,0);
});
