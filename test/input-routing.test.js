import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfiguration, routingInventory } from '../src/config.js';
import { InputEventGate, InputRouter } from '../src/input-routing.js';
import { MovementEngine } from '../src/engine.js';

const example = JSON.parse(await readFile(new URL('../examples/input-routing-config.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(example);

test('physical inputs are brand-neutral bindings; built-ins retain the primary opener', () => {
  const c = validateConfiguration(copy()).controllers[0]; const routing = routingInventory(c);
  assert.deepEqual(routing.builtins, { homekit: 'primary', virtualKeypad: 'primary' });
  assert.equal(c.inputs[0].motorPath, 'wall-relay'); assert.equal(c.inputs[1].motorPath, 'wall-relay');
  assert.equal(c.inputs[2].source.type, 'homebridge');
  assert.equal(routing.runtimeEnabled, false);
  for (const privateValue of ['credentialRef', 'gatewayId', 'uniqueId', 'bridgeId', 'serviceId', 'example.invalid']) {
    assert.equal(JSON.stringify(routing).includes(privateValue), false);
  }
});

test('profiles select existing motor paths and cannot override built-in route identities', () => {
  for (const change of [c => { c.inputs[0].motorPath = 'missing'; }, c => { c.inputs[0].id = 'homekit'; },
    c => { c.motorPaths[0].id = 'primary'; }, c => { c.inputs[0].busyBehavior = 'queue'; },
    c => { c.motorPaths[0].connection.key = 'private-value'; }]) {
    const cfg = copy(); change(cfg.controllers[0]); assert.throws(() => validateConfiguration(cfg));
  }
});

test('motor relay cannot reuse a bolt, or a motor relay owned by a different assembly', () => {
  const cfg = copy(); const c = cfg.controllers[0];
  c.motorPaths[0].connection.resourceId = c.bolt.resourceId;
  assert.throws(() => validateConfiguration(cfg), /duplicate_hardware_owner/);
  c.motorPaths[0].connection.resourceId = '2';
  const second = structuredClone(c); second.id = 'second'; second.door.doorIndex = 1;
  second.bolt.resourceId = '3'; second.bolt.uniqueId = 'another-bolt'; second.inputs = [];
  cfg.controllers.push(second);
  assert.throws(() => validateConfiguration(cfg), /duplicate_hardware_owner/);
});

test('one event cannot bind twice, while distinct button gestures can have different actions', () => {
  const cfg = copy(); const c = cfg.controllers[0]; const input = structuredClone(c.inputs[0]);
  input.id = 'double-press'; c.inputs.push(input);
  assert.throws(() => validateConfiguration(cfg), /overlapping_input_binding/);
  input.trigger = 1004; input.action = 'close'; input.busyBehavior = 'drop';
  assert.equal(validateConfiguration(cfg).controllers[0].inputs.length, 4);
});

test('Homebridge switch inputs cannot be motor/bolt feedback and edge bindings cannot overlap', () => {
  const cfg = copy(); const c = cfg.controllers[0]; const input = c.inputs[2];
  input.source.kind = 'switch'; input.trigger = 'on';
  c.motorPaths[0].connection = { type: 'homebridge', bridgeId: input.source.bridgeId,
    serviceId: input.source.serviceId, credentialRef: input.source.credentialRef, activeValue: true, inactiveWriteIdempotent: true };
  assert.throws(() => validateConfiguration(cfg), /input_output_feedback_loop/);
  c.motorPaths[0].connection.serviceId = 'separate-output';
  assert.equal(validateConfiguration(cfg).controllers[0].inputs.length, 3);
  const second = structuredClone(input); second.id = 'off-edge'; second.trigger = 'off'; c.inputs.push(second);
  assert.equal(validateConfiguration(cfg).controllers[0].inputs.length, 4);
  second.trigger = 'either'; assert.throws(() => validateConfiguration(cfg), /overlapping_input_binding/);
});

test('stop/reverse requires a pulse path declaration and allows an opted-in keypad but not a Tailwind path', () => {
  const cfg = copy(); cfg.controllers[0].inputs[0].motorPath = 'primary';
  assert.throws(() => validateConfiguration(cfg), /unsupported_input_interruption/);
  cfg.controllers[0].inputs[0].motorPath = 'wall-relay';
  cfg.controllers[0].inputs[1].busyBehavior = 'interrupt';
  assert.equal(validateConfiguration(cfg).controllers[0].inputs[1].busyBehavior, 'interrupt');
  cfg.controllers[0].motorPaths[0].interruption = 'disabled';
  assert.throws(() => validateConfiguration(cfg), /unsupported_input_interruption/);
});

function gateFixture(kind = 'button', type = 'deconz') {
  const state = { now: 0, wall: 100000 };
  const profile = { enabled: true, source: { type, kind }, trigger: kind === 'switch' ? 'on' : 1002, rearmSeconds: 1 };
  const clock = { now: () => state.now, wall: () => state.wall };
  const gate = new InputEventGate(profile, clock);
  gate.arm({ session: 'first', sequence: 10, value: kind === 'switch' ? false : 1002, epoch: 1 });
  const event = (sequence, value = profile.trigger, extra = {}) => ({ session: 'first', sequence, value,
    epoch: 1, snapshot: false, receivedAt: state.now, occurredAt: state.wall, ...extra });
  return { state, gate, event, context: { epoch: 1, eligible: true } };
}

test('button snapshots, quiet-period messages and duplicate events never become fresh presses', () => {
  const f = gateFixture();
  assert.equal(f.gate.accept(f.event(11), f.context), false);
  f.state.now = 1000;
  assert.equal(f.gate.accept(f.event(11), f.context), false);
  assert.equal(f.gate.accept(f.event(12, 1002, { snapshot: true }), f.context), false);
  assert.equal(f.gate.accept(f.event(13), f.context), true);
  assert.equal(f.gate.accept(f.event(13), f.context), false);
  assert.equal(f.gate.accept(f.event(14), f.context), true); // Repeated press value, distinct event.
});

test('switch triggers on an edge, never an already-on state or polling duplicate', () => {
  const f = gateFixture('switch', 'homebridge'); f.state.now = 1000;
  assert.equal(f.gate.accept(f.event(11, true), f.context), true);
  assert.equal(f.gate.accept(f.event(12, true), f.context), false);
  assert.equal(f.gate.accept(f.event(13, false), f.context), false);
  assert.equal(f.gate.accept(f.event(14, true), f.context), true);
});

test('stale timestamps, reconnects and busy epochs drop history instead of replaying it', () => {
  const f = gateFixture(); f.state.now = 1000;
  assert.equal(f.gate.accept(f.event(11, 1002, { occurredAt: 96000 }), f.context), false);
  assert.equal(f.gate.accept(f.event(12, 1002, { receivedAt: -1000 }), f.context), false);
  assert.equal(f.gate.accept(f.event(13), { epoch: 2, eligible: false }), false);
  assert.equal(f.gate.accept(f.event(14), f.context), false);
  f.gate.arm({ session: 'second', sequence: 14, value: 1002, epoch: 3 }); f.state.now = 2000;
  assert.equal(f.gate.accept(f.event(15), { epoch: 3, eligible: true }), false);
  assert.equal(f.gate.accept(f.event(15, 1002, { session: 'second', epoch: 3 }), { epoch: 3, eligible: true }), true);
});

function routerFixture({ devicePermission = true, inputPermission = true } = {}) {
  const cfg = validateConfiguration(copy()).controllers[0];
  for (const profile of cfg.inputs) { profile.rearmSeconds = 0; profile.timing = {}; profile.allowDuringOpenerLockout = inputPermission; }
  const state = { door: 'closed', locked: true, now: 0, commands: [], journal: null };
  const clock = { now: () => state.now, wall: () => 100000 + state.now, sleep: async ms => { state.now += ms; } };
  const writer = route => ({ capabilities: { pulse: route !== 'primary', interruption: true }, write: async command => { state.commands.push([route, command]); state.door = command === 'open' ? 'not-closed' : 'closed'; } });
  const primary = { ...writer('primary'), read: async () => ({ door: state.door, blocked: state.lockout === true || state.disabled === true || state.blocked === true, lockout: state.lockout === true, disabled: state.disabled === true, obstruction: state.obstruction === true, evidence: 'closed-sensor' }) };
  const engine = new MovementEngine({ door: primary, bolt: { read: async () => ({ locked: state.locked, evidence: 'relay' }),
    write: async value => { state.locked = value; } },
    journal: { read: async () => ({ inProgress: false, fault: false }), write: async value => { state.journal = value; } },
    feedback: cfg.feedback, clock, motorPaths: { 'wall-relay': writer('wall-relay') }, lockoutMotorPaths: devicePermission ? ['wall-relay'] : [],
    timing: { pollMs: 10, openingMs: 20, closedStableMs: 0, boltSettleMs: 0, openRetractSettleMs: 0, closeRetractSettleMs: 0 } });
  const router = new InputRouter(engine, cfg.inputs, clock);
  function arm(id, value = 0) { router.arm(id, { session: 'connected', sequence: 0, value }); }
  function offer(id, value, extra = {}, receipt = router.capture(id)) {
    return router.offer(id, { session: 'connected', sequence: 1, value, epoch: router.epoch,
      snapshot: false, receivedAt: state.now, occurredAt: clock.wall() }, receipt, extra);
  }
  return { engine, router, state, arm, offer };
}

test('two different button providers and physical keypad share the relay route; HomeKit/virtual keypad retain Tailwind', async () => {
  const f = routerFixture(); await f.engine.initialize();
  f.arm('indoor-button'); assert.equal((await f.offer('indoor-button', 1002)).accepted, true);
  await f.router.builtin('homekit', 'close');
  f.arm('physical-keypad'); assert.equal((await f.offer('physical-keypad', 'accepted-disarm', { alarmDisarmed: true })).accepted, true);
  await f.router.builtin('virtual-keypad', 'close');
  f.arm('other-button'); assert.equal((await f.offer('other-button', 0)).accepted, true);
  assert.deepEqual(f.state.commands, [['wall-relay', 'open'], ['primary', 'close'], ['wall-relay', 'open'], ['primary', 'close'], ['wall-relay', 'open']]);
});

test('keypad open then external close retains the next button, HomeKit and keypad motor routes', async () => {
  const f = routerFixture(); await f.engine.initialize();
  f.arm('physical-keypad'); await f.offer('physical-keypad', 'accepted-disarm', { alarmDisarmed: true });
  assert.equal(f.engine.state.phase, 'open'); f.state.now += 60000;
  await f.engine.observe(); f.state.door = 'closed'; await f.engine.observe();
  assert.equal(f.engine.state.target, 'closed');
  await f.engine.execute('observed-close'); assert.equal(f.state.locked, true);
  assert.deepEqual(f.state.commands, [['wall-relay', 'open']], 'external close and auto-bolt never pulse the motor');
  f.arm('indoor-button'); assert.equal((await f.offer('indoor-button', 1002)).accepted, true);
  await f.router.builtin('homekit', 'close');
  await f.router.builtin('virtual-keypad', 'open');
  f.arm('physical-keypad'); assert.equal((await f.offer('physical-keypad', 'rejected')).accepted, true);
  assert.deepEqual(f.state.commands, [['wall-relay', 'open'], ['wall-relay', 'open'], ['primary', 'close'], ['primary', 'open'], ['wall-relay', 'close']]);
  assert.equal(f.engine.state.phase, 'closed'); assert.equal(f.engine.state.target, 'closed');
});

test('an idle observation does not invalidate an armed physical button or discard a fresh press',async()=>{
  const f=routerFixture();await f.engine.initialize();f.arm('indoor-button');
  const before=f.router.context('indoor-button');const read=f.engine.door.read;let release;
  f.engine.door.read=()=>{f.engine.door.read=read;return new Promise(resolve=>{release=resolve;});};
  const observation=f.engine.observe();assert.deepEqual(f.router.context('indoor-button'),before);
  const operation=f.offer('indoor-button',1002);assert.deepEqual(f.state.commands,[]);
  release(await read());await observation;
  assert.equal((await operation).accepted,true);assert.deepEqual(f.state.commands,[['wall-relay','open']]);
});

test('native keypad requires disarmed confirmation, rejected code closes, receipt cannot replay', async () => {
  const f = routerFixture(); await f.engine.initialize(); f.arm('physical-keypad');
  assert.equal((await f.offer('physical-keypad', 'accepted-disarm')).accepted, false);
  await f.router.builtin('homekit', 'open'); f.arm('physical-keypad');
  const receipt = f.router.capture('physical-keypad');
  assert.equal((await f.offer('physical-keypad', 'rejected', {}, receipt)).accepted, true);
  assert.equal((await f.offer('physical-keypad', 'rejected', {}, receipt)).accepted, false);
  assert.deepEqual(f.state.commands, [['primary', 'open'], ['wall-relay', 'close']]);
});

test('delayed input cannot execute after another source operation; busy work never queues', async () => {
  const f = routerFixture(); await f.engine.initialize(); f.arm('indoor-button');
  const receipt = f.router.capture('indoor-button');
  const operation = f.router.builtin('homekit', 'open');
  assert.equal((await f.offer('indoor-button', 1002)).accepted, false);
  await operation; f.arm('indoor-button');
  assert.equal((await f.offer('indoor-button', 1002, {}, receipt)).accepted, false);
  assert.deepEqual(f.state.commands, [['primary', 'open']]);
});

test('profile timing is scoped to its operation and cannot change the built-in defaults', async () => {
  const f = routerFixture(); await f.engine.initialize();
  f.router.profiles.get('indoor-button').timing = { openRetractSettleSeconds: 0.1 };
  f.arm('indoor-button'); await f.offer('indoor-button', 1002);
  assert.equal(f.state.now, 120); assert.equal(f.engine.timing.openRetractSettleMs, 0);
  assert.equal(f.engine.motor, f.engine.door);
});


test('physical button and keypad pulse through lockout; primary routes remain held', async () => {
  for (const [id, value, extra] of [['indoor-button', 1002, {}], ['physical-keypad', 'accepted-disarm', { alarmDisarmed: true }]]) {
    const f = routerFixture(); f.state.lockout = true; await f.engine.initialize();
    assert.equal(f.engine.initialized, true); assert.deepEqual(f.state.commands, []);
    f.arm(id); const result = await f.offer(id, value, extra);
    assert.equal(result.accepted, true); assert.equal(result.result.fault, null);
    assert.deepEqual(f.state.commands, [['wall-relay', 'open']]); assert.equal(f.state.locked, false);
    assert.equal(f.engine.state.lockout, true, 'a pulse cannot clear the observed lockout flag');
    await f.engine.observe(); assert.equal(f.engine.state.fault, null);
    const primary = await f.router.builtin('homekit', 'close');
    assert.equal(primary.result.fault, 'door_blocked'); assert.equal(f.state.commands.length, 1);
  }
});

test('lockout permissions require both gates; either missing/false forbids pulse and bolt writes', async () => {
  for (const devicePermission of [false, true]) for (const inputPermission of [false, true]) {
    const f = routerFixture({devicePermission,inputPermission}); f.state.lockout=true; await f.engine.initialize();
    f.arm('indoor-button'); const result=await f.offer('indoor-button',1002);
    if(devicePermission && inputPermission) assert.equal(result.result.fault,null);
    else { assert.deepEqual(f.state.commands,[]); assert.equal(f.state.locked,true); }
  }
  const f=routerFixture(); delete f.router.profiles.get('indoor-button').allowDuringOpenerLockout;
  f.state.lockout=true;await f.engine.initialize();f.arm('indoor-button');await f.offer('indoor-button',1002);
  assert.deepEqual(f.state.commands,[]);assert.equal(f.state.locked,true);
});

test('lockout exception does not override disabled, obstruction, or undifferentiated blocked flags', async () => {
  for (const flags of [{ lockout: true, disabled: true }, { lockout: true, obstruction: true }, { blocked: true }]) {
    const f = routerFixture(); Object.assign(f.state, flags); await f.engine.initialize();
    f.arm('indoor-button'); assert.equal((await f.offer('indoor-button', 1002)).accepted, false);
    assert.deepEqual(f.state.commands, []); assert.equal(f.state.locked, true);
  }
});

test('fresh stable closure permits a physical recovery from lockout hold but never another fault', async () => {
  const f = routerFixture(); await f.engine.initialize(); f.state.lockout = true;
  await f.router.builtin('homekit', 'open'); assert.equal(f.engine.state.fault, 'door_blocked');
  await f.engine.observe(); assert.equal(f.engine.state.closedObservedDuringFault, true);
  f.arm('indoor-button'); assert.equal((await f.offer('indoor-button', 1002)).result.fault, null);
  assert.deepEqual(f.state.commands, [['wall-relay', 'open']]);
  f.state.door = 'closed'; await f.engine.fail('bolt_resource_identity_mismatch'); await f.engine.observe();
  f.arm('indoor-button'); assert.equal((await f.offer('indoor-button', 1002)).accepted, false);
  assert.equal(f.state.commands.length, 1);
});

test('a late disabled flag or uncertain position blocks physical lockout recovery', async () => {
  for (const change of [s => { s.disabled = true; }, s => { s.door = 'not-closed'; s.locked = false; }]) {
    const f = routerFixture(); await f.engine.initialize(); f.state.lockout = true;
    await f.router.builtin('homekit', 'open'); await f.engine.observe();
    f.arm('indoor-button'); change(f.state); await f.offer('indoor-button', 1002);
    assert.deepEqual(f.state.commands, []);
  }
});
