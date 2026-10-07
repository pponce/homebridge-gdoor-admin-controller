import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CoordinatorAccessories } from '../src/accessories.js';

function fixture() {
  const values = new Map(); const events = []; const pending = new Map(); const chars = new Map(); let serial = 0;
  class HapStatusError extends Error {}
  const Characteristic = Object.fromEntries(['CurrentDoorState','TargetDoorState','ObstructionDetected','LockCurrentState','LockTargetState'].map(key => [key,key]));
  const api = { hap: { Characteristic, HapStatusError, HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402, NOT_ALLOWED_IN_CURRENT_STATE: -70412 } } };
  const status = { actuationEnabled: true, state: {} };
  const entry = { engine: { observedAt: Date.now() }, profile: { timing: { idlePollSeconds: 2 } } };
  const runtime = { status: () => status, entry: () => entry, submit: async () => { throw Error('unexpected hardware command'); } };
  const timers = { setTimeout(fn, ms) { const id = ++serial; pending.set(id, { fn, ms }); return id; }, clearTimeout(id) { pending.delete(id); } };
  const accessories = new CoordinatorAccessories(api, {}, runtime, [], timers);
  for (const kind of ['garage','bolt']) {
    const v = { kind, id: 'example', targetGeneration: 0, service: { getCharacteristic(key) {
      if (!chars.has(key)) {
        const c = new EventEmitter();
        c.removeOnGet = c.removeOnSet = () => {};
        c.updateValue = value => { values.set(key,value); };
        c.sendEventNotification = value => { values.set(key,value); events.push([key,value]); c.emit('reported',value); };
        chars.set(key,c);
      }
      return chars.get(key);
    } } };
    accessories.active.set(kind, v); accessories.bind(v);
  }
  return { values, events, pending, accessories, HapStatusError, status, entry, runtime, chars,
    publish(state) { status.state = structuredClone(state); accessories.update('example', status.state); },
    read(field) { let result; let failure; chars.get(field).emit('get', (error,value) => { failure = error; result = value; }); if (failure) throw failure; return result; },
    set(field, value) { return new Promise((resolve,reject) => chars.get(field).emit('set', value, error => error ? reject(error) : resolve())); },
    tick() { const callbacks = [...pending.values()]; pending.clear(); for (const {fn,ms} of callbacks) { assert.equal(ms,2000); fn(); } }
  };
}
const closed = { phase: 'closed', door: 'closed', bolt: 'locked', target: 'closed', busy: false, fault: null };
const open = { phase: 'open', door: 'not-closed', bolt: 'unlocked', target: 'open', openEstimated: true, busy: false };
const doorEvents = f => f.events.filter(([field]) => field.includes('Door'));
const boltEvents = f => f.events.filter(([field]) => field.startsWith('Lock'));

test('physical close publishes preparation and completion as coherent pairs committed for both tiles', () => {
  const f = fixture(); f.publish(open);
  f.publish({ ...open, target: 'closed', busy: true });
  assert.equal(f.read('CurrentDoorState'),3); assert.equal(f.read('TargetDoorState'),1);
  f.publish({ ...open, phase: 'closing', target: 'closed', busy: true });
  const reads = [];
  f.chars.get('CurrentDoorState').on('reported', () => reads.push(['TargetDoorState','LockCurrentState','LockTargetState'].map(key => f.read(key))));
  f.publish(closed);
  assert.deepEqual(reads,[[1,1,1]]);
  assert.equal(f.read('CurrentDoorState'),1);
  assert.equal(f.values.get('CurrentDoorState'),1);
});

test('getters return the committed report until a new report is published; expired and held reports fail', () => {
  const f = fixture(); f.publish(closed);
  f.status.state = { ...open };
  assert.equal(f.read('CurrentDoorState'),1); assert.equal(f.read('LockCurrentState'),1);
  f.publish(open); assert.equal(f.read('CurrentDoorState'),0); assert.equal(f.read('LockCurrentState'),0);
  // A newer runtime timestamp must not make an old published snapshot fresh.
  f.accessories.active.get('garage').report.observedAt = Date.now() - 60000;
  f.entry.engine.observedAt = Date.now(); assert.throws(() => f.read('CurrentDoorState'),f.HapStatusError);
  f.status.actuationEnabled = false; assert.throws(() => f.read('LockCurrentState'),f.HapStatusError);
});

test('both tiles explicitly report current then target three times, without restarting on unchanged polls', () => {
  const f = fixture(); f.values.set('CurrentDoorState',1); f.values.set('TargetDoorState',1);
  f.publish(closed);
  const pair = [['CurrentDoorState',1],['TargetDoorState',1],['LockCurrentState',1],['LockTargetState',1]];
  assert.deepEqual(f.events,pair);
  f.publish(closed); assert.equal(f.events.length,4); assert.equal(f.pending.size,2);
  f.tick(); f.tick(); assert.deepEqual(f.events,[...pair,...pair,...pair]); assert.equal(f.pending.size,0);
  for (let i = 0; i < 10; i++) f.publish(closed);
  assert.equal(f.events.length,12); assert.equal(f.pending.size,0);
});

