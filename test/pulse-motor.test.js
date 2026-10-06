import test from 'node:test';
import assert from 'node:assert/strict';
import { PulseMotor, DeconzMotorRelay } from '../src/pulse-motor.js';
import { MovementEngine } from '../src/engine.js';
import { Fault } from '../src/fault.js';
import { readFile } from 'node:fs/promises';
import { hardwareFixture } from './support/hardware.mjs';

function fixture(options = {}) {
  const state = { active: false, writes: [], now: 0, ...options.state };
  const relay = { capabilities: { inactiveWriteIdempotent: true }, read: async () => ({ active: state.active }),
    write: async active => { state.writes.push([active, state.now]); state.active = active; await options.write?.(active, state); } };
  const clock = { now: () => state.now, sleep: async ms => { state.now += ms; options.tick?.(state); } };
  const motor = new PulseMotor({ relay, clock, openPulseMs: 100, closePulseMs: 200, readOnly: false, ...options.motor });
  return { state, relay, clock, motor };
}

test('generic pulse checks context and performs exactly one ON/OFF with direction-specific duration', async () => {
  const f = fixture(); let checked = 0;
  await f.motor.write('open', { beforeWrite: async () => { checked++; } });
  await f.motor.write('close', { beforeWrite: async () => { checked++; } });
  assert.equal(checked, 2);
  assert.deepEqual(f.state.writes, [[true, 0], [false, 100], [true, 100], [false, 300]]);
});

test('an uncertain ON is never repeated but always gets OFF cleanup', async () => {
  const f = fixture({ write: active => { if (active) throw new Fault('motor_write_ambiguous'); } });
  await assert.rejects(f.motor.write('open', { beforeWrite: async () => {} }), /motor_write_ambiguous/);
  assert.deepEqual(f.state.writes, [[true, 0], [false, 0]]);
});

test('OFF cleanup is bounded, while identity mismatch ends cleanup without targeting another device', async () => {
  const f = fixture({ write: active => { if (!active) throw new Fault('motor_write_ambiguous'); } });
  await assert.rejects(f.motor.write('open', { beforeWrite: async () => {} }), /motor_relay_release_unconfirmed/);
  assert.equal(f.state.writes.filter(x => x[0]).length, 1); assert.equal(f.state.writes.filter(x => !x[0]).length, 3);
  const changed = fixture({ write: active => { if (!active) throw new Fault('motor_resource_identity_mismatch'); } });
  await assert.rejects(changed.motor.write('close', { beforeWrite: async () => {} }), /motor_resource_identity_mismatch/);
  assert.equal(changed.state.writes.length, 2);
});

test('startup reads, read-only mode, failed context and already-active output cannot pulse', async () => {
  for (const situation of ['read-only', 'context', 'active']) {
    const f = fixture({ state: { active: situation === 'active' }, motor: { readOnly: situation === 'read-only' } });
    if (situation !== 'active') await f.motor.verifyIdle();
    await assert.rejects(f.motor.write('open', { beforeWrite: async () => { if (situation === 'context') throw new Fault('hold'); } }));
    assert.deepEqual(f.state.writes, []);
  }
  assert.throws(() => new PulseMotor({ relay: { capabilities: {} }, openPulseMs: 100, closePulseMs: 100 }), /motor_relay_release_not_supported/);
});

test('request time counts toward pulse duration; competing pulse cannot run concurrently', async () => {
  const f = fixture({ write: (active, state) => { if (active) state.now += 150; } });
  const first = f.motor.write('open', { beforeWrite: async () => {} });
  await assert.rejects(f.motor.write('close', { beforeWrite: async () => {} }), /motor_relay_busy/);
  await first; assert.deepEqual(f.state.writes, [[true, 0], [false, 150]]);
});

test('shared engine retracts before a relay pulse and still reads Tailwind for door state', async () => {
  const f = fixture({ write: (active, state) => { if (active) state.door = 'not-closed'; } });
  f.state.door = 'closed'; f.state.locked = true; f.state.journal = { inProgress: false, fault: false };
  const engine = new MovementEngine({
    door: { read: async () => ({ door: f.state.door, blocked: false, obstruction: false, evidence: 'closed-sensor' }),
      write: async () => { throw Error('Tailwind motor must not be selected'); } },
    bolt: { read: async () => ({ locked: f.state.locked, evidence: 'relay' }), write: async locked => { f.state.locked = locked; } },
    journal: { read: async () => f.state.journal, write: async value => { f.state.journal = value; } },
    motorPaths: { relay: f.motor }, clock: f.clock,
    feedback: { opening: 'timed', closing: 'sensor', bolt: 'relay', allowEstimatedBolting: false },
    timing: { openingMs: 100, openRetractSettleMs: 100, pollMs: 10 },
  });
  const originalWrite = f.relay.write;
  f.relay.write = async active => {
    if (active) { assert.equal(f.state.locked, false); assert.equal(f.state.journal.inProgress, true); }
    await originalWrite(active);
  };
  await engine.initialize(); assert.deepEqual(f.state.writes, []);
  const result = await engine.execute('open', { motorPath: 'relay' });
  assert.equal(result.phase, 'open'); assert.equal(result.openEstimated, true);
  assert.deepEqual(f.state.writes, [[true, 100], [false, 200]]);
});

test('generic deCONZ motor relay pins identity and maps active/inactive using real transport', async t => {
  const config = JSON.parse(await readFile(new URL('../examples/input-routing-config.json', import.meta.url), 'utf8')).controllers[0];
  config.bolt = { ...config.motorPaths[0].connection, lockedValue: false };
  const hardware = await hardwareFixture(config); t.after(hardware.close); hardware.state.locked = false;
  const { lockedValue, ...connection } = hardware.config.bolt;
  const relay = new DeconzMotorRelay({ ...connection, activeValue: lockedValue }, 'synthetic-deconz-key', { readOnly: false });
  let now = 0;
  const motor = new PulseMotor({ relay, openPulseMs: 100, closePulseMs: 100, readOnly: false,
    clock: { now: () => now, sleep: async ms => { now += ms; } } });
  await motor.write('open', { beforeWrite: async () => {} });
  assert.deepEqual(hardware.state.writes, [['bolt', false], ['bolt', true]]);
  assert.equal((await relay.read()).active, false);
  hardware.state.uniqueId = 'replacement-output';
  await assert.rejects(motor.write('close', { beforeWrite: async () => {} }), /motor_resource_identity_mismatch/);
  assert.equal(hardware.state.writes.length, 2);
});

test('shutdown interrupts the pulse wait and completes OFF cleanup before settling', async () => {
  let active=false;let markOn;const on=new Promise(resolve=>{markOn=resolve;});const writes=[];
  const relay={capabilities:{inactiveWriteIdempotent:true},read:async()=>({active}),write:async value=>{active=value;writes.push(value);if(value)markOn();}};
  const motor=new PulseMotor({relay,openPulseMs:2000,closePulseMs:2000,readOnly:false,clock:{now:()=>0,sleep:()=>new Promise(()=>{})}});
  const result=motor.write('open',{beforeWrite:async()=>{}});await on;motor.stop();await assert.rejects(result,/operation_interrupted/);
  assert.deepEqual(writes,[true,false]);assert.equal(active,false);
});
