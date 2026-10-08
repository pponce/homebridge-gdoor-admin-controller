import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CoordinatorRuntime } from '../src/runtime.js';
import { loadIdentity } from '../src/storage.js';
import { StateJournal } from '../src/journal.js';
import { Fault } from '../src/fault.js';
import { retryableRead } from '../src/controller-faults.js';

const example = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
  const storagePath = await mkdtemp(path.join(os.tmpdir(), 'coordinator-reboot-'));
  await loadIdentity(storagePath);
  const config = structuredClone(example), id = config.controllers[0].id;
  config.controllers[0].timing = { idlePollSeconds: 30, openRetractSettleSeconds: 0, closeRetractSettleSeconds: 0 };
  config.controllers[0].feedback.boltSettleSeconds = config.controllers[0].feedback.closedStableSeconds = 0;
  const model = { door: 'closed', locked: true, blocked: false, error: null, reads: 0, writes: [], motorActive: false };
  const drivers = async () => ({
    door: {
      read: async () => { model.reads++; await model.pause?.(); if (model.error) throw new Fault(model.error);
        return { door: model.door, blocked: model.blocked, obstruction: false, evidence: 'closed-sensor' }; },
      write: async command => { model.writes.push(['door', command]); model.door = command === 'close' ? 'closed' : 'not-closed'; model.onDoorWrite?.(); },
    },
    bolt: { read: async () => ({ locked: model.locked, evidence: 'relay' }),
      write: async value => { model.writes.push(['bolt', value]); model.locked = value; } },
    motorPaths: { secondary: { verifyIdle: async () => { if (model.motorActive) throw new Fault('motor_relay_active_requires_review'); } } },
    inputDrivers: new Map(),
  });
  const runtimes = [];
  const create = async () => { const runtime = new CoordinatorRuntime({ storagePath, configuration: config, drivers });
    runtimes.push(runtime); await runtime.start(); return runtime; };
  t.after(async () => { model.release?.(); for (const runtime of runtimes) await runtime.stop(); await rm(storagePath, { recursive: true, force: true }); });
  const first = await create();
  await first.commission(id, { revision: first.state.revision, previousControllerStopped: true, physicalSetupReviewed: true });
  const journal = new StateJournal(storagePath, id);
  const command = (runtime, name = 'open') => ({ command: name, requestId: randomUUID(), bootId: runtime.bootId, issuedAt: Date.now() });
  return { first, create, journal, model, id, storagePath, command };
}
async function runTimer(t, runtime, id, milliseconds) {
  t.mock.timers.tick(milliseconds);
  // The async callback includes real journal I/O, so await its concrete task.
  await runtime.entry(id).initializing;
  await runtime.entry(id).engine.observation;
  await tick();
}

test('repeated restarts retain enablement for closed, open, opening, closing and not-closed feedback without writes', async t => {
  const f = await fixture(t); let runtime = f.first;
  for (const door of ['closed', 'open', 'opening', 'closing', 'not-closed']) {
    await runtime.stop(); f.model.door = door; f.model.locked = door === 'closed'; runtime = await f.create();
    const s = runtime.status(f.id);
    assert.equal(s.commissioned, true, door); assert.equal(s.actuationEnabled, true, door);
    assert.equal(s.state.fault, null, door); assert.equal(s.state.door, door);
    assert.equal(s.state.openEstimated, false); assert.equal(s.state.closeEstimated, false);
    assert.deepEqual(f.model.writes, []);
  }
});

for (const reason of ['door_read_failed', 'bolt_read_failed', 'bolt_unreachable', 'motor_read_failed', 'motor_unreachable',
  'homebridge_read_failed', 'homebridge_state_unavailable', 'homebridge_service_unavailable']) {
  test('startup retries ' + reason + ' through a five-minute delay and another reboot without latching or writing', async t => {
    const f = await fixture(t); await f.first.stop(); f.model.error = reason;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const runtime = await f.create();
    assert.equal(runtime.status(f.id).held, 'waiting-for-devices');
    assert.equal(runtime.status(f.id).state.fault, null);
    await assert.rejects(runtime.submit(f.id, f.command(runtime)), /controller_held/);
    for (let n = 0; n < 60; n++) await runTimer(t, runtime, f.id, 5000);
    assert.equal(runtime.status(f.id).commissioned, true);
    assert.deepEqual(await f.journal.read(), { inProgress: false, fault: false });
    await runtime.stop(); const next = await f.create();
    assert.equal(next.status(f.id).held, 'waiting-for-devices');
    f.model.error = null; await runTimer(t, next, f.id, 5000);
    assert.equal(next.status(f.id).actuationEnabled, true); assert.equal(next.status(f.id).held, null);
    assert.equal(next.status(f.id).state.unavailable, null); assert.equal(next.status(f.id).state.phase, 'closed');
    assert.deepEqual(f.model.writes, []);
  });
}

