import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementEngine } from '../src/engine.js';
import { PulseMotor } from '../src/pulse-motor.js';
import { Fault } from '../src/fault.js';
import { InputRouter } from '../src/input-routing.js';

function fixture(initial = 'closed') {
  const state = { now: 0, door: initial, locked: initial === 'closed', direction: null,
    active: false, pulses: 0, journal: { inProgress: false, fault: false }, writes: [], outage: false };
  let engine; let afterSleep = () => {};
  const clock = { now: () => state.now, sleep: async ms => {
    state.now += ms; if (state.direction === 'opening') state.door = 'not-closed';
    if (state.direction === 'closing' && state.closeAt !== undefined && state.now >= state.closeAt) state.door = 'closed';
    afterSleep(engine, state);
  } };
  const relay = { capabilities: { inactiveWriteIdempotent: true }, read: async () => ({ active: state.active }),
    write: async active => {
      state.writes.push(['relay', active, state.now]); state.active = active;
      if (active) { state.pulses++; state.direction = state.direction === 'opening' ? null : state.direction === 'closing' ? 'opening' : state.door === 'closed' ? 'opening' : 'closing'; }
    } };
  const motor = new PulseMotor({ relay, openPulseMs: 100, closePulseMs: 100, clock, readOnly: false, interruption: true });
  engine = new MovementEngine({ clock, motorPaths: { relay: motor },
    door: { read: async () => { if (state.outage) throw new Fault('door_read_failed'); return { door: state.door, evidence: 'closed-sensor', blocked: false, obstruction: false }; },
      write: async c => state.writes.push(['primary', c]) },
    bolt: { read: async () => ({ locked: state.locked, evidence: 'relay' }), write: async v => { state.locked = v; state.writes.push(['bolt', v, state.now]); } },
    journal: { read: async () => state.journal, write: async value => { state.journal = value; } },
    feedback: { opening: 'timed', closing: 'sensor', bolt: 'relay', allowEstimatedBolting: false },
    timing: { openingMs: 500, closingMs: 500, pollMs: 50, motionTimeoutMs: 3000, openRetractSettleMs: 0,
      closeRetractSettleMs: 0, closedStableMs: 100, boltSettleMs: 0, interruptedOpenMarginMs: 100 } });
  return { state, engine, motor, hook: fn => { afterSleep = fn; }, options: { motorPath: 'relay', interruption: true, owner: 'indoor' } };
}

test('indoor opening can stop; only its next press may close from the estimated partial stop', async () => {
  const f = fixture(); await f.engine.initialize(); let requested = false;
  f.hook((e, s) => { if (!requested && e.interruptionAllowed && s.now >= 250) { requested = true; assert.equal(e.requestInterruption(), true); assert.equal(e.requestInterruption(), false); } });
  const stopped = await f.engine.execute('open', f.options);
  assert.equal(stopped.phase, 'stopped-estimated'); assert.equal(f.state.pulses, 2); assert.equal(f.state.locked, false);
  assert.equal(f.state.journal.inProgress, true); // Restart cannot resume an estimated partial stop.
  await assert.rejects(f.engine.execute('close'), /partial_stop_requires_original_input/);
  await f.engine.observe(); assert.equal(f.engine.snapshot().phase, 'stopped-estimated');
  f.state.closeAt = f.state.now + 300; f.hook(() => {});
  assert.equal((await f.engine.execute('close', f.options)).phase, 'closed');
  assert.equal(f.state.pulses, 3); assert.equal(f.state.locked, true); assert.equal(f.state.journal.inProgress, false);
});

test('indoor closing reverses to estimated open and loses its old bolt authority', async () => {
  const f = fixture('not-closed'); await f.engine.initialize(); let requested = false;
  f.hook((e,s) => { if (!requested && e.interruptionAllowed && s.now >= 200) { requested = true; e.requestInterruption(); } });
  const result = await f.engine.execute('close', f.options);
  assert.equal(result.phase, 'open'); assert.equal(result.openEstimated, true);
  assert.equal(f.state.pulses, 2); assert.equal(f.state.locked, false);
  assert.equal(f.state.writes.some(x => x[0] === 'bolt' && x[1] === true), false);
});

test('closed sensor wins a race with an interruption and no pulse follows closure', async () => {
  const f = fixture('not-closed'); await f.engine.initialize(); let requested = false;
  f.hook((e,s) => { if (!requested && e.interruptionAllowed) { requested = true; e.requestInterruption(); s.door = 'closed'; s.direction = null; } });
  assert.equal((await f.engine.execute('close', f.options)).phase, 'closed');
  assert.equal(f.state.pulses, 1); assert.equal(f.state.locked, true);
});

