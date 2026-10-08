import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CoordinatorPlatform } from '../src/index.js';

const example = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
test('unconfigured and invalid platform remain inactive and never register accessories', async () => {
  const log = { info() {}, warn() {}, error() {} };
  for (const config of [{}, { controllers: [] }]) {
    const api = new EventEmitter(); api.user = { storagePath() { throw new Error('must not access storage'); } };
    const platform = new CoordinatorPlatform(log, config, api);
    api.emit('didFinishLaunching'); assert.equal(platform.server, undefined);
    await platform.shutdown();
  }
});
test('startup after shutdown cannot reopen the server or reveal configuration', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'coordinator-platform-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const messages = []; const log = { info: x => messages.push(x), warn: x => messages.push(x), error: x => messages.push(x) };
  const api = new EventEmitter(); api.user = { storagePath: () => directory };
  const platform = new CoordinatorPlatform(log, example, api);
  await platform.shutdown(); await platform.start();
  assert.equal(platform.server, undefined);
  assert.equal(messages.join('\n').includes('example.invalid'), false);
});
test('launch event starts the authenticated API and shutdown releases its socket', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'coordinator-platform-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const messages = []; const log = { info: x => messages.push(x), warn: x => messages.push(x), error: x => messages.push(x) };
  const api = new EventEmitter(); api.user = { storagePath: () => directory };
  const platform = new CoordinatorPlatform(log, example, api);
  t.after(() => platform.shutdown());
  // Use an ephemeral loopback socket in this harness, never a deployment port.
  platform.configuration.managementPort = 0;
  api.emit('didFinishLaunching'); await platform.starting;
  const identity = JSON.parse(await readFile(path.join(directory, 'gdoorandbolt-coordinator', 'identity.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${platform.server.address().port}/v1/identity`, {
    headers: { Authorization: `Bearer ${identity.token}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).instanceId, identity.instanceId);
  assert.equal(platform.webAdmin.active, null);
  assert.equal((await platform.webAdmin.status()).settings.enabled, false);
  await platform.shutdown();
  assert.equal(platform.server.listening, false);
  assert.equal(messages.some(message => message.includes(identity.token)), false);
});

