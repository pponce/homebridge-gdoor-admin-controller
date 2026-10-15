import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeconzSeparateBolt } from '../src/separate-bolt.js';
import { MovementEngine } from '../src/engine.js';
import { validateConfiguration } from '../src/config.js';
import { Diagnostics } from '../src/diagnostics.js';
import { Fault } from '../src/fault.js';
import { CoordinatorRuntime } from '../src/runtime.js';
import { loadIdentity } from '../src/storage.js';
import { hardwareFixture } from './support/hardware.mjs';
import { selectConnection, updateConnection } from '../homebridge-ui/public/connections.js';

const example = JSON.parse(await readFile(new URL('../examples/separate-bolt-config.json', import.meta.url)));
function fixture({ momentary = true, readOnly = false } = {}) {
  const config = structuredClone(example.controllers[0].bolt); config.momentary = momentary;
  if (!momentary) delete config.pulseSeconds;
  const state = { now: 0, outputs: { '3': false, '4': false }, writes: [], requests: [], readError: false,
    door: 'closed', journal: { inProgress: false, fault: false } };
  const clock = { now: () => state.now, sleep: async ms => { state.now += ms; await state.sleep?.(ms); } };
  const request = async ({ url, method = 'GET', body }) => {
    const path = new URL(url).pathname; state.requests.push([method, path]);
    if (method === 'GET' && state.readError) throw Error('synthetic disconnect');
    if (path.endsWith('/config')) return { bridgeid: state.gatewayId ?? config.gatewayId };
    const match = /\/lights\/(\d+)(\/state)?$/.exec(path); assert.ok(match, path);
    const id = match[1], row = id === '3' ? config.lockRelay : config.unlockRelay;
    if (method === 'GET') return { uniqueid: state.badIdentity === id ? 'replacement' : row.uniqueId, type: row.resourceType,
      modelid: row.modelId, manufacturername: row.manufacturer, state: { reachable: state.unreachable !== id, on: state.outputs[id] } };
    assert.equal(method, 'PUT'); assert.equal(typeof body.on, 'boolean');
    state.writes.push([id, body.on, state.now]);
    if (!body.on && state.stuck === id) return [{ success: { ['/lights/' + id + '/state/on']: false } }];
    state.outputs[id] = body.on;
    assert.ok(!(state.outputs['3'] && state.outputs['4']), 'Opposing outputs must never be ON together');
    await state.onWrite?.(id, body.on);
    if (body.on && state.ambiguousOn) throw Error('response lost');
    if (!body.on && state.ambiguousOff) throw Error('response lost');
    return body.on && state.badAck ? [{ success: {} }] : [{ success: { ['/lights/' + id + '/state/on']: body.on } }];
  };
  const driver = () => new DeconzSeparateBolt(config, 'synthetic-key', { request, clock, readOnly });
  return { config, state, clock, request, driver, bolt: driver(), context: { beforeWrite: async () => {} } };
}
function engineFixture(options = {}) {
  const f = fixture(options), { state, clock, bolt } = f;
  const door = { capabilities: { directional: true },
    read: async () => ({ door: state.door, blocked: false, obstruction: false, evidence: 'closed-sensor' }),
    write: async (command, { beforeWrite }) => {
      await beforeWrite(); assert.equal(state.journal.inProgress, true); assert.equal((await bolt.read()).locked, false);
      state.writes.push(['door', command, state.now]); state.door = command === 'close' ? 'closed' : 'not-closed';
    } };
  const engine = new MovementEngine({ door, bolt, clock,
    journal: { read: async () => structuredClone(state.journal), write: async value => { state.journal = value; } },
    feedback: { opening: 'timed', closing: 'sensor', bolt: bolt.momentary ? 'command' : 'relay', allowEstimatedBolting: false },
    timing: { pollMs: 10, motionTimeoutMs: 1000, openingMs: 100, closedStableMs: 20,
      openRetractSettleMs: 20, closeRetractSettleMs: 0, boltSettleMs: 20 } });
  return { ...f, engine };
}

