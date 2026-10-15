import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateConfiguration, inventory } from '../src/config.js';
import { MovementEngine } from '../src/engine.js';
import { Fault } from '../src/fault.js';
import { CoordinatorRuntime } from '../src/runtime.js';
import { Diagnostics } from '../src/diagnostics.js';
import { WebAdminController } from '../src/web-admin-controller.js';
import { StateJournal } from '../src/journal.js';
import { loadIdentity } from '../src/storage.js';
import { hardwareFixture } from './support/hardware.mjs';

const example = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url)));

test('bolt control defaults to the original normalized profile and requires an explicit boolean opt-out', () => {
  const old = validateConfiguration(example);
  const config = structuredClone(example); config.controllers[0].boltControlEnabled = true;
  assert.deepEqual(validateConfiguration(config), old, 'Existing commissioning hashes must remain valid');
  for (const invalid of ['false', 0, null]) {
    config.controllers[0].boltControlEnabled = invalid;
    assert.throws(() => validateConfiguration(config), /invalid_bolt_control_enabled/);
  }
  config.controllers[0].boltControlEnabled = false;
  const off = validateConfiguration(config);
  assert.deepEqual(off.controllers[0].bolt, old.controllers[0].bolt);
  assert.equal(inventory(off)[0].exposeBoltLock, false);
  for (const absent of [undefined, null]) {
    config.controllers[0].bolt = absent;
    const normalized = validateConfiguration(config);
    assert.equal(normalized.controllers[0].bolt, null);
    assert.equal(inventory(normalized)[0].boltBackend, null);
  }
  delete config.controllers[0].boltControlEnabled;
  assert.throws(() => validateConfiguration(config), /door_and_bolt_required/);
});

test('a retained disabled bolt output stays reserved against competing motor ownership', () => {
  const config = structuredClone(example); const p = config.controllers[0]; p.boltControlEnabled = false;
  const { lockedValue, ...connection } = p.bolt;
  p.motorPaths = [{ id: 'relay', name: 'Motor', type: 'pulse-relay', connection: { ...connection, activeValue: true },
    openPulseSeconds: .1, closePulseSeconds: .1, interruption: 'disabled' }];
  assert.throws(() => validateConfiguration(config), /duplicate_hardware_owner/);
});

function engineFixture(options = {}) {
  const state = { now: 0, door: 'closed', writes: [], blocked: false, obstruction: false, journal: { inProgress: false, fault: false } };
  const engine = new MovementEngine({ boltControlEnabled: false,
    bolt: { read() { assert.fail('Disabled bolt read'); }, write() { assert.fail('Disabled bolt write'); } },
    door: { read: async () => ({ door: state.door, blocked: state.blocked, obstruction: state.obstruction, evidence: 'closed-sensor' }),
      write: async (command, { beforeWrite }) => { await beforeWrite(); assert.equal(state.journal.inProgress, true);
        state.writes.push([command, state.now]); state.door = command === 'close' ? 'closed' : 'not-closed';
        options.write?.(command); } },
    clock: { now: () => state.now, sleep: async ms => { state.now += ms; } },
    journal: { read: async () => state.journal, write: async value => { state.journal = value; } },
    feedback: { opening: 'timed', closing: 'sensor', bolt: 'relay', allowEstimatedBolting: false, ...options.feedback },
    timing: { pollMs: 10, openingMs: 100, closingMs: 100, closedStableMs: 20, motionTimeoutMs: 1000,
      openRetractSettleMs: 120000, closeRetractSettleMs: 120000, boltSettleMs: 120000 } });
  return { state, engine };
}