test('relay closing with zero wait carries its pending unlock through travel without repeating OFF', async () => {
  const f=fixture('not-closed');await f.engine.initialize();f.state.locked=true;f.state.closeAt=400;
  f.engine.bolt.write=async value=>{
    f.state.writes.push(['bolt',value,f.state.now]);
    if(value)f.state.locked=true;else f.state.retractAt=f.state.now+150;
  };
  f.hook((_e,s)=>{if(s.retractAt!==undefined&&s.now>=s.retractAt){s.locked=false;delete s.retractAt;}});
  assert.equal((await f.engine.execute('close',f.options)).phase,'closed');
  assert.deepEqual(f.state.writes.slice(0,2),[['bolt',false,0],['relay',true,0]]);
  assert.equal(f.state.writes.filter(([kind,value])=>kind==='bolt'&&value===false).length,1);
  assert.equal(f.state.pulses,1);assert.equal(f.state.locked,true);
});

test('idle read outages recover without movement; active outages remain latched', async () => {
  const f = fixture(); await f.engine.initialize(); f.state.outage = true;
  assert.equal((await f.engine.observe()).phase, 'unavailable'); assert.equal(f.state.writes.length, 0);
  f.state.outage = false; assert.equal((await f.engine.observe()).phase, 'closed');
  f.hook((e,s) => { if (e.interruptionAllowed) s.outage = true; });
  assert.equal((await f.engine.execute('open', f.options)).fault, 'door_read_failed');
  f.state.outage = false; await assert.rejects(f.engine.observe(), /engine_unavailable/);
});

test('new idle closure signals automatic lock work, startup and an external unlock do not', async () => {
  const f = fixture(); await f.engine.initialize(); assert.equal(f.engine.autoClosePending, false);
  f.state.locked = false; await f.engine.observe(); assert.equal(f.engine.autoClosePending, false);
  assert.equal(f.engine.snapshot().externalUnlockOverride, true);
  f.state.door = 'not-closed'; await f.engine.observe(); f.state.door = 'closed'; await f.engine.observe();
  assert.equal(f.engine.autoClosePending, true);
  await assert.rejects(f.engine.execute('observed-close'), /manual_unlock_override/);
  assert.equal(f.state.writes.length, 0);
});

for (const margin of [100, 300]) test(`reopening waits for completed reversal command and adds ${margin}ms margin`, async () => {
  const f = fixture('not-closed');
  f.engine.timing.openingMs = 2000;
  f.engine.timing.interruptedOpenMarginMs = margin;
  await f.engine.initialize();
  let requested = false; let completedAt;
  const readRelay = f.motor.relay.read;
  f.motor.relay.read = async () => {
    if (requested && f.state.pulses === 1 && !f.state.active) f.state.now += 180; // Pre-pulse relay check.
    return readRelay();
  };
  const writeRelay = f.motor.relay.write;
  f.motor.relay.write = async active => {
    if (active && f.state.pulses === 1) f.state.now += 120; // Reversal delivery.
    return writeRelay(active);
  };
  const interrupt = f.motor.interrupt.bind(f.motor);
  f.motor.interrupt = async options => {
    await interrupt(options);
    f.state.now += 70; // Final command acknowledgement/cleanup.
    completedAt = f.state.now;
  };
  f.hook((e, s) => {
    if (!requested && e.interruptionAllowed && s.now >= 200) {
      requested = true; assert.equal(e.requestInterruption(), true);
    }
  });
  const result = await f.engine.execute('close', f.options);
  assert.equal(result.phase, 'open'); assert.equal(result.openEstimated, true);
  assert.ok(completedAt >= 570);
  // Preserve downward time through completion, then allow its full return plus margin.
  const earliestOpen = completedAt + completedAt + margin;
  assert.ok(f.state.now >= earliestOpen, `${f.state.now} must be >= ${earliestOpen}`);
  assert.ok(f.state.now < earliestOpen + f.engine.timing.pollMs);
  assert.equal(f.state.pulses, 2);
  assert.equal(f.state.writes.some(([kind, value]) => kind === 'bolt' && value === true), false);
});