test('two-output configuration defaults to 0.2s, requires one Lock tile and reserves both outputs', () => {
  const config = structuredClone(example), p = config.controllers[0]; delete p.bolt.pulseSeconds;
  assert.equal(validateConfiguration(config).controllers[0].bolt.pulseSeconds, .2);
  p.exposeBoltLock = false; assert.throws(() => validateConfiguration(config), /separate_bolt_lock_tile_required/); p.exposeBoltLock = true;
  for (const key of ['resourceId', 'uniqueId']) {
    const copy = structuredClone(config); copy.controllers[0].bolt.unlockRelay[key] = copy.controllers[0].bolt.lockRelay[key];
    assert.throws(() => validateConfiguration(copy), /duplicate_hardware_owner/);
  }
  for (const relay of ['lockRelay', 'unlockRelay']) {
    const copy = structuredClone(config), b = copy.controllers[0].bolt;
    copy.controllers[0].boltControlEnabled = false;
    copy.controllers[0].motorPaths = [{ id: 'motor', name: 'Motor', type: 'pulse-relay',
      connection: { type: b.type, baseUrl: b.baseUrl, gatewayId: b.gatewayId, credentialRef: b.credentialRef, ...b[relay], activeValue: true },
      openPulseSeconds: .2, closePulseSeconds: .2, interruption: 'disabled' }];
    assert.throws(() => validateConfiguration(copy), /duplicate_hardware_owner/);
  }
});

test('invalid pulse, feedback, mixed mappings and incomplete identities cannot be saved', () => {
  for (const mutate of [p => p.bolt.pulseSeconds = 0, p => p.bolt.pulseSeconds = 2.1, p => p.bolt.pulseSeconds = '0.2',
    p => p.bolt.momentary = 'true', p => p.feedback.bolt = 'relay', p => p.bolt.lockedValue = true,
    p => delete p.bolt.lockRelay.modelId, p => p.bolt.unlockRelay.baseUrl = 'http://elsewhere.invalid']) {
    const config = structuredClone(example); mutate(config.controllers[0]); assert.throws(() => validateConfiguration(config));
  }
  const config = structuredClone(example), p = config.controllers[0]; p.bolt.momentary = false; delete p.bolt.pulseSeconds;
  assert.throws(() => validateConfiguration(config), /invalid_bolt_feedback/);
  p.feedback.bolt = 'relay'; assert.equal(validateConfiguration(config).controllers[0].bolt.momentary, false);
});

test('shared connection changes update the pair and selecting a different gateway clears both identities', () => {
  const config = validateConfiguration(example), b = config.controllers[0].bolt;
  const connection = config.connections.find(c => c.type === 'deconz');
  updateConnection(config, connection.id, { ...connection, credentialRef: 'new-key' });
  assert.equal(config.controllers[0].bolt.credentialRef, 'new-key');
  assert.deepEqual(config.controllers[0].bolt.lockRelay, b.lockRelay);
  selectConnection(b, { ...connection, baseUrl: 'http://another.example.invalid' });
  assert.deepEqual(b.lockRelay, {}); assert.deepEqual(b.unlockRelay, {}); assert.equal(b.gatewayId, undefined);
});

test('read-only checks report unknown for released pulse outputs and never actuate', async () => {
  const f = fixture({ readOnly: true }); assert.deepEqual(await f.bolt.read(), { locked: null, evidence: 'command' });
  await assert.rejects(f.bolt.write(false, f.context), /actuation_disabled/); assert.deepEqual(f.state.writes, []);
  const config = validateConfiguration(example);
  const probe = await new Diagnostics(config, async () => ({ [f.config.credentialRef]: 'synthetic-key', [config.controllers[0].door.credentialRef]: '123456' }), {
    request: async args => args.url.endsWith('/json') ? { result: 'OK', data: { door1: { index: 0, status: 'close', lockup: false, disabled: false } } } : f.request(args),
  }).probe(config.controllers[0].id);
  assert.equal(probe.compatible, true); assert.deepEqual(probe.bolt, { state: 'unknown', feedback: 'command', error: null });
  assert.deepEqual(f.state.writes, []);
});

test('pulses use the chosen output once and retain only a process-local command estimate', async () => {
  const f = fixture();
  for (const locked of [true, false]) {
    await f.bolt.write(locked, f.context);
    assert.deepEqual(await f.bolt.read(), { locked, evidence: 'command' });
    assert.deepEqual(f.state.outputs, { '3': false, '4': false });
  }
  assert.deepEqual(f.state.writes, [['3', true, 0], ['3', false, 200], ['4', true, 200], ['4', false, 400]]);
  assert.deepEqual(await f.driver().read(), { locked: null, evidence: 'command' });
});

