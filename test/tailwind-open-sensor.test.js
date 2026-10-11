import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TailwindDoor } from '../src/drivers.js';
import { MovementEngine } from '../src/engine.js';
import { PulseMotor } from '../src/pulse-motor.js';
import { validateConfiguration } from '../src/config.js';
import { Diagnostics } from '../src/diagnostics.js';

const example = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
function fixture(position = 'closed') {
  const model = { now: 0, position, locked: position === 'closed', direction: null,
    writes: [], active: false, blocked: false, disabled: false, extraDisabled: true,
    journal: { inProgress: false, fault: false } };
  let tick = () => {};
  const clock = { now: () => model.now, sleep: async ms => { model.now += ms; tick(model); } };
  const door = new TailwindDoor({ baseUrl: 'http://example.invalid', doorIndex: 0, openSensorDoorIndex: 1 }, '123456',
    { readOnly: false, request: async ({ body }) => {
      if (body.data.type === 'set') {
        model.writes.push(['door', body.data.value]);
        model.direction = body.data.value.cmd === 'open' ? 'opening' : 'closing';
        return { result: 'OK' };
      }
      const data = {
        door1: { index: 0, status: ['closed', 'conflict'].includes(model.position) ? 'close' : 'open', lockup: model.blocked, disabled: model.disabled },
        door2: { index: 1, status: ['open', 'conflict'].includes(model.position) ? 'close' : 'open', lockup: true, disabled: model.extraDisabled },
      };
      model.response?.(data);
      return { result: 'OK', data };
    } });
  const motor = new PulseMotor({ readOnly: false, clock, openPulseMs: 100, closePulseMs: 100, interruption: true,
    relay: { capabilities: { inactiveWriteIdempotent: true },
      read: async () => ({ active: model.active }),
      write: async active => {
        model.active = active; model.writes.push(['relay', active]);
        if (active) model.direction = model.direction === 'opening' ? null : model.direction === 'closing' ? 'opening' : model.position === 'closed' ? 'opening' : 'closing';
      } } });
  const engine = new MovementEngine({ door, motorPaths: { relay: motor }, clock,
    bolt: { read: async () => ({ locked: model.locked, evidence: 'relay' }),
      write: async value => { model.locked = value; model.writes.push(['bolt', value]); } },
    journal: { read: async () => model.journal, write: async value => { model.journal = value; } },
    feedback: { opening: 'sensor', closing: 'sensor', bolt: 'relay', allowEstimatedBolting: false },
    timing: { openingMs: 50, closingMs: 50, pollMs: 10, motionTimeoutMs: 500, boltTimeoutMs: 100,
      openRetractSettleMs: 0, closeRetractSettleMs: 0, closedStableMs: 20, boltSettleMs: 0, interruptedOpenMarginMs: 10000 } });
  return { model, door, engine, tick: fn => { tick = fn; },
    options: { motorPath: 'relay', interruption: true, owner: 'indoor', timing: { openingMs: 1 } } };
}

test('Tailwind maps both endpoint sensors while extra control is disabled or locked out', async () => {
  const f = fixture();
  for (const [position, evidence] of [['closed','closed-sensor'],['not-closed','position-sensors'],['open','open-sensor']]) {
    f.model.position = position;
    const reading = await f.door.read();
    assert.equal(reading.door, position); assert.equal(reading.evidence, evidence);
    assert.equal(reading.blocked, false); assert.equal(reading.disabled, false); assert.equal(reading.lockout, false);
  }
  f.model.disabled = true; assert.equal((await f.door.read()).blocked, true);
  await assert.rejects(f.door.write('close'), /door_blocked/); assert.deepEqual(f.model.writes, []);
  f.model.disabled = false;
  await f.door.write('close');
  assert.deepEqual(f.model.writes, [['door', { door_idx: 0, cmd: 'close' }]]);
});

test('invalid or conflicting extra sensor data cannot fall back to a timer or motor write', async () => {
  for (const response of [
    data => { delete data.door2; }, data => { data.door2.index = 2; },
    data => { data.door2.status = 'unknown'; }, data => { data.door2.disabled = 'true'; },
  ]) {
    const f = fixture(); f.model.response = response;
    await assert.rejects(f.door.read(), /door_open_sensor_invalid/);
    await assert.rejects(f.door.write('open'), /door_open_sensor_invalid/);
    assert.deepEqual(f.model.writes, []);
  }
  const f = fixture('conflict');
  await assert.rejects(f.door.read(), /door_sensor_conflict/);
  await f.engine.initialize();
  assert.equal(f.engine.state.fault, 'door_sensor_conflict'); assert.deepEqual(f.model.writes, []);
});