test('door-only open and close skip every bolt delay without claiming unlocked feedback', async () => {
  const { state, engine } = engineFixture(); await engine.initialize();
  assert.equal(engine.state.bolt, 'disabled'); assert.equal(engine.sample.locked, null);
  for (const command of ['lock', 'unlock', 'observed-close']) await assert.rejects(engine.execute(command), /bolt_control_disabled/);
  assert.deepEqual(state.journal, { inProgress: false, fault: false });
  await engine.execute('open'); assert.equal(engine.state.phase, 'open'); assert.equal(state.now, 100);
  await engine.execute('close'); assert.equal(engine.state.phase, 'closed'); assert.equal(state.now, 120);
  assert.deepEqual(state.writes, [['open', 0], ['close', 100]]);
  await engine.execute('close'); assert.equal(state.writes.length, 2, 'Already closed cannot pulse the opener');
  state.door = 'not-closed'; await engine.observe(); state.door = 'closed'; await engine.observe();
  assert.equal(engine.autoClosePending, false); assert.equal(engine.state.bolt, 'disabled');
});

test('door-only timed closing remains an estimate and needs no estimated-bolting permission', async () => {
  const { state, engine } = engineFixture({ feedback: { closing: 'timed' } });
  state.door = 'not-closed'; await engine.initialize(); await engine.execute('close');
  assert.equal(engine.state.fault, null); assert.equal(engine.state.closeEstimated, true);
  assert.equal(engine.state.bolt, 'disabled'); assert.equal(state.now, 120);
});

test('disabling the bolt retains door obstruction, lockout, ambiguous-write and restart protections', async () => {
  for (const flag of ['blocked', 'obstruction']) {
    const f = engineFixture(); await f.engine.initialize(); f.state[flag] = true;
    await f.engine.execute('open'); assert.ok(f.engine.state.fault); assert.deepEqual(f.state.writes, []);
  }
  const f = engineFixture({ write() { throw new Fault('door_write_ambiguous'); } });
  await f.engine.initialize(); await f.engine.execute('open');
  assert.equal(f.engine.state.fault, 'door_write_ambiguous'); assert.equal(f.state.journal.fault, true);
  await assert.rejects(f.engine.execute('open'), /engine_unavailable/); assert.equal(f.state.writes.length, 1);
});

async function runtimeFixture(t, { missingMapping = false } = {}) {
  const storagePath = await mkdtemp(join(tmpdir(), 'optional-bolt-')); await loadIdentity(storagePath);
  const hardware = await hardwareFixture(example.controllers[0]);
  const profile = structuredClone(hardware.config); profile.boltControlEnabled = false;
  profile.timing = { idlePollSeconds: 30, openRetractSettleSeconds: 90, closeRetractSettleSeconds: 90 };
  Object.assign(profile.feedback, { openingSeconds: 1, closedStableSeconds: 0, boltSettleSeconds: 60 });
  const retained = structuredClone(profile.bolt); if (missingMapping) profile.bolt = null;
  hardware.state.reachable = false; hardware.state.modelId = 'WRONG-FIRMWARE';
  const credentials = { [profile.door.credentialRef]: '123456' }; // No bolt credential is available.
  const config = { ...example, controllers: [profile] }; let now = 0;
  const clock = { now: () => now, wall: () => Date.now(), sleep: async ms => { now += ms; } };
  const create = () => new CoordinatorRuntime({ storagePath, configuration: config, credentials: async () => credentials, clock });
  const runtime = create();
  t.after(async () => { await runtime.stop(); await hardware.close(); await rm(storagePath, { recursive: true, force: true }); });
  await runtime.start();
  const id = profile.id;
  const commission = (r = runtime) => r.commission(id, { revision: r.state.revision, previousControllerStopped: true, physicalSetupReviewed: true });
  const command = (name, r = runtime) => ({ command: name, requestId: randomUUID(), issuedAt: Date.now(), bootId: r.bootId });
  return { runtime, create, commission, command, id, hardware, storagePath, credentials, retained };
}

