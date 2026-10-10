import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CoordinatorAccessories } from '../src/accessories.js';
import { MovementEngine } from '../src/engine.js';

function fixture(kinds = ['garage', 'bolt']) {
  const values = new Map(); const events = []; const pending = new Map(); const immediates = new Map(); const chars = new Map(); let serial = 0;
  class HapStatusError extends Error {}
  const Characteristic = Object.fromEntries(['CurrentDoorState','TargetDoorState','ObstructionDetected','LockCurrentState','LockTargetState','ContactSensorState','On'].map(key => [key,key]));
  const api = { hap: { Characteristic, HapStatusError, HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402, NOT_ALLOWED_IN_CURRENT_STATE: -70412 } } };
  const status = { actuationEnabled: true, state: {} };
  const entry = { engine: { observedAt: Date.now() }, profile: { timing: { idlePollSeconds: 2 } } };
  const runtime = { status: () => status, entry: () => entry, submit: async () => { throw Error('unexpected hardware command'); } };
  const timers = { setTimeout(fn, ms) { const id = ++serial; pending.set(id, { fn, ms }); return id; }, clearTimeout(id) { pending.delete(id); },
    setImmediate(fn) { const id = ++serial; immediates.set(id, fn); return id; }, clearImmediate(id) { immediates.delete(id); } };
  const accessories = new CoordinatorAccessories(api, {}, runtime, [], timers);
  for (const kind of kinds) {
    const v = { kind, id: 'example', targetGeneration: 0, service: { getCharacteristic(key) {
      if (!chars.has(key)) {
        const c = new EventEmitter();
        Object.defineProperty(c, 'value', { get: () => values.get(key) });
        c.removeOnGet = c.removeOnSet = () => {};
        c.updateValue = value => { values.set(key,value); };
        c.sendEventNotification = value => { values.set(key,value); events.push([key,value]); c.emit('reported',value); };
        chars.set(key,c);
      }
      return chars.get(key);
    } } };
    accessories.active.set(kind, v); accessories.bind(v);
  }
  return { values, events, pending, immediates, accessories, HapStatusError, status, entry, runtime, chars,
    flush() { const callbacks = [...immediates.values()]; immediates.clear(); for (const fn of callbacks) fn(); },
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

for (const autoBolt of [false, true]) test(`external close after completed opening reports Closed with auto-bolt ${autoBolt}`, async () => {
  const f = fixture(); const writes = []; const reports = []; let door = 'closed', locked = true, now = 0;
  const engine = new MovementEngine({
    door: { read: async () => ({ door, blocked: false, obstruction: false, evidence: 'closed-sensor' }),
      write: async command => { writes.push(['door', command]); door = command === 'open' ? 'not-closed' : 'closed'; } },
    bolt: { read: async () => ({ locked, evidence: 'relay' }), write: async value => { writes.push(['bolt', value]); locked = value; } },
    journal: { read: async () => ({ inProgress: false, fault: false }), write: async () => {} },
    clock: { now: () => now, sleep: async ms => { now += ms; } },
    feedback: { opening: 'timed', closing: 'sensor', bolt: 'relay', allowEstimatedBolting: false },
    timing: { pollMs: 10, openingMs: 100, openRetractSettleMs: 0, closedStableMs: 20, boltSettleMs: 20 },
    publish: state => { f.publish(state); reports.push(f.accessories.active.get('garage').report); },
  });
  f.entry.engine = engine;
  await engine.initialize(); await engine.execute('open');
  assert.equal(f.read('CurrentDoorState'), 0); assert.equal(f.read('TargetDoorState'), 0);
  now += 60000; await engine.observe();
  assert.equal(engine.snapshot().openEstimated, true);
  door = 'closed'; writes.length = 0; f.events.length = 0;
  await engine.observe();
  assert.equal(engine.autoClosePending, true); assert.deepEqual(writes, []);
  reports.length = 0;
  if (autoBolt) await engine.execute('observed-close');
  assert.ok(reports.every(report => report.current !== 2 && report.target === 1), 'auto-bolting cannot report Opening or retain Open intent');
  f.publish(engine.snapshot()); // Runtime publishes again after releasing its job.
  assert.equal(f.read('CurrentDoorState'), 1);
  assert.equal(f.read('TargetDoorState'), 1);
  assert.equal(f.read('LockCurrentState'), autoBolt ? 1 : 0);
  assert.equal(engine.snapshot().target, 'closed');
  assert.equal(engine.snapshot().openEstimated, false);
  assert.equal(engine.snapshot().fault, null);
  assert.deepEqual(writes, autoBolt ? [['bolt', true]] : []);
  const before = doorEvents(f).length; f.tick(); f.tick();
  assert.ok(before >= 2, 'the external close must start terminal notifications');
  assert.equal(doorEvents(f).length, before + 4, 'bounded terminal repeats remain enabled');
  assert.ok(doorEvents(f).every(([, value]) => value === 1));
  await engine.observe(); assert.deepEqual(writes, autoBolt ? [['bolt', true]] : []);
  // A new command still owns its target and performs the normal opening sequence.
  writes.length = 0; await engine.execute('open');
  assert.equal(f.read('CurrentDoorState'), 0); assert.equal(f.read('TargetDoorState'), 0);
  assert.deepEqual(writes, autoBolt ? [['bolt', false], ['door', 'open']] : [['door', 'open']]);
});

test('diagnostic on/off preserves notification sequence, final reads and repeats without invoking recording when off', () => {
  function run(recording) {
    const f=fixture(); f.accessories.reporting.setRecording(recording);
    if(!recording)f.accessories.reporting.record=()=>{throw Error('recording must be bypassed');};
    for(const state of [closed,{...open,phase:'opening',busy:true},open,{...open,phase:'closing',target:'closed',busy:true},closed]) {
      f.publish(state); f.tick(); f.tick();
    }
    assert.equal(f.read('CurrentDoorState'),1); assert.equal(f.read('TargetDoorState'),1);
    assert.equal(f.read('LockCurrentState'),1); assert.equal(f.pending.size,0);
    const before=f.events.length; f.accessories.reporting.setRecording(!recording);
    assert.equal(f.events.length,before,'switch must not replay any report');
    return {events:f.events,values:[...f.values]};
  }
  assert.deepEqual(run(false),run(true));
});

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

test('garage and bolt pairs are reaffirmed three times without restarting on unchanged polls', () => {
  const f = fixture(); f.values.set('CurrentDoorState',1); f.values.set('TargetDoorState',1);
  f.publish(closed);
  const pair = [['TargetDoorState',1],['CurrentDoorState',1],['LockCurrentState',1],['LockTargetState',1]];
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
  assert.deepEqual(doorEvents(f),Array(3).fill([['TargetDoorState',0],['CurrentDoorState',0]]).flat());
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
  assert.deepEqual(doorEvents(f).slice(-1),[['CurrentDoorState',1]]); // no fake terminal report
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

test('garage completion matches the owner-verified legacy target-then-current notifications while bolt stays unchanged', () => {
  const f = fixture(); f.publish(open);
  f.publish({ ...open, phase: 'closing', target: 'closed', busy: true });
  f.events.length = 0;
  f.publish(closed); f.tick(); f.tick();
  // Golden terminal sequence: garageDoorController/scripts/update_garage_feedback.py
  // FORCE_BLOCK and notes/feedback-notifications.md (September 20 live acceptance).
  assert.deepEqual(doorEvents(f), Array(3).fill([['TargetDoorState',1],['CurrentDoorState',1]]).flat());
  // The independently working bolt retains its current/target report contract.
  assert.deepEqual(boltEvents(f), Array(3).fill([['LockCurrentState',1],['LockTargetState',1]]).flat());
  assert.equal(f.read('TargetDoorState'),1);
});

test('deferred experiment yields only garage publication, commits GETs immediately and preserves terminal order and repeats', () => {
  const f=fixture(); f.publish(open); f.events.length=0;
  const before=[...f.values];
  f.accessories.setReportingExperiment('off','deferred');
  assert.deepEqual([...f.values],before); assert.deepEqual(f.events,[]);
  f.accessories.reporting.record=()=>{throw Error('diagnostics must stay off');};
  f.publish(closed);
  assert.equal(f.values.get('CurrentDoorState'),0,'garage cache has not been published yet');
  assert.equal(f.values.get('LockCurrentState'),1,'bolt remains immediate');
  assert.equal(f.read('CurrentDoorState'),1,'GET returns the committed latest report synchronously');
  assert.equal(f.immediates.size,1); assert.deepEqual(doorEvents(f),[]);
  f.publish(closed); // identical poll must not discard the pending forced notification
  assert.equal(f.immediates.size,1);
  f.flush(); f.tick(); f.flush(); f.tick(); f.flush();
  assert.deepEqual(doorEvents(f),Array(3).fill([['TargetDoorState',1],['CurrentDoorState',1]]).flat());
  assert.deepEqual(boltEvents(f),Array(3).fill([['LockCurrentState',1],['LockTargetState',1]]).flat());
  assert.equal(f.pending.size,0); assert.equal(f.immediates.size,0);
});

test('deferred publisher drops superseded terminal intent and coalesces to the latest complete report', () => {
  const f=fixture(); f.publish(open); f.events.length=0;
  f.accessories.setReportingExperiment('off','deferred');
  f.publish(closed);
  f.publish({...closed,phase:'opening',target:'open',bolt:'unlocked',busy:true});
  f.flush();
  assert.deepEqual(doorEvents(f),[],'obsolete forced Closed pair must not be emitted');
  assert.equal(f.values.get('CurrentDoorState'),2); assert.equal(f.values.get('TargetDoorState'),0);
  f.publish(closed); f.publish(open); f.flush();
  assert.deepEqual(doorEvents(f),[['TargetDoorState',0],['CurrentDoorState',0]]);
});

test('deferred queue rejects changing modes while pending and cannot report after stop, removal or replacement', () => {
  for(const change of [f=>f.accessories.stop(), f=>f.accessories.active.delete('garage'),
    f=>f.accessories.active.set('garage',{...f.accessories.active.get('garage')})]) {
    const f=fixture(); f.publish(open); f.events.length=0;
    f.accessories.setReportingExperiment('off','deferred'); f.publish(closed);
    assert.throws(()=>f.accessories.setReportingExperiment('full','inline'),/reporting_publication_pending/);
    const callbacks=[...f.immediates.values()]; change(f);
    for(const fn of callbacks)fn(); // even a previously captured/cancelled callback must be harmless
    assert.deepEqual(doorEvents(f),[]);
  }
});

test('deferred queue rechecks faults, holds, freshness and live direction before publishing', () => {
  for(const change of [f=>{f.status.actuationEnabled=false;}, f=>{f.status.state.fault='feedback_lost';},
    f=>{f.status.state.unavailable='door_read_failed';}, f=>{f.accessories.active.get('garage').report.observedAt=Date.now()-60000;},
    f=>{f.runtime.entry=()=>{throw Error('controller_removed');};}]) {
    const f=fixture(); f.publish(open); f.events.length=0;
    f.accessories.setReportingExperiment('off','deferred'); f.publish(closed); change(f); f.flush();
    assert.deepEqual(doorEvents(f),[]);
    assert.ok(f.values.get('CurrentDoorState') instanceof f.HapStatusError);
    assert.equal(f.accessories.active.get('garage').notificationTimer,null);
  }
  const f=fixture(); f.publish(open); f.events.length=0;
  f.accessories.setReportingExperiment('off','deferred'); f.publish(closed);
  f.status.state={...open}; f.flush(); assert.deepEqual(doorEvents(f),[]);
  f.publish(closed); f.publish({...closed,fault:'feedback_lost'});
  assert.equal(f.immediates.size,0,'errors cancel pending success and publish immediately');
  assert.ok(f.values.get('CurrentDoorState') instanceof f.HapStatusError);
});

test('experiment validation and restoration neither replay notifications nor reset bindings', () => {
  const f=fixture(); f.publish(closed); const before=f.events.length;
  assert.throws(()=>f.accessories.setReportingExperiment('unknown','deferred'),/invalid_reporting_experiment/);
  assert.equal(f.accessories.reporting.traceMode,'off'); assert.equal(f.accessories.publicationMode,'inline');
  f.accessories.setReportingExperiment('events','inline');
  const revision=f.accessories.reporting.recordingRevision;
  f.accessories.setReportingExperiment('events','inline'); assert.equal(f.accessories.reporting.recordingRevision,revision);
  f.accessories.setReportingExperiment('off','deferred');
  f.accessories.setReportingExperiment('full','inline');
  assert.equal(f.accessories.publicationRevision,2); assert.equal(f.events.length,before);
  assert.equal(f.chars.get('TargetDoorState').listenerCount('set'),1);
});

test('startup bypasses diagnostic hooks through complete garage cycles and reads', () => {
  const f=fixture();
  assert.equal(f.accessories.reporting.recording,false);
  assert.equal(f.accessories.reporting.traceMode,'off');
  let calls=0;f.accessories.reporting.record=()=>{calls++;};
  f.accessories.reporting.subscribers=()=>{calls++;};
  for(const state of [closed,{...closed,phase:'opening',target:'open',busy:true},open,{...open,phase:'closing',target:'closed',busy:true},closed]) {
    f.publish(state);f.tick();f.tick();f.read('CurrentDoorState');f.read('LockCurrentState');
  }
  assert.equal(calls,0);assert.equal(f.read('CurrentDoorState'),1);
  assert.deepEqual(f.accessories.reporting.events,[]);
  f.accessories.reporting.setRecording(true);f.read('CurrentDoorState');assert.ok(calls>0);
});

test('fresh confirmed Closed remains visible while control is held; uncertain fault stays unavailable', () => {
  const f = fixture(); f.status.actuationEnabled = false; f.status.observationEnabled = true;
  f.publish({ ...closed, fault: 'door_blocked', lockout: true, closedObservedDuringFault: true });
  assert.equal(f.read('CurrentDoorState'), 1); assert.equal(f.read('TargetDoorState'), 1);
  assert.equal(f.read('ObstructionDetected'), false);
  f.publish({ ...closed, phase: 'fault', door: 'not-closed', fault: 'door_close_timeout', closedObservedDuringFault: false });
  assert.throws(() => f.read('CurrentDoorState'));
  f.status.observationEnabled = false;
  f.publish({ ...closed, fault: 'door_blocked', closedObservedDuringFault: true });
  assert.throws(() => f.read('CurrentDoorState'));
});

test('lockout contact is active only for explicit lockout; restart switch is momentary and OFF is inert', async () => {
  const f = fixture(['garage', 'lockout', 'restart']);
  f.status.actuationEnabled = false; f.status.observationEnabled = true;
  f.publish({ phase: 'fault', door: 'not-closed', fault: 'door_blocked', lockout: true });
  assert.equal(f.read('ContactSensorState'), 1); assert.throws(() => f.read('CurrentDoorState'));
  f.publish({ phase: 'fault', fault: 'door_blocked', lockout: false, disabled: true });
  assert.equal(f.read('ContactSensorState'), 0);
  f.publish({ phase: 'fault', fault: 'door_blocked', lockout: null });
  assert.throws(() => f.read('ContactSensorState'));
  let restarts = 0; f.runtime.restartTailwind = async (_id, _body, source) => { assert.equal(source, 'homekit'); restarts++; };
  await f.set('On', false); f.flush(); assert.equal(restarts, 0);
  await f.set('On', true); f.values.set('On', true); f.flush();
  assert.equal(restarts, 1); assert.equal(f.values.get('On'), false); assert.equal(f.read('On'), false);
  f.runtime.restartTailwind = async () => { throw Error('held'); };
  await assert.rejects(f.set('On', true)); f.flush(); assert.equal(f.values.get('On'), false);
});