test('failed reversal does not start a successful reopening estimate or lock the bolt', async () => {
  const f = fixture('not-closed'); await f.engine.initialize(); let requested = false;
  f.motor.interrupt = async () => { f.state.now += 200; throw new Fault('motor_relay_release_unconfirmed'); };
  f.hook((e, s) => {
    if (!requested && e.interruptionAllowed && s.now >= 200) { requested = true; e.requestInterruption(); }
  });
  const result = await f.engine.execute('close', f.options);
  assert.equal(result.fault, 'motor_relay_release_unconfirmed');
  assert.equal(result.openEstimated, false);
  assert.equal(f.state.writes.some(([kind, value]) => kind === 'bolt' && value === true), false);
});

function keypadRouter(f, busyBehavior = 'interrupt') {
  const clock = { now: () => f.state.now, wall: () => 100000 + f.state.now };
  const router = new InputRouter(f.engine, [{ id: 'keypad', enabled: true, source: { type: 'deconz', kind: 'keypad' },
    trigger: 'native-outcome', action: 'keypad', motorPath: 'relay', busyBehavior, rearmSeconds: 0, timing: {} }], clock);
  let sequence = 0;
  const arm = () => router.arm('keypad', { session: 'live', sequence, value: 'rejected' });
  const offer = (value, alarmDisarmed = true) => router.offer('keypad', { session: 'live', sequence: ++sequence,
    value, epoch: router.epoch, snapshot: false, receivedAt: clock.now(), occurredAt: clock.wall() }, router.capture('keypad'), { alarmDisarmed });
  return { router, arm, offer };
}

for (const stopValue of ['accepted-disarm', 'rejected']) {
  for (const closeValue of ['accepted-disarm', 'rejected']) test(`keypad ${stopValue} stops opening; ${closeValue} closes the partial stop`, async () => {
    const f = fixture(); const k = keypadRouter(f); await f.engine.initialize(); k.arm();
    assert.equal((await k.offer('rejected')).accepted, false);
    assert.equal((await k.offer('accepted-disarm', false)).accepted, false);
    assert.equal(f.state.writes.length, 0);
    let interruption; let requested = false;
    f.hook((e, s) => {
      if (!requested && e.interruptionAllowed && s.now >= 250) {
        requested = true; k.arm(); interruption = k.offer(stopValue);
      }
    });
    const stopped = await k.offer('accepted-disarm');
    assert.equal((await interruption).accepted, true);
    assert.equal(stopped.result.phase, 'stopped-estimated'); assert.equal(f.state.pulses, 2);
    assert.equal(f.state.locked, false);
    f.hook(() => {}); f.state.closeAt = f.state.now + 300; k.arm();
    const closed = await k.offer(closeValue);
    assert.equal(closed.result.phase, 'closed'); assert.equal(f.state.pulses, 3); assert.equal(f.state.locked, true);
  });
}

for (const reverseValue of ['accepted-disarm', 'rejected']) test(`keypad ${reverseValue} reverses its closing operation without bolting`, async () => {
  const f = fixture(); const k = keypadRouter(f); await f.engine.initialize(); k.arm();
  assert.equal((await k.offer('accepted-disarm')).result.phase, 'open');
  f.state.direction = null; // Physical full-open limit stops the motor.
  const reverseAt = f.state.now + 200; let interruption; let requested = false;
  f.hook((e, s) => {
    if (!requested && e.interruptionAllowed && s.now >= reverseAt) {
      requested = true; k.arm(); interruption = k.offer(reverseValue);
    }
  });
  k.arm(); const result = await k.offer('accepted-disarm');
  assert.equal((await interruption).accepted, true);
  assert.equal(result.result.phase, 'open'); assert.equal(result.result.openEstimated, true);
  assert.equal(f.state.pulses, 3); assert.equal(f.state.locked, false);
  assert.equal(f.state.writes.some(([kind, value]) => kind === 'bolt' && value === true), false);
});

test('keypad interruption requires disarmed confirmation and cannot interrupt another owner', async () => {
  const f = fixture(); const k = keypadRouter(f); await f.engine.initialize(); let checked = false; let denied;
  f.hook(e => { if (!checked && e.interruptionAllowed) { checked = true; k.arm(); denied = k.offer('rejected'); } });
  await f.engine.execute('open', f.options);
  assert.equal((await denied).accepted, false); assert.equal(f.state.pulses, 1);
  f.state.direction = null; checked = false;
  f.hook(e => { if (!checked && e.interruptionAllowed) { checked = true; k.arm(); denied = k.offer('accepted-disarm', false); f.state.closeAt = f.state.now + 200; } });
  k.arm(); assert.equal((await k.offer('rejected')).result.phase, 'closed');
  assert.equal((await denied).accepted, false); assert.equal(f.state.pulses, 2);
});