test('bolt notifications follow retraction during movement and a later external unlock', () => {
  const f = fixture(); f.publish(closed); f.events.length = 0;
  f.publish({ ...closed, phase: 'unbolting', target: 'open', bolt: 'unlocked', busy: true });
  f.tick(); f.tick();
  assert.deepEqual(boltEvents(f), Array(3).fill([['LockCurrentState',0],['LockTargetState',0]]).flat());
  f.publish(closed); f.publish({ ...closed, bolt: 'unlocked' });
  assert.equal(f.read('LockCurrentState'),0); assert.equal(f.read('LockTargetState'),0);
  f.tick(); assert.equal(boltEvents(f).at(-1)[1],0);
});

test('new direction cancels old terminal garage reports and bolt change cancels old lock reports', () => {
  const f = fixture(); f.publish(closed); f.events.length = 0;
  f.publish({ ...closed, target: 'open', busy: true }); f.tick(); assert.deepEqual(doorEvents(f),[]);
  f.publish({ ...open, phase: 'opening', busy: true }); f.events.length = 0;
  f.publish(open); f.tick(); f.tick();
  assert.deepEqual(doorEvents(f),Array(3).fill([['CurrentDoorState',0],['TargetDoorState',0]]).flat());
  assert.ok(boltEvents(f).every(([,value]) => value === 0));
});

test('scheduled reports stop for faults, unavailable state, stale observations, removed profiles and shutdown', () => {
  for (const change of [
    f => { f.status.actuationEnabled = false; },
    f => { f.status.state.fault = 'closed_confirmation_lost'; },
    f => { f.status.state.unavailable = 'door_read_failed'; },
    f => { f.entry.engine.observedAt = Date.now() - 60000; },
    f => { f.accessories.stop(); },
    f => { f.runtime.entry = () => { throw Error('controller_not_found'); }; }
  ]) {
    const f = fixture(); f.publish(closed); change(f); f.tick();
    assert.equal(f.events.length,4); assert.equal(f.pending.size,0);
  }
});

test('garage reaffirmation checks worker ownership and bolt reaffirmation checks the latest live observation', () => {
  const f = fixture(); f.publish(closed);
  f.status.state.busy = true; f.status.state.bolt = 'unlocked'; f.tick();
  assert.equal(f.events.length,4); assert.equal(f.pending.size,0);
});

test('startup open with no previous command has matching target/current; read failures recover every field', () => {
  const f = fixture(); f.publish({ ...open, target: null });
  assert.equal(f.read('CurrentDoorState'),0); assert.equal(f.read('TargetDoorState'),0);
  f.publish({ ...open, phase: 'unavailable', unavailable: 'door_read_failed' });
  for (const field of f.chars.keys()) assert.throws(() => f.read(field),f.HapStatusError);
  f.publish(closed);
  for (const field of ['CurrentDoorState','TargetDoorState','LockCurrentState','LockTargetState']) assert.equal(f.read(field),1);
});

test('SET acknowledges queued intent promptly and subsequent physical feedback owns current state', async () => {
  const f = fixture(); f.publish(closed); const calls = [];
  f.runtime.submit = async (id, request, source) => { calls.push([id,request.command,source]); return {accepted:true}; };
  await f.set('TargetDoorState',0);
  assert.deepEqual(calls,[['example','open','homekit']]);
  assert.equal(f.read('TargetDoorState'),0); assert.equal(f.read('CurrentDoorState'),2);
  assert.deepEqual(doorEvents(f).slice(-2),[['CurrentDoorState',1],['TargetDoorState',1]]); // no fake terminal report
  f.publish(open); assert.equal(f.read('CurrentDoorState'),0);
  f.tick(); f.tick(); assert.equal(calls.length,1);
});

test('late SET cannot overwrite a newer opposite target, but matching newer feedback still succeeds', async () => {
  for (const superseded of [false,true]) {
    const f = fixture(); f.publish(closed); let acknowledge;
    f.runtime.submit = () => new Promise(resolve => { acknowledge = resolve; });
    const pending = f.set('TargetDoorState',0);
    f.publish(open); if (superseded) f.publish(closed);
    acknowledge({ accepted: true });
    if (superseded) await assert.rejects(pending,f.HapStatusError); else await pending;
    assert.equal(f.read('TargetDoorState'),superseded ? 1 : 0);
  }
});

test('rejected or obsolete SET leaves reported values intact and repeated binding does not duplicate commands', async () => {
  const f = fixture(); f.publish(closed); const v = f.accessories.active.get('garage');
  f.accessories.bind(v); f.accessories.bind(v);
  assert.equal(f.chars.get('CurrentDoorState').listenerCount('get'),1);
  assert.equal(f.chars.get('TargetDoorState').listenerCount('set'),1);
  await assert.rejects(f.set('TargetDoorState',0),f.HapStatusError); assert.equal(f.read('TargetDoorState'),1);
  let acknowledge; f.runtime.submit = () => new Promise(resolve => { acknowledge = resolve; });
  const pending = f.set('TargetDoorState',0); f.accessories.active.delete('garage'); acknowledge({accepted:true});
  await assert.rejects(pending,f.HapStatusError); assert.equal(v.report.target,1);
});
