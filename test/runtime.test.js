import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CoordinatorRuntime } from '../src/runtime.js';
import { loadIdentity } from '../src/storage.js';
import { createManagementServer, listenLocal, closeServer } from '../src/api.js';
import { hardwareFixture } from './support/hardware.mjs';
const example = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
async function fixture(t, multiple = false) {
  const storagePath = await mkdtemp(path.join(os.tmpdir(), 'coordinator-runtime-')); const identity = await loadIdentity(storagePath);
  const hardware = await hardwareFixture(example.controllers[0]);
  const other = multiple ? await hardwareFixture({ ...example.controllers[0], id: 'second-garage', name: 'Second garage',
    bolt: { ...example.controllers[0].bolt, gatewayId: '8899aabbccddeeff', uniqueId: 'second-bolt-endpoint' } }) : null;
  const config = { ...example, controllers: [hardware.config, ...(other ? [other.config] : [])] };
  config.controllers[0].timing = { idlePollSeconds: 30, openRetractSettleSeconds: 0, closeRetractSettleSeconds: 0 };
  config.controllers[0].feedback.openingSeconds = 1; config.controllers[0].feedback.closedStableSeconds = 0; config.controllers[0].feedback.boltSettleSeconds = 0;
  let now = 0; const clock = { now: () => now, wall: () => Date.now(), sleep: async ms => { now += ms; } };
  const runtime = new CoordinatorRuntime({ storagePath, configuration: config, credentials: async () => hardware.credentials, clock }); await runtime.start();
  const server = createManagementServer({ identity, configuration: config, runtime }); const port = await listenLocal(server, 0);
  async function call(endpoint, body) {
    const r = await fetch('http://127.0.0.1:' + port + endpoint, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + identity.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify({ instanceId: identity.instanceId, ...body }) } : {}) });
    return { status: r.status, value: await r.json() };
  }
  t.after(async () => { await runtime.stop(); await closeServer(server); await hardware.close(); await other?.close(); await rm(storagePath, { recursive: true, force: true }); });
  const id = config.controllers[0].id;
  const command = name => ({ command: name, requestId: randomUUID(), issuedAt: Date.now(), bootId: runtime.bootId });
  const commission = () => runtime.commission(id, { revision: runtime.state.revision, previousControllerStopped: true, physicalSetupReviewed: true });
  return { runtime, hardware, other, call, id, command, commission, storagePath, config, clock };
}
test('production runtime begins non-actuating, commissions through read-only checks, then coordinates real driver commands', async t => {
  const f = await fixture(t); assert.deepEqual(f.hardware.state.requests, []);
  assert.equal((await f.call('/v1/identity')).value.capabilities.motion, true);
  assert.equal(f.runtime.status(f.id).actuationEnabled, false);
  await assert.rejects(f.runtime.submit(f.id, f.command('open')), /controller_held/);
  await f.commission(); assert.deepEqual(f.hardware.state.writes, []);
  const request = f.command('open'); const first = await f.call('/v1/controllers/' + f.id + '/commands', request);
  assert.equal(first.status, 202); assert.equal(first.value.operation.accepted, true);
  const duplicate = await f.runtime.submit(f.id, request); assert.equal(duplicate.duplicate, true);
  await f.runtime.entry(f.id).job;
  assert.equal(f.runtime.status(f.id).state.phase, 'open');
  await f.runtime.submit(f.id, f.command('close')); await f.runtime.entry(f.id).job;
  assert.equal(f.runtime.status(f.id).state.phase, 'closed');
  assert.deepEqual(f.hardware.state.writes, [['bolt', false], ['door', 'open'], ['door', 'close'], ['bolt', true]]);
});
test('review/apply enforces revisions, invalidates changed commissioning and does not move hardware', async t => {
  const f = await fixture(t); await f.commission(); const before = f.runtime.settings();
  const changed = structuredClone(before.configuration); changed.controllers[0].timing.openRetractSettleSeconds = 1;
  const review = await f.runtime.review(changed, before.revision);
  await assert.rejects(f.runtime.review(changed, before.revision + 1), /revision_conflict/);
  await f.runtime.apply(review.token);
  assert.equal(f.runtime.settings().revision, before.revision + 1); assert.equal(f.runtime.status(f.id).actuationEnabled, false);
  await assert.rejects(f.runtime.apply(review.token), /review_expired/);
  assert.deepEqual(f.hardware.state.writes, []);
});
test('durable maintenance survives restart and all stages require the matching transaction', async t => {
  const f = await fixture(t); await f.commission(); await f.runtime.maintenance('pause', 'transaction-1');
  await assert.rejects(f.runtime.submit(f.id, f.command('open')), /held/);
  await f.runtime.stop();
  const second = new CoordinatorRuntime({ storagePath: f.storagePath, configuration: f.config, credentials: async () => f.hardware.credentials, clock: f.clock });
  t.after(() => second.stop()); await second.start(); assert.equal(second.status(f.id).held, 'maintenance');
  await assert.rejects(second.maintenance('complete', 'different'), /transaction_conflict/);
  await assert.rejects(second.maintenance('complete', 'transaction-1'), /verification_required/);
  await second.maintenance('verify', 'transaction-1'); await second.maintenance('resume', 'transaction-1'); await second.maintenance('complete', 'transaction-1');
  assert.equal(second.status(f.id).actuationEnabled, true); assert.deepEqual(f.hardware.state.writes, []);
});
test('ambiguous commands hold the garage and restart does not replay them', async t => {
  const f = await fixture(t); await f.commission(); f.hardware.state.ambiguousDoorWrite = true;
  const body = f.command('open'); await f.runtime.submit(f.id, body); await f.runtime.entry(f.id).job;
  assert.equal(f.runtime.status(f.id).state.phase, 'fault'); await f.runtime.stop(); const writes = [...f.hardware.state.writes];
  const second = new CoordinatorRuntime({ storagePath: f.storagePath, configuration: f.config, credentials: async () => f.hardware.credentials });
  t.after(() => second.stop()); await second.start(); assert.equal(second.status(f.id).actuationEnabled, false);
  await assert.rejects(second.submit(f.id, body), /request_invalid/); assert.deepEqual(f.hardware.state.writes, writes);
});