test('stopping during a startup read leaves no fault and no late listener or retry', async t => {
  const f = await fixture(t); await f.first.stop(); f.model.error = 'door_read_failed';
  const runtime = await f.create();
  let started; const reading = new Promise(resolve => { started = resolve; });
  f.model.pause = () => new Promise(resolve => { f.model.release = resolve; started(); });
  const pending = runtime.initializeEntry(runtime.entry(f.id));
  await reading; const stopped = runtime.stop(); f.model.release(); await pending; await stopped;
  assert.equal(runtime.entry(f.id).enabled, false); assert.equal(runtime.entry(f.id).listeners.length, 0);
  assert.deepEqual(await f.journal.read(), { inProgress: false, fault: false });
  f.model.pause = null; f.model.error = null;
  assert.equal((await f.create()).status(f.id).actuationEnabled, true); assert.deepEqual(f.model.writes, []);
});

test('stopping during an idle read does not turn a normal reboot into a durable operation fault', async t => {
  const f = await fixture(t);
  f.model.pause = () => new Promise(resolve => { f.model.release = resolve; });
  const observed = f.first.entry(f.id).engine.observe(); await tick();
  const stopped = f.first.stop(); f.model.release(); await observed; await stopped;
  assert.deepEqual(await f.journal.read(), { inProgress: false, fault: false });
  f.model.pause = null;
  const next = await f.create(); assert.equal(next.status(f.id).actuationEnabled, true);
  assert.deepEqual(f.model.writes, []);
});

test('legacy faults require one recovery; new safety faults retain their original reason and time across reboots', async t => {
  const f = await fixture(t); await f.first.stop();
  await f.journal.write({ inProgress: false, fault: true });
  let next = await f.create(); assert.equal(next.status(f.id).state.fault, 'previous_run_requires_review');
  await next.commission(f.id, { revision: next.state.revision, previousControllerStopped: true, physicalSetupReviewed: true, recover: true });
  await next.stop(); f.model.error = 'bolt_resource_identity_mismatch';
  next = await f.create(); const fault = next.status(f.id).state;
  assert.equal(fault.fault, 'bolt_resource_identity_mismatch'); assert.ok(fault.faultAt);
  await next.stop(); f.model.error = null; const reads = f.model.reads;
  next = await f.create(); assert.equal(next.status(f.id).state.fault, fault.fault);
  assert.equal(next.status(f.id).state.faultAt, fault.faultAt); assert.equal(f.model.reads, reads);
  assert.deepEqual(f.model.writes, []);
});

test('physical conflicts and invalid responses are never retried as startup connectivity failures', async t => {
  const f = await fixture(t); await f.first.stop();
  for (const error of ['bolt_resource_identity_mismatch', 'homebridge_service_identity_mismatch', 'door_response_invalid',
    'motor_relay_active_requires_review', 'door_blocked', 'obstruction', 'unknown_state', 'door_write_ambiguous']) {
    await f.journal.write({ inProgress: false, fault: false }); f.model.error = error;
    const runtime = await f.create(); assert.equal(runtime.status(f.id).state.fault, error);
    assert.equal(runtime.entry(f.id).engine.startupRetry, false); assert.equal(runtime.status(f.id).actuationEnabled, false);
    await runtime.stop(); assert.equal(retryableRead(error), false);
  }
  assert.deepEqual(f.model.writes, []);
});

test('pending commands retain enablement and resume observation without replay; fresh endpoints restore command readiness', async t => {
  const f = await fixture(t); await f.first.stop();
  const saved = await f.first.store.read(); saved.requests.push({ ...f.command(f.first), controllerId: f.id, status: 'pending' });
  await f.first.store.write(saved); await f.journal.write({ inProgress: true, fault: false });
  f.model.door = 'closing'; f.model.locked = false;
  const next = await f.create();
  assert.equal(next.state.requests.at(-1).status, 'unknown'); assert.equal(next.status(f.id).commissioned, true);
  assert.equal(next.status(f.id).actuationEnabled, true); assert.equal(next.status(f.id).state.reconciling, true);
  await assert.rejects(next.submit(f.id, f.command(next)), /observing_movement/);
  assert.deepEqual(f.model.writes, []);
  f.model.door = 'closed'; await next.entry(f.id).engine.observe();
  assert.equal(next.status(f.id).state.reconciling, false); assert.equal(next.status(f.id).state.phase, 'closed');
  assert.equal(next.entry(f.id).engine.autoClosePending, false);
  assert.deepEqual(await f.journal.read(), { inProgress: false, fault: false }); assert.deepEqual(f.model.writes, []);
});