test('maintained outputs break before make and both OFF remains unknown', async () => {
  const f = fixture({ momentary: false }); assert.equal((await f.bolt.read()).locked, null);
  f.state.outputs['3'] = true;
  await f.bolt.write(false, f.context); assert.deepEqual(await f.bolt.read(), { locked: false, evidence: 'relay' });
  await f.bolt.write(false, f.context);
  await f.bolt.write(true, f.context); assert.equal((await f.bolt.read()).locked, true);
  assert.deepEqual(f.state.writes.map(w => w.slice(0, 2)), [['3', false], ['4', true], ['4', false], ['3', true]]);
  assert.equal((await f.driver().read()).locked, true);
});

for (const failure of ['ambiguousOn', 'badAck', 'stuck']) test('failed pulse ' + failure + ' releases and never retries ON or claims a position', async () => {
  const f = fixture(); f.state[failure] = failure === 'stuck' ? '3' : true;
  await assert.rejects(f.bolt.write(true, f.context), failure === 'ambiguousOn' ? /bolt_write_ambiguous/ : failure === 'badAck' ? /bolt_write_unconfirmed/ : /bolt_relay_release_unconfirmed/);
  assert.equal(f.state.writes.filter(w => w[1]).length, 1); assert.equal(f.bolt.lastCommand, null);
  assert.equal(f.state.writes.at(-1)[1], false);
  if (failure !== 'stuck') assert.equal(f.state.outputs['3'], false);
});

test('lost OFF acknowledgement can be resolved by a fresh OFF read without another pulse', async () => {
  const f = fixture(); f.state.ambiguousOff = true;
  await f.bolt.write(false, f.context); assert.equal((await f.bolt.read()).locked, false);
  assert.equal(f.state.writes.length, 2);
});

test('failed opposite release prevents the new direction, with no ON fallback', async () => {
  const f = fixture({ momentary: false }); f.state.outputs['3'] = true; f.state.stuck = '3';
  await assert.rejects(f.bolt.write(false, f.context), /bolt_relay_release_unconfirmed/);
  assert.deepEqual(f.state.writes.map(w => w.slice(0, 2)), Array(3).fill(['3', false]));
});

test('identity, reachability, both-ON and active pulse outputs hold before writing', async () => {
  for (const mutate of [s => s.badIdentity = '3', s => s.badIdentity = '4', s => s.unreachable = '4',
    s => s.gatewayId = 'FFEEDDCCBBAA9988', s => { s.outputs['3'] = s.outputs['4'] = true; }, s => s.outputs['4'] = true]) {
    const f = fixture(); mutate(f.state);
    await assert.rejects(f.bolt.write(false, f.context)); assert.deepEqual(f.state.writes, []);
  }
});

test('external relay activity and read loss invalidate the last pulse estimate', async () => {
  for (const external of [true, false]) {
    const f = fixture(); await f.bolt.write(true, f.context);
    if (external) f.state.outputs['4'] = true; else f.state.readError = true;
    await assert.rejects(f.bolt.read());
    f.state.outputs['4'] = false; f.state.readError = false;
    assert.equal((await f.bolt.read()).locked, null);
  }
});

test('shutdown and competing commands cannot overlap a pulse; shutdown releases the active output', async () => {
  const f = fixture();
  f.state.sleep = async () => {
    await assert.rejects(f.bolt.write(false, f.context), /bolt_relay_busy/); f.bolt.stop();
  };
  await assert.rejects(f.bolt.write(true, f.context), /operation_interrupted/);
  assert.deepEqual(f.state.writes.map(w => w.slice(0, 2)), [['3', true], ['3', false]]);
  assert.equal(f.bolt.lastCommand, null);
});

test('long ON acknowledgement does not add another full pulse delay', async () => {
  const f = fixture(); f.state.onWrite = async (_id, on) => { if (on) f.state.now += 500; };
  await f.bolt.write(true, f.context); assert.equal(f.state.writes[1][2], 500);
});

