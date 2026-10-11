import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { CoordinatorRuntime } from '../src/runtime.js';
import { validateConfiguration } from '../src/config.js';
import { controllerTimingValues, profileWithTimings } from '../src/controller-timings.js';
import { loadIdentity } from '../src/storage.js';
import { hardwareFixture } from './support/hardware.mjs';
const example=JSON.parse(await readFile(new URL('../examples/input-routing-config.json',import.meta.url)));
const hash=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
test('saved legacy profiles default permissions off without changing configuration or commissioning',async()=>{
  const config=validateConfiguration(example), p=config.controllers[0];
  const initial={schema:2,revision:1,configuration:config,commissioned:{[p.id]:hash(p)},enabled:{[p.id]:false},faults:{},requests:[],events:[],maintenance:null};
  let saved=structuredClone(initial);
  const run=async()=>{const runtime=new CoordinatorRuntime({storagePath:'/unused',configuration:example});
    runtime.store={read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value);}};await runtime.start();await runtime.stop();return runtime;};
  await run(); const migrated=saved.configuration.controllers[0];
  assert.equal(migrated.motorPaths[0].allowDuringOpenerLockout,undefined);
  assert.equal(migrated.inputs.find(i=>i.source.kind==='button').allowDuringOpenerLockout,undefined);
  assert.deepEqual(saved.configuration,initial.configuration);
  assert.equal(saved.commissioned[p.id],hash(migrated));assert.equal(saved.enabled[p.id],false);
  const first=structuredClone(saved.configuration); await run(); assert.deepEqual(saved.configuration,first);assert.equal(saved.commissioned[p.id],hash(saved.configuration.controllers[0]));
});
for (const allowed of [false,true]) test(`explicit saved permission ${allowed} survives restart`,async()=>{
  const config=validateConfiguration(example); for(const p of config.controllers){for(const m of p.motorPaths)m.allowDuringOpenerLockout=allowed;for(const i of p.inputs)i.allowDuringOpenerLockout=allowed;}
  let saved=null;const runtime=new CoordinatorRuntime({storagePath:'/unused',configuration:config});runtime.store={read:async()=>saved,write:async v=>{saved=structuredClone(v);}};
  await runtime.start();await runtime.stop(); await runtime.start();await runtime.stop();
  assert.equal(saved.configuration.controllers[0].motorPaths[0].allowDuringOpenerLockout,allowed);
  assert.equal(saved.configuration.controllers[0].inputs[0].allowDuringOpenerLockout,allowed);
});
test('web settings accept only Boolean permissions and preserve unrelated settings',()=>{
  const profile=validateConfiguration(example).controllers[0], values=controllerTimingValues(profile);
  values.motorPaths[0].allowDuringOpenerLockout=true;values.inputs[0].allowDuringOpenerLockout=false;
  const updated=profileWithTimings(profile,values);assert.equal(updated.motorPaths[0].allowDuringOpenerLockout,true);
  assert.deepEqual(updated.door,profile.door);assert.deepEqual(updated.inputs[0].source,profile.inputs[0].source);
  values.inputs[0].allowDuringOpenerLockout='true';assert.throws(()=>profileWithTimings(profile,values));
});