for (const missingMapping of [false, true]) test(`door-only production drivers work with ${missingMapping ? 'no bolt mapping' : 'a failed saved relay and no bolt key'}`, async t => {
  const f = await runtimeFixture(t, { missingMapping });
  assert.deepEqual(f.hardware.state.requests, []);
  assert.equal(f.runtime.status(f.id).state.bolt, 'disabled');
  const probe = await new Diagnostics(f.runtime.configuration, async () => f.credentials).probe(f.id);
  assert.equal(probe.compatible, true); assert.deepEqual(probe.bolt, { state: 'disabled', feedback: 'disabled', error: null });
  await f.commission(); assert.equal(f.runtime.status(f.id).actuationEnabled, true);
  assert.deepEqual(f.hardware.state.writes, []);
  const projected = new WebAdminController(f.runtime).read().controllers[0];
  assert.equal(projected.boltControlEnabled, false); assert.equal(projected.feedback.bolt, 'disabled');
  for (const command of ['lock', 'unlock']) await assert.rejects(f.runtime.submit(f.id, f.command(command)), /bolt_control_disabled/);
  await f.runtime.submit(f.id, f.command('open')); await f.runtime.entry(f.id).job;
  assert.equal(f.runtime.status(f.id).state.phase, 'open');
  await f.runtime.submit(f.id, f.command('close'), 'virtual-keypad'); await f.runtime.entry(f.id).job;
  assert.equal(f.runtime.status(f.id).state.phase, 'closed');
  assert.deepEqual(f.hardware.state.writes, [['door', 'open'], ['door', 'close']]);
  await f.runtime.stationary(); await f.runtime.maintenance('pause', 'off-mode');
  await f.runtime.maintenance('verify', 'off-mode'); await f.runtime.maintenance('resume', 'off-mode'); await f.runtime.maintenance('complete', 'off-mode');
  await f.runtime.stop(); const second = f.create(); t.after(() => second.stop()); await second.start();
  assert.equal(second.status(f.id).actuationEnabled, true); assert.equal(second.status(f.id).state.bolt, 'disabled');
  await second.stop();
  await new StateJournal(f.storagePath, f.id).write({ inProgress: true, fault: false });
  f.hardware.state.closed = false;
  const interrupted = f.create(); t.after(() => interrupted.stop()); await interrupted.start();
  assert.equal(interrupted.status(f.id).state.reconciling, true);
  assert.deepEqual(f.hardware.state.writes, [['door', 'open'], ['door', 'close']], 'Restart cannot replay a command');
  await interrupted.submit(f.id, f.command('close', interrupted)); await interrupted.entry(f.id).job;
  assert.equal(interrupted.status(f.id).state.phase, 'closed');
  assert.ok(f.hardware.state.requests.every(r => r.path === '/json'), 'No request may touch the disabled bolt gateway');
});

test('switching modes preserves the bolt settings and requires fresh approval and actual identity checks on re-enable', async t => {
  const f = await runtimeFixture(t); await f.commission();
  const changed = f.runtime.settings(); delete changed.configuration.controllers[0].boltControlEnabled;
  const review = await f.runtime.review(changed.configuration, changed.revision);
  assert.deepEqual(review.requiresCommissioning, [f.id]); await f.runtime.apply(review.token);
  assert.deepEqual(f.runtime.configuration.controllers[0].bolt, f.retained);
  assert.equal(f.runtime.status(f.id).actuationEnabled, false);
  await assert.rejects(f.commission(), /credential_reference_missing/);
  f.credentials[f.retained.credentialRef] = 'synthetic-deconz-key';
  await assert.rejects(f.commission(), /bolt_resource_identity_mismatch/);
  f.hardware.state.modelId = f.retained.modelId; f.hardware.state.reachable = true;
  await f.commission(); assert.equal(f.runtime.status(f.id).actuationEnabled, true);
  assert.equal(f.runtime.status(f.id).state.bolt, 'locked');
  const off = f.runtime.settings(); off.configuration.controllers[0].boltControlEnabled = false;
  const disableReview = await f.runtime.review(off.configuration, off.revision);
  assert.deepEqual(disableReview.requiresCommissioning, [f.id]); await f.runtime.apply(disableReview.token);
  assert.equal(f.runtime.status(f.id).actuationEnabled, false); assert.deepEqual(f.hardware.state.writes, []);
});