for (const momentary of [true, false]) test('engine with separate relays ' + momentary + ' starts unknown, retracts before motion and locks only after closed', async () => {
  const f = engineFixture({ momentary }); await f.engine.initialize(); await f.engine.observe();
  assert.equal(f.engine.initialized, true); assert.equal(f.engine.state.bolt, 'unknown'); assert.deepEqual(f.state.writes, []);
  f.state.onWrite = async (id, on) => { assert.equal(f.state.journal.inProgress, true); if (id === '3' && on) assert.equal(f.state.door, 'closed'); };
  await f.engine.execute('open'); assert.equal(f.engine.state.fault, null); assert.equal(f.engine.state.phase, 'open');
  assert.equal(f.engine.state.bolt, 'unlocked'); assert.equal(f.engine.state.boltEstimated, momentary ? true : undefined);
  await f.engine.execute('close'); assert.equal(f.engine.state.fault, null); assert.equal(f.engine.state.phase, 'closed');
  assert.equal(f.engine.state.bolt, 'locked');
  assert.deepEqual(f.state.writes.map(w => w.slice(0, 2)), momentary ?
    [['4', true], ['4', false], ['door', 'open'], ['door', 'close'], ['3', true], ['3', false]] :
    [['4', true], ['door', 'open'], ['door', 'close'], ['4', false], ['3', true]]);
});

test('unknown pulse position at zero-wait close still completes and releases an unlock pulse before the motor', async () => {
  const f = engineFixture(); f.state.door = 'not-closed'; await f.engine.initialize();
  await f.engine.execute('close'); assert.equal(f.engine.state.fault, null);
  assert.deepEqual(f.state.writes.slice(0, 3).map(w => w.slice(0, 2)), [['4', true], ['4', false], ['door', 'close']]);
});

test('one logical lock/unlock command runs the matching pulse and preserves manual-unlock override', async () => {
  const f = engineFixture(); await f.engine.initialize();
  await f.engine.execute('lock'); assert.equal(f.engine.state.bolt, 'locked');
  await f.engine.execute('unlock'); assert.equal(f.engine.state.bolt, 'unlocked');
  await f.engine.observe(); assert.equal(f.engine.state.externalUnlockOverride, true);
  await assert.rejects(f.engine.execute('observed-close'), /manual_unlock_override/);
  f.state.door = 'not-closed'; await f.engine.execute('lock');
  assert.equal(f.engine.state.fault, 'locking_requires_closed_sensor');
  assert.deepEqual(f.state.writes.map(w => w.slice(0, 2)), [['3', true], ['3', false], ['4', true], ['4', false]]);
});

test('door movement during opposite-output release blocks extension', async () => {
  const f = engineFixture({ momentary: false }); f.state.outputs['4'] = true; await f.engine.initialize();
  f.state.onWrite = async (_id, on) => { if (!on) f.state.door = 'not-closed'; };
  await f.engine.execute('lock'); assert.equal(f.engine.state.fault, 'closed_confirmation_lost');
  assert.deepEqual(f.state.writes.map(w => w.slice(0, 2)), [['4', false]]);
});

test('failed bolt pulse blocks motor movement and remains held through observation and restart', async () => {
  const f = engineFixture(); await f.engine.initialize(); f.state.ambiguousOn = true;
  await f.engine.execute('open'); assert.equal(f.engine.state.fault, 'bolt_write_ambiguous');
  assert.equal(f.engine.state.bolt, 'unknown'); assert.equal(f.engine.state.boltEstimated, false);
  await f.engine.observe(); assert.equal(f.engine.state.fault, 'bolt_write_ambiguous');
  assert.equal(f.state.writes.some(w => w[0] === 'door'), false);
  for (const previous of [f.state.journal, { inProgress: true, fault: false }]) {
    const restarted = engineFixture(); restarted.state.journal = previous; await restarted.engine.initialize();
    assert.equal(restarted.engine.initialized, false); assert.deepEqual(restarted.state.writes, []);
    await restarted.engine.initialize({ acknowledge: true }); assert.equal(restarted.engine.initialized, true);
    assert.equal(restarted.engine.state.bolt, 'unknown'); assert.deepEqual(restarted.state.writes, []);
  }
});