test('name-only edits preserve valid enablement through apply and restart without hardware writes', async t => {
  const f = await fixture(t); await f.commission();
  const renamed = f.runtime.settings(); renamed.configuration.controllers[0].name = 'Renamed garage';
  const review = await f.runtime.review(renamed.configuration, renamed.revision);
  assert.deepEqual(review.requiresCommissioning, []);
  await f.runtime.apply(review.token);
  assert.equal(f.runtime.status(f.id).actuationEnabled, true);
  assert.equal(f.runtime.configuration.controllers[0].id, f.id);
  await f.runtime.stop();
  const second = new CoordinatorRuntime({ storagePath: f.storagePath, configuration: f.config, credentials: async () => f.hardware.credentials, clock: f.clock });
  t.after(() => second.stop()); await second.start();
  assert.equal(second.status(f.id).actuationEnabled, true);
  assert.equal(second.configuration.controllers[0].name, 'Renamed garage');
  assert.deepEqual(f.hardware.state.writes, []);
});
test('renaming never enables a disabled garage or preserves changed hardware/behavior', async t => {
  const f = await fixture(t);
  let draft = f.runtime.settings(); draft.configuration.controllers[0].name = 'Disabled rename';
  let review = await f.runtime.review(draft.configuration, draft.revision);
  assert.deepEqual(review.requiresCommissioning, [f.id]); await f.runtime.apply(review.token);
  assert.equal(f.runtime.status(f.id).actuationEnabled, false);
  await f.commission();
  draft = f.runtime.settings(); draft.configuration.controllers[0].name = 'Changed behavior';
  draft.configuration.controllers[0].timing.closeRetractSettleSeconds = 1;
  review = await f.runtime.review(draft.configuration, draft.revision);
  assert.deepEqual(review.requiresCommissioning, [f.id]); await f.runtime.apply(review.token);
  assert.equal(f.runtime.status(f.id).actuationEnabled, false);
  assert.deepEqual(f.hardware.state.writes, []);
});
test('disable is durable, rejects stale or busy requests, sends no commands and preserves another controller', async t => {
  const f = await fixture(t, true); await f.commission();
  await f.runtime.commission('second-garage', { revision: f.runtime.state.revision, previousControllerStopped: true, physicalSetupReviewed: true });
  const otherEntry = f.runtime.entry('second-garage'), otherEngine = otherEntry.engine;
  const body = { revision: f.runtime.state.revision, bootId: f.runtime.bootId };
  const endpoint = '/v1/controllers/' + f.id + '/disable';
  assert.equal((await f.call(endpoint, { ...body, bootId: 'stale' })).status, 409);
  assert.equal((await f.call(endpoint, { ...body, revision: 0 })).status, 409);
  assert.equal((await f.call(endpoint, { ...body, unexpected: true })).status, 409);
  const entry = f.runtime.entry(f.id);
  for (const pending of ['job', 'observation', 'input']) {
    if (pending === 'job') entry.job = true;
    if (pending === 'observation') entry.engine.observation = Promise.resolve();
    if (pending === 'input') entry.router.activeInput = 'synthetic-input';
    assert.equal((await f.call(endpoint, body)).status, 409);
    assert.equal(f.runtime.status(f.id).actuationEnabled, true);
    entry.job = null; entry.engine.observation = null; entry.router.activeInput = null;
  }
  f.runtime.tickets.set('selected-ticket', { id: f.id });
  f.runtime.tickets.set('other-ticket', { id: 'second-garage' });
  const response = await f.call(endpoint, body);
  assert.equal(response.status, 200); assert.equal(response.value.status.actuationEnabled, false);
  assert.equal(response.value.status.commissioned, false);
  assert.equal(f.runtime.entry('second-garage'), otherEntry);
  assert.equal(otherEntry.engine, otherEngine); assert.equal(otherEngine.stopped, false);
  assert.equal(f.runtime.status('second-garage').actuationEnabled, true);
  assert.equal(f.runtime.tickets.has('selected-ticket'), false);
  assert.equal(f.runtime.tickets.has('other-ticket'), true);
  await assert.rejects(f.runtime.submit(f.id, f.command('open')), /controller_held/);
  assert.deepEqual(f.hardware.state.writes, []); assert.deepEqual(f.other.state.writes, []);
  await f.runtime.stop();
  const second = new CoordinatorRuntime({ storagePath: f.storagePath, configuration: f.config, credentials: async () => f.hardware.credentials, clock: f.clock });
  t.after(() => second.stop()); await second.start();
  assert.equal(second.status(f.id).actuationEnabled, false);
  assert.equal(second.status('second-garage').actuationEnabled, true);
  assert.deepEqual(f.hardware.state.writes, []); assert.deepEqual(f.other.state.writes, []);
});