test('Tailwind not-closed after interrupted travel remains enabled without inventing an open estimate or issuing commands', async t => {
  const f = await fixture(t); await f.first.stop(); await f.journal.write({ inProgress: true, fault: false });
  f.model.door = 'not-closed'; f.model.locked = false;
  const next = await f.create(); await next.entry(f.id).engine.observe();
  assert.equal(next.status(f.id).actuationEnabled, true); assert.equal(next.status(f.id).state.phase, 'position-unknown');
  assert.equal(next.status(f.id).state.openEstimated, false); assert.equal(next.status(f.id).state.fault, null);
  assert.deepEqual(f.model.writes, []);
});

test('disabled garages remain disabled during retries and restart', async t => {
  const f = await fixture(t); await f.first.stop(); f.model.error = 'bolt_unreachable';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const next = await f.create();
  await next.disable(f.id, { revision: next.state.revision, bootId: next.bootId }); const reads = f.model.reads;
  f.model.error = null; t.mock.timers.tick(60000); await tick(); assert.equal(f.model.reads, reads);
  await next.stop(); const disabled = await f.create(); assert.equal(disabled.status(f.id).commissioned, false);
  assert.equal(disabled.status(f.id).actuationEnabled, false); assert.deepEqual(f.model.writes, []);
});

test('graceful shutdown during commanded travel preserves enablement and never replays the accepted command', async t => {
  const f = await fixture(t); f.model.locked = false;
  let moving; const moved = new Promise(resolve => { moving = resolve; }); f.model.onDoorWrite = moving;
  await f.first.submit(f.id, f.command(f.first)); await moved; await f.first.stop();
  const writes = structuredClone(f.model.writes); assert.deepEqual(writes, [['door', 'open']]);
  assert.deepEqual(await f.journal.read(), { inProgress: true, fault: false });
  const next = await f.create(); assert.equal(next.status(f.id).commissioned, true);
  assert.equal(next.status(f.id).actuationEnabled, true); assert.equal(next.status(f.id).state.reconciling, true);
  f.model.door = 'open'; await next.entry(f.id).engine.observe();
  assert.equal(next.status(f.id).state.reconciling, false); assert.deepEqual(f.model.writes, writes);
});

test('an upstream read disconnect during active-command shutdown preserves interrupted intent without a new fault', async t => {
  const f=await fixture(t);let began;const reading=new Promise(resolve=>{began=resolve;});
  f.model.pause=()=>new Promise(resolve=>{f.model.release=resolve;began();});
  await f.first.submit(f.id,f.command(f.first));await reading;
  f.model.error='door_read_failed';const stopping=f.first.stop();f.model.release();await stopping;
  assert.deepEqual(await f.journal.read(),{inProgress:true,fault:false});assert.deepEqual(f.model.writes,[]);
  f.model.pause=null;f.model.error=null;const next=await f.create();
  assert.equal(next.status(f.id).actuationEnabled,true);assert.equal(next.status(f.id).state.fault,null);
});

test('maintenance cancels a pending startup retry and remains paused through restart', async t => {
  const f = await fixture(t); await f.first.stop(); f.model.error = 'bolt_unreachable';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const next = await f.create(); await next.maintenance('pause', 'restart-test'); const reads = f.model.reads;
  f.model.error = null; t.mock.timers.tick(60000); await tick(); assert.equal(f.model.reads, reads);
  await next.stop(); const paused = await f.create(); assert.equal(paused.status(f.id).held, 'maintenance');
  assert.equal(paused.status(f.id).actuationEnabled, false); assert.deepEqual(f.model.writes, []);
});

test('malformed journal is held rather than silently reset by read recovery', async t => {
  const f = await fixture(t); await f.first.stop();
  await writeFile(path.join(f.storagePath, 'gdoorandbolt-coordinator', f.id + '.state.json'), '{bad', { mode: 0o600 });
  const next = await f.create(); assert.equal(next.status(f.id).actuationEnabled, false);
  assert.equal(next.status(f.id).state.fault, 'journal_invalid'); assert.deepEqual(f.model.writes, []);
});