async function runtimeFixture(t) {
  const hw = await hardwareFixture(example.controllers[0]);
  const storagePath = await mkdtemp(join(tmpdir(), 'separate-bolt-runtime-')); await loadIdentity(storagePath);
  const runtimes = []; t.after(async () => { for (const r of runtimes) await r.stop(); await hw.close(); await rm(storagePath, { recursive: true, force: true }); });
  Object.assign(hw.config.feedback, { openingSeconds: 1, closedStableSeconds: 0, boltSettleSeconds: 0 });
  hw.config.timing = { openRetractSettleSeconds: 0, closeRetractSettleSeconds: 0, idlePollSeconds: 30 };
  let now = 0; const clock = { now: () => now, sleep: async ms => { now += ms; } };
  const start = async () => { const r = new CoordinatorRuntime({ storagePath, configuration: { controllers: [hw.config] }, credentials: async () => hw.credentials, clock }); runtimes.push(r); await r.start(); return r; };
  const runtime = await start(), id = hw.config.id;
  const commission = () => runtime.commission(id, { revision: runtime.state.revision, previousControllerStopped: true, physicalSetupReviewed: true });
  return { hw, runtime, id, start, commission, clock };
}

test('production runtime commissions with OFF outputs, preserves one Lock tile preference and does not restore pulse estimates', async t => {
  const { hw, runtime, id, start, commission } = await runtimeFixture(t);
  await commission();
  assert.equal(runtime.status(id).actuationEnabled, true); assert.equal(runtime.status(id).state.bolt, 'unknown');
  assert.deepEqual(hw.state.writes, []);
  await runtime.entry(id).engine.execute('open'); assert.equal(runtime.status(id).state.bolt, 'unlocked');
  await runtime.entry(id).engine.execute('close'); assert.equal(runtime.status(id).state.bolt, 'locked');
  const writes = structuredClone(hw.state.writes); await runtime.stop();
  const restarted = await start(); assert.equal(restarted.status(id).actuationEnabled, true);
  assert.equal(restarted.status(id).state.bolt, 'unknown'); assert.deepEqual(hw.state.writes, writes);
  assert.equal(restarted.configuration.controllers[0].exposeBoltLock, true);
  await assert.rejects(restarted.stationary(), /physical_stationary_confirmation_required/, 'An estimate must not pass a maintenance check that requires locked feedback');
});

test('pulse-only edits retain setup and enablement through save and restart, and use the new duration', async t => {
  const f = await runtimeFixture(t); await f.commission(); let runtime = f.runtime;
  for (const seconds of [.1, .2]) {
    const draft = runtime.settings(); draft.configuration.controllers[0].bolt.pulseSeconds = seconds;
    const writes = structuredClone(f.hw.state.writes);
    const review = await runtime.review(draft.configuration, draft.revision);
    assert.deepEqual(review.requiresCommissioning, []);
    await runtime.apply(review.token);
    for (const key of ['enabled', 'configurationValid', 'actuationEnabled']) assert.equal(runtime.status(f.id)[key], true, key);
    assert.deepEqual(f.hw.state.writes, writes, 'Saving a pulse length cannot operate the bolt');
    await runtime.stop(); runtime = await f.start();
    for (const key of ['enabled', 'configurationValid', 'actuationEnabled']) assert.equal(runtime.status(f.id)[key], true, key);
    assert.equal(runtime.status(f.id).state.bolt, 'unknown');
    assert.equal(runtime.configuration.controllers[0].exposeBoltLock, true);
    assert.equal(runtime.configuration.controllers[0].bolt.pulseSeconds, seconds);
    assert.deepEqual(f.hw.state.writes, writes, 'Restart cannot operate the bolt');
    for (const [command, state] of [['unlock', 'unlocked'], ['lock', 'locked']]) {
      const before = f.clock.now(); await runtime.entry(f.id).engine.execute(command);
      assert.equal(runtime.status(f.id).state.bolt, state);
      assert.equal(runtime.status(f.id).state.fault, null);
      assert.equal(f.clock.now() - before, seconds * 1000, 'The next pulse uses the saved duration');
    }
    assert.deepEqual(f.hw.state.writes.slice(writes.length), [['bolt-unlock', true], ['bolt-unlock', false], ['bolt-lock', true], ['bolt-lock', false]]);
  }
});

