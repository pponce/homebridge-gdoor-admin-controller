import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementEngine } from '../src/engine.js';
import { PulseMotor } from '../src/pulse-motor.js';
import { Fault } from '../src/fault.js';

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
  return { state, engine, hook: fn => { afterSleep = fn; }, options: { motorPath: 'relay', interruption: true, owner: 'indoor' } };
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