test('configuration validates distinct sensor inputs, range, feedback and exclusive channel ownership', () => {
  const config = structuredClone(example), p = config.controllers[0];
  p.door.openSensorDoorIndex = 1; p.feedback.opening = 'sensor';
  assert.equal(validateConfiguration(config).controllers[0].door.openSensorDoorIndex, 1);
  for (const index of [0, -1, 3, 1.5, '1', null]) {
    p.door.openSensorDoorIndex = index;
    assert.throws(() => validateConfiguration(config), /invalid_open_sensor_door_index/);
  }
  p.door.openSensorDoorIndex = 1; p.feedback.opening = 'timed';
  assert.throws(() => validateConfiguration(config), /tailwind_two_sensors_require_sensor_feedback/);
  p.feedback.opening = 'sensor';
  const second = structuredClone(p); second.id = 'second'; second.door.doorIndex = 1; delete second.door.openSensorDoorIndex;
  second.bolt.resourceId = '2'; second.bolt.uniqueId = 'another-bolt';
  config.controllers.push(second);
  assert.throws(() => validateConfiguration(config), /duplicate_hardware_owner/);
  config.controllers.pop();
  config.connections = [{ id: 'tailwind', name: 'Tailwind', type: 'tailwind', baseUrl: p.door.baseUrl, credentialRef: p.door.credentialRef, doorCount: 1 }];
  assert.throws(() => validateConfiguration(config), /tailwind_door_out_of_range/);
});

for (const relay of [false, true]) test('opening waits for extra sensor beyond all travel estimates; relay=' + relay, async () => {
  const f = fixture(); await f.engine.initialize();
  f.tick(m => {
    if (m.direction === 'opening') m.position = m.now >= 200 ? 'open' : 'not-closed';
    if (m.now < 200) assert.notEqual(f.engine.state.phase, 'open');
  });
  const result = await f.engine.execute('open', relay ? f.options : { timing: { openingMs: 1 } });
  assert.equal(result.phase, 'open'); assert.equal(result.openEstimated, false); assert.ok(f.model.now >= 200);
  assert.equal(f.engine.travel, null); assert.equal(f.model.locked, false);
  assert.equal(f.model.writes.filter(([kind]) => kind === 'door').length, relay ? 0 : 1);
});

for (const relay of [false, true]) test('missing fully-open confirmation times out without claiming open; relay=' + relay, async () => {
  const f = fixture(); await f.engine.initialize();
  f.tick(m => { if (m.direction === 'opening') m.position = 'not-closed'; });
  const result = await f.engine.execute('open', relay ? f.options : {});
  assert.equal(result.fault, relay ? 'interrupted_travel_timeout' : 'door_open_timeout');
  assert.equal(result.openEstimated, false); assert.equal(result.phase, 'fault');
  assert.equal(f.model.writes.filter(([kind, value]) => kind === 'relay' && value === true || kind === 'door').length, 1);
});

test('closing reversal waits for fully-open sensor and never extends bolt', async () => {
  const f = fixture('open'); await f.engine.initialize(); let requested = false;
  f.tick(m => {
    if (m.direction) m.position = m.direction === 'opening' && m.now >= 220 ? 'open' : 'not-closed';
    if (!requested && f.engine.interruptionAllowed) { requested = true; assert.equal(f.engine.requestInterruption(), true); }
  });
  const result = await f.engine.execute('close', f.options);
  assert.equal(result.phase, 'open'); assert.equal(result.openEstimated, false); assert.ok(f.model.now >= 220);
  assert.equal(f.model.writes.filter(([kind, value]) => kind === 'relay' && value).length, 2);
  assert.equal(f.model.writes.some(([kind, value]) => kind === 'bolt' && value), false);
});

test('stopped partial opening retains owner; next close waits for closed sensor and stability before bolting', async () => {
  const f = fixture(); await f.engine.initialize(); let requested = false;
  f.tick(m => {
    if (m.direction === 'opening') m.position = 'not-closed';
    if (!requested && f.engine.interruptionAllowed) { requested = true; f.engine.requestInterruption(); }
  });
  assert.equal((await f.engine.execute('open', f.options)).phase, 'stopped-estimated');
  await assert.rejects(f.engine.execute('close'), /partial_stop_requires_original_input/);
  const closedAt = f.model.now + 100;
  f.tick(m => { if (m.direction === 'closing' && m.now >= closedAt) m.position = 'closed'; });
  assert.equal((await f.engine.execute('close', f.options)).phase, 'closed');
  assert.ok(f.model.now >= closedAt + 20); assert.equal(f.model.locked, true);
});