test('pulse edits preserve disabled choices and never approve a new or already unapproved mapping', async t => {
  const f = await runtimeFixture(t), { runtime, id } = f;
  let draft = runtime.settings(); draft.configuration.controllers[0].bolt.pulseSeconds = .1;
  let review = await runtime.review(draft.configuration, draft.revision);
  assert.deepEqual(review.requiresCommissioning, [id]); await runtime.apply(review.token);
  assert.equal(runtime.status(id).configurationValid, false); assert.equal(runtime.status(id).enabled, false);
  await f.commission(); await runtime.disable(id, { revision: runtime.state.revision, bootId: runtime.bootId });
  draft = runtime.settings(); draft.configuration.controllers[0].bolt.pulseSeconds = .2;
  review = await runtime.review(draft.configuration, draft.revision);
  assert.deepEqual(review.requiresCommissioning, []); await runtime.apply(review.token);
  assert.equal(runtime.status(id).configurationValid, true); assert.equal(runtime.status(id).enabled, false);
  assert.equal(runtime.status(id).actuationEnabled, false);
  await runtime.stop(); const restarted = await f.start();
  assert.equal(restarted.status(id).configurationValid, true); assert.equal(restarted.status(id).enabled, false);
  draft = restarted.settings(); draft.configuration.controllers[0].bolt.lockRelay.resourceId = '7';
  review = await restarted.review(draft.configuration, draft.revision); await restarted.apply(review.token);
  draft = restarted.settings(); draft.configuration.controllers[0].bolt.pulseSeconds = .1;
  review = await restarted.review(draft.configuration, draft.revision);
  assert.deepEqual(review.requiresCommissioning, [id]); await restarted.apply(review.token);
  assert.equal(restarted.status(id).configurationValid, false); assert.equal(restarted.status(id).actuationEnabled, false);
  assert.deepEqual(f.hw.state.writes, []);
});

test('pulse tuning cannot mask changed relay selection, wiring mode, connection or control policy', async t => {
  const f = await runtimeFixture(t); await f.commission();
  const changes = [
    ['lock relay', p => p.bolt.lockRelay.resourceId = '7'],
    ['unlock relay', p => p.bolt.unlockRelay.resourceId = '8'],
    ['swapped directions', p => [p.bolt.lockRelay, p.bolt.unlockRelay] = [p.bolt.unlockRelay, p.bolt.lockRelay]],
    ['endpoint identity', p => p.bolt.lockRelay.uniqueId = 'replacement-output'],
    ['relay model', p => p.bolt.unlockRelay.modelId = 'REPLACEMENT'],
    ['gateway identity', p => p.bolt.gatewayId = '8899aabbccddeeff'],
    ['gateway address', p => p.bolt.baseUrl = 'http://replacement.example.invalid'],
    ['credential reference', p => p.bolt.credentialRef = 'replacement-key'],
    ['maintained outputs', p => { p.bolt.momentary = false; delete p.bolt.pulseSeconds; p.feedback.bolt = 'relay'; }],
    ['single relay', p => { const b = p.bolt; p.bolt = { type: b.type, baseUrl: b.baseUrl, gatewayId: b.gatewayId,
      credentialRef: b.credentialRef, ...b.lockRelay, lockedValue: true }; p.feedback.bolt = 'relay'; }],
    ['bolt control disabled', p => p.boltControlEnabled = false],
    ['automatic bolting', p => p.autoBolt = !p.autoBolt],
  ];
  for (const [name, change] of changes) {
    const draft = f.runtime.settings(), profile = draft.configuration.controllers[0];
    profile.bolt.pulseSeconds = .1; change(profile);
    const review = await f.runtime.review(draft.configuration, draft.revision);
    assert.deepEqual(review.requiresCommissioning, [f.id], name);
  }
  assert.deepEqual(f.hw.state.writes, []);
});

test('pulse tuning retains approval without clearing a failed-operation hold', async t => {
  const f = await runtimeFixture(t); await f.commission();
  await f.runtime.entry(f.id).engine.fail('bolt_write_ambiguous');
  const draft = f.runtime.settings(); draft.configuration.controllers[0].bolt.pulseSeconds = .1;
  const review = await f.runtime.review(draft.configuration, draft.revision);
  assert.deepEqual(review.requiresCommissioning, []); await f.runtime.apply(review.token);
  for (const key of ['enabled', 'configurationValid']) assert.equal(f.runtime.status(f.id)[key], true);
  assert.equal(f.runtime.status(f.id).actuationEnabled, false);
  assert.equal(f.runtime.status(f.id).lastFault.reason, 'bolt_write_ambiguous');
  await f.runtime.stop(); const restarted = await f.start();
  assert.equal(restarted.status(f.id).configurationValid, true);
  assert.equal(restarted.status(f.id).actuationEnabled, false);
  assert.deepEqual(f.hw.state.writes, []);
});
