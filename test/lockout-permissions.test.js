import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CoordinatorRuntime } from '../src/runtime.js';
import { validateConfiguration } from '../src/config.js';
import { controllerTimingValues, profileWithTimings } from '../src/controller-timings.js';
const example=JSON.parse(await readFile(new URL('../examples/input-routing-config.json',import.meta.url)));
const hash=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
test('saved legacy permissions preserve old behavior and commissioning across repeated normalization',async()=>{
  const config=validateConfiguration(example), p=config.controllers[0];
  const initial={schema:2,revision:1,configuration:config,commissioned:{[p.id]:hash(p)},enabled:{[p.id]:false},faults:{},requests:[],events:[],maintenance:null};
  let saved=structuredClone(initial);
  const run=async()=>{const runtime=new CoordinatorRuntime({storagePath:'/unused',configuration:example});
    runtime.store={read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value);}};await runtime.start();await runtime.stop();return runtime;};
  await run(); const migrated=saved.configuration.controllers[0];
  assert.equal(migrated.motorPaths[0].allowDuringOpenerLockout,true);
  assert.equal(migrated.inputs.find(i=>i.source.kind==='button').allowDuringOpenerLockout,true);
  assert.equal(saved.commissioned[p.id],hash(migrated));assert.equal(saved.enabled[p.id],false);
  const first=structuredClone(saved.configuration); await run(); assert.deepEqual(saved.configuration,first);assert.equal(saved.commissioned[p.id],hash(saved.configuration.controllers[0]));
});
test('new installations default off; explicit saved choices survive upgrades',async()=>{
  const config=validateConfiguration(example); for(const p of config.controllers){for(const m of p.motorPaths)m.allowDuringOpenerLockout=false;for(const i of p.inputs)i.allowDuringOpenerLockout=false;}
  let saved=null;const runtime=new CoordinatorRuntime({storagePath:'/unused',configuration:config});runtime.store={read:async()=>saved,write:async v=>{saved=structuredClone(v);}};
  await runtime.start();await runtime.stop(); assert.equal(saved.lockoutPermissionsVersion,1);
  delete saved.lockoutPermissionsVersion;await runtime.start();await runtime.stop();
  assert.equal(saved.configuration.controllers[0].motorPaths[0].allowDuringOpenerLockout,false);
  assert.equal(saved.configuration.controllers[0].inputs[0].allowDuringOpenerLockout,false);
});
test('web settings accept only Boolean permissions and preserve unrelated settings',()=>{
  const profile=validateConfiguration(example).controllers[0], values=controllerTimingValues(profile);
  values.motorPaths[0].allowDuringOpenerLockout=true;values.inputs[0].allowDuringOpenerLockout=false;
  const updated=profileWithTimings(profile,values);assert.equal(updated.motorPaths[0].allowDuringOpenerLockout,true);
  assert.deepEqual(updated.door,profile.door);assert.deepEqual(updated.inputs[0].source,profile.inputs[0].source);
  values.inputs[0].allowDuringOpenerLockout='true';assert.throws(()=>profileWithTimings(profile,values));
});