test('fully-open endpoint wins interruption race without a second pulse', async () => {
  const f = fixture(); await f.engine.initialize(); let requested = false;
  f.tick(m => {
    m.position = 'not-closed';
    if (!requested && f.engine.interruptionAllowed) {
      requested = true; f.engine.requestInterruption(); m.position = 'open';
    }
  });
  assert.equal((await f.engine.execute('open', f.options)).phase, 'open');
  assert.equal(f.model.writes.filter(([kind, value]) => kind === 'relay' && value).length, 1);
});

test('restart and external movement use current sensors, with no commands or restored estimate', async () => {
  const f = fixture('open'); f.model.journal.inProgress = true;
  assert.equal((await f.engine.initialize()).phase, 'open');
  assert.equal(f.engine.state.reconciling, false); assert.equal(f.engine.state.openEstimated, false);
  f.model.position = 'not-closed'; await f.engine.observe();
  assert.equal(f.engine.state.phase, 'position-unknown');
  f.engine.partialOwner = 'indoor'; f.model.position = 'open'; await f.engine.observe();
  assert.equal(f.engine.state.phase, 'open'); assert.equal(f.engine.partialOwner, null);
  f.model.position = 'closed'; await f.engine.observe(); assert.equal(f.engine.state.phase, 'closed');
  assert.deepEqual(f.model.writes, []);
});

test('read-only commissioning accepts disabled extra sensor and reports its physical endpoint', async () => {
  const config = structuredClone(example.controllers[0]); config.door.openSensorDoorIndex = 1; config.feedback.opening = 'sensor';
  const f = fixture('open');
  const diagnostics = new Diagnostics({ controllers: [config] }, async () => ({
    [config.door.credentialRef]: '123456', [config.bolt.credentialRef]: 'synthetic-key',
  }), { request: async args => {
    if (args.body?.data?.name === 'dev_st') return f.door.request(args);
    if (args.url.endsWith('/config')) return { bridgeid: config.bolt.gatewayId };
    return { uniqueid: config.bolt.uniqueId, type: config.bolt.resourceType, modelid: config.bolt.modelId,
      manufacturername: config.bolt.manufacturer, state: { reachable: true, on: !config.bolt.lockedValue } };
  } });
  const result = await diagnostics.probe(config.id);
  assert.equal(result.door.state, 'open'); assert.equal(result.door.feedback, 'open-sensor');
  assert.equal(result.compatible, true); assert.deepEqual(f.model.writes, []);
});

test('loss or contradiction of extra feedback during motion faults without retrying or bolting', async () => {
  for (const conflict of [false, true]) {
    const f = fixture(); await f.engine.initialize();
    f.tick(m => {
      m.position = conflict ? 'conflict' : 'not-closed';
      if (!conflict) m.response = data => { delete data.door2; };
    });
    const result = await f.engine.execute('open');
    assert.equal(result.fault, conflict ? 'door_sensor_conflict' : 'door_open_sensor_invalid');
    assert.equal(result.openEstimated, false);
    assert.deepEqual(f.model.writes.map(([kind,value]) => [kind, value]), [
      ['bolt',false], ['door',{door_idx:0,cmd:'open'}],
    ]);
  }
});

test('restart between endpoints cannot reconstruct fully open from elapsed time', async () => {
  const f = fixture('not-closed'); f.model.journal.inProgress = true;
  await f.engine.initialize(); f.model.now = 100000;
  await f.engine.observe();
  assert.equal(f.engine.state.phase, 'position-unknown'); assert.equal(f.engine.state.reconciling, true);
  f.model.position = 'open'; await f.engine.observe();
  assert.equal(f.engine.state.phase, 'open'); assert.equal(f.engine.state.reconciling, false);
  assert.equal(f.engine.state.openEstimated, false); assert.deepEqual(f.model.writes, []);
});

test('normal closing detects a return to fully open after departure without another command', async () => {
  const f = fixture('open'); await f.engine.initialize();
  f.tick(m => { m.position = m.now < 100 || m.now >= 200 ? 'open' : 'not-closed'; });
  const result = await f.engine.execute('close');
  assert.equal(result.fault, 'close_reversed'); assert.equal(result.door, 'open');
  assert.equal(result.openEstimated, false); assert.equal(f.model.now, 200);
  assert.deepEqual(f.model.writes, [['door', {door_idx:0,cmd:'close'}]]);
});
