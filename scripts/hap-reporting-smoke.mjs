// Actual HAP contract checks; loaded from the isolated Homebridge CI install.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CoordinatorAccessories } from '../src/accessories.js';

export async function verifyHapReporting() {
  const require = createRequire(process.env.HOMEBRIDGE_BIN);
  const hap = await import(pathToFileURL(require.resolve('@homebridge/hap-nodejs')).href);
  const C = hap.Characteristic;
  // Reproduce the former GET race: even a non-Promise onGet return yields in
  // HAP, so a report delivered before read completion can be overwritten.
  for (const [Type, previous, final] of [[C.CurrentDoorState,3,1],[C.LockCurrentState,0,1]]) {
    const old = new Type(); old.onGet(() => previous);
    const read = old.handleGetRequest(); old.sendEventNotification(final); await read;
    assert.equal(old.value,previous,'Baseline must reproduce the late read overwrite');
  }
  const state = { phase:'closed',door:'closed',bolt:'locked',target:'closed',busy:false };
  const status = { actuationEnabled:true,state };
  const profile = { id:'synthetic',name:'Synthetic garage',exposeBoltLock:true,timing:{idlePollSeconds:2} };
  const runtime = { configuration:{controllers:[profile]},entry:()=>({engine:{observedAt:Date.now()},profile}),status:()=>status,
    submit:async()=>{throw Error('Unexpected command');} };
  const registered = [];
  const api = { hap,platformAccessory:hap.Accessory,registerPlatformAccessories:(_plugin,_platform,list)=>registered.push(...list),
    updatePlatformAccessories:()=>{},unregisterPlatformAccessories:()=>{} };
  const publisher = new CoordinatorAccessories(api,{instanceId:'synthetic'},runtime,[],{setTimeout:()=>1,clearTimeout:()=>{}});
  publisher.sync(); assert.equal(registered.length,2); publisher.sync(); assert.equal(registered.length,2);
  const garage = [...publisher.active.values()].find(v=>v.kind==='garage');
  const bolt = [...publisher.active.values()].find(v=>v.kind==='bolt');
  const current = garage.service.getCharacteristic(C.CurrentDoorState);
  const target = garage.service.getCharacteristic(C.TargetDoorState);
  const lock = bolt.service.getCharacteristic(C.LockCurrentState);
  const report = patch => { Object.assign(state,patch); publisher.update(profile.id,structuredClone(state)); };
  assert.equal(current.listenerCount('get'),1); assert.equal(target.listenerCount('set'),1);
  assert.equal(await current.handleGetRequest(),1,'Sync initializes the terminal snapshot');
  report({phase:'closing',bolt:'unlocked',busy:true});
  const changes = []; current.on('change',change=>changes.push(change.newValue));
  const doorRead = current.handleGetRequest(); const boltRead = lock.handleGetRequest();
  report({phase:'closed',bolt:'locked',busy:false});
  assert.equal(await doorRead,3); assert.equal(await boltRead,0); // Reads began before the report.
  assert.equal(current.value,1,'Earlier GET must not roll back the newer Closed report');
  assert.equal(lock.value,1,'Earlier GET must not roll back the newer Locked report');
  assert.equal(changes.at(-1),1); assert.equal(await current.handleGetRequest(),1);
  let acknowledge;
  runtime.submit = () => new Promise(resolve=>{acknowledge=resolve;});
  const set = target.handleSetRequest(0);
  report({phase:'open',target:'open',bolt:'unlocked'});
  report({phase:'closed',target:'closed',bolt:'locked'});
  acknowledge({accepted:true});
  await assert.rejects(set,error=>error===hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
  assert.equal(target.value,1,'Late SET must not replace newer target feedback');
  report({phase:'closed'}); assert.equal(await target.handleGetRequest(),1);
  report({phase:'open',target:'open',bolt:'unlocked'});
  report({phase:'closing',target:'closed',busy:true});
  const completion=[];
  target.on('change',change=>completion.push(['target',change.newValue]));
  current.on('change',change=>completion.push(['current',change.newValue]));
  report({phase:'closed',bolt:'locked',busy:false});
  assert.deepEqual(completion,[['target',1],['current',1]],'Match the legacy terminal notification order using actual HAP');
  assert.equal(current.value,1); assert.equal(target.value,1);
  publisher.setReportingExperiment('off','deferred');
  report({phase:'closing',bolt:'unlocked',busy:true});
  await new Promise(setImmediate);
  assert.equal(current.value,3); assert.equal(lock.value,0);
  const deferredRead=current.handleGetRequest();
  completion.length=0;
  report({phase:'closed',bolt:'locked',busy:false});
  assert.equal(current.value,3,'Garage publication must yield');
  assert.equal(lock.value,1,'Bolt publication must remain inline');
  assert.equal(await deferredRead,3);
  await new Promise(setImmediate);
  assert.deepEqual(completion,[['target',1],['current',1]]);
  assert.equal(current.value,1,'Old GET cannot overwrite deferred completion');
  // Queued close is superseded by a new opening before the next event-loop turn.
  report({phase:'open',target:'open',bolt:'unlocked'}); await new Promise(setImmediate);
  completion.length=0;
  report({phase:'closed',target:'closed',bolt:'locked'});
  report({phase:'opening',target:'open',bolt:'unlocked',busy:true});
  await new Promise(setImmediate);
  assert.equal(current.value,2); assert.equal(target.value,0);
  assert.ok(!completion.some(([,value])=>value===1),'No obsolete Closed notification');
  report({phase:'closed',target:'closed',bolt:'locked',busy:false});
  publisher.sync(); // Rebinding cancels the pending callback; startup seeds inline.
  const count=completion.length; await new Promise(setImmediate);
  assert.equal(completion.length,count); assert.equal(current.value,1);
  publisher.setReportingExperiment('full','inline');
  publisher.stop();
  console.log('Actual HAP passes synchronous GET/cache protection, legacy terminal order, superseded SET, deferred garage publication, inline bolt updates, reversal coalescing and rebind cancellation.');
}