async function approvalFixture(t, initialPermission) {
  const configuration = structuredClone(example);
  const profile = configuration.controllers[0];
  profile.inputs = profile.inputs.slice(0, 2);
  profile.timing = { idlePollSeconds: 30 };
  for (const row of [...profile.motorPaths, ...profile.inputs]) {
    if (initialPermission !== undefined) row.allowDuringOpenerLockout = initialPermission;
  }
  const hardware = await hardwareFixture(profile);
  configuration.controllers = [hardware.config];
  const storagePath = await mkdtemp(path.join(os.tmpdir(), 'lockout-approval-'));
  await loadIdentity(storagePath);
  const runtimes = [];
  // These tests cover saving an established setup, not aborting a WebSocket
  // handshake. Let the fixture listeners connect before the next rebuild/stop.
  const settled = async runtime => {
    const deadline = Date.now() + 5000;
    while ([...runtime.entries.values()].some(entry => entry.listeners.some(listener => !listener.ready || listener.checking))) {
      assert.ok(Date.now() < deadline, 'fixture input listeners did not become ready');
      await sleep(20);
    }
  };
  const start = async () => {
    const runtime = new CoordinatorRuntime({ storagePath, configuration, credentials: async () => hardware.credentials });
    runtimes.push(runtime); await runtime.start(); await settled(runtime); return runtime;
  };
  t.after(async () => {
    for (const runtime of runtimes) await runtime.stop();
    await hardware.close(); await rm(storagePath, { recursive: true, force: true });
  });
  const runtime = await start(), id = profile.id;
  const approve = async () => {
    await runtime.commission(id, { revision: runtime.state.revision, previousControllerStopped: true, physicalSetupReviewed: true });
    await settled(runtime);
  };
  const draft = () => {
    const value = runtime.settings();
    for (const row of [...value.configuration.controllers[0].motorPaths, ...value.configuration.controllers[0].inputs]) row.allowDuringOpenerLockout = true;
    return value;
  };
  return { runtime, hardware, id, start, approve, draft, settled };
}

for (const initialPermission of [undefined, false]) test(`Homebridge review/apply preserves approval when lockout permissions change from ${initialPermission}`, async t => {
  const f = await approvalFixture(t, initialPermission); await f.approve();
  const edited = f.draft();
  const review = await f.runtime.review(edited.configuration, edited.revision);
  assert.deepEqual(review.requiresCommissioning, [], 'permission-only edits must retain approved device setup');
  await f.runtime.apply(review.token);
  await f.settled(f.runtime);
  assert.equal(f.runtime.status(f.id).configurationValid, true);
  assert.equal(f.runtime.status(f.id).observationEnabled, true);
  assert.equal(f.runtime.status(f.id).actuationEnabled, true);
  assert.equal(f.runtime.entry(f.id).engine.lockoutMotorPaths.has('wall-relay'), true);
  await f.runtime.stop();
  const restarted = await f.start();
  assert.equal(restarted.status(f.id).configurationValid, true);
  assert.equal(restarted.status(f.id).observationEnabled, true);
  assert.equal(restarted.status(f.id).actuationEnabled, true);
  for (const row of [...restarted.entry(f.id).profile.motorPaths, ...restarted.entry(f.id).profile.inputs]) assert.equal(row.allowDuringOpenerLockout, true);
  assert.deepEqual(f.hardware.state.writes, []);
});

test('permission saves retain a disabled controller approval without enabling or operating it', async t => {
  const f = await approvalFixture(t); await f.approve();
  await f.runtime.disable(f.id, { revision: f.runtime.state.revision, bootId: f.runtime.bootId });
  const edited = f.draft(), review = await f.runtime.review(edited.configuration, edited.revision);
  assert.deepEqual(review.requiresCommissioning, []); await f.runtime.apply(review.token);
  assert.equal(f.runtime.status(f.id).configurationValid, true);
  assert.equal(f.runtime.status(f.id).enabled, false);
  assert.equal(f.runtime.status(f.id).observationEnabled, false);
  assert.deepEqual(f.hardware.state.writes, []);
});

test('permission saves cannot restore missing approval or approve a changed door mapping', async t => {
  const f = await approvalFixture(t);
  let edited = f.draft(), review = await f.runtime.review(edited.configuration, edited.revision);
  assert.deepEqual(review.requiresCommissioning, [f.id]); await f.runtime.apply(review.token);
  assert.equal(f.runtime.status(f.id).configurationValid, false);
  await f.approve();
  edited = f.draft(); edited.configuration.controllers[0].door.doorIndex = 1;
  review = await f.runtime.review(edited.configuration, edited.revision);
  assert.deepEqual(review.requiresCommissioning, [f.id]); await f.runtime.apply(review.token);
  assert.equal(f.runtime.status(f.id).enabled, true);
  assert.equal(f.runtime.status(f.id).configurationValid, false);
  assert.equal(f.runtime.status(f.id).observationEnabled, false);
  assert.deepEqual(f.hardware.state.writes, []);
});
