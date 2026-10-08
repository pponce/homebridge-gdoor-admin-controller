import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebAdminManager } from '../src/web-admin-manager.js';
import { defaultWebSettings } from '../src/web-admin-settings.js';
import { WebAdminApplication } from '../src/web-admin-application.js';

async function fixture(t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'web-lifecycle-'));
  await mkdir(path.join(storagePath, 'gdoorandbolt-coordinator'), { mode: 0o700 });
  t.after(() => rm(storagePath, { recursive: true, force: true }));
  const calls = [], runtime = { configuration: { controllers: [], managementPort: 27773, connections: [
    { id: 'deconz', name: 'Test gateway', type: 'deconz', baseUrl: 'http://gateway.example.test', credentialRef: 'test' },
  ] } };
  let identity = '0011223344556677', fail = false, key = 'synthetic_key';
  const manager = new WebAdminManager({ storagePath, runtime,
    credentials: async () => { calls.push('credentials'); return { test: key }; },
    exchange: async request => { calls.push(request.method); assert.equal(request.body, undefined); if (fail) throw Error('private supplied URL'); return [200, { bridgeid: identity }]; },
    tls: { load: async () => { calls.push('certificate'); return {}; } },
    build: async () => {
      calls.push('build'); const server = http.createServer((request, response) => response.end('fixture'));
      return { server, start: () => calls.push('collect'), close: async () => { calls.push('close'); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
    },
  });
  t.after(() => manager.close());
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const settings = { ...defaultWebSettings(), port, origin: 'https://localhost:' + port, publicUrl: 'https://garage.example.test', enabled: true, connectionIds: ['deconz'] };
  return { manager, storagePath, runtime, calls, settings, admin: { username: 'Owner', password: 'synthetic-password' },
    fail: () => { fail = true; }, identity: value => { identity = value; }, key: value => { key = value; } };
}
test('default OFF does not touch gateways, certificates, databases or a server', async t => {
  const f = await fixture(t); await f.manager.start(); const status = await f.manager.status();
  assert.equal(status.running, false); assert.equal(status.accountConfigured, false); assert.equal(status.error, null);
  assert.deepEqual(f.calls, []); assert.deepEqual(await readdir(path.join(f.storagePath, 'gdoorandbolt-coordinator')), []);
  assert.deepEqual(Object.keys(status.connections[0]).sort(), ['id', 'name']);
});
test('explicit setup starts once; disable works offline and retains account and gateway identity', async t => {
  const f = await fixture(t);
  const first = await f.manager.configure({ expectedRevision: 0, settings: f.settings, admin: f.admin });
  assert.equal(first.running, true); assert.equal(first.accountConfigured, true); assert.equal(first.revision, 1);
  assert.equal(f.calls.filter(value => value === 'collect').length, 1);
  assert.equal(JSON.stringify(first).includes('synthetic'), false);
  f.fail(); f.calls.length = 0;
  const off = await f.manager.configure({ expectedRevision: 1, settings: { ...f.settings, enabled: false }, admin: null });
  assert.equal(off.running, false); assert.equal(off.accountConfigured, true); assert.deepEqual(f.calls, ['close']);
  assert.equal((await f.manager.settings.read()).identities.deconz, '0011223344556677');
});
test('stale revisions or account replacement cannot interrupt an active web server', async t => {
  const f = await fixture(t); await f.manager.configure({ expectedRevision: 0, settings: f.settings, admin: f.admin });
  f.calls.length = 0;
  await assert.rejects(f.manager.configure({ expectedRevision: 0, settings: f.settings, admin: null }), /web_settings_changed/);
  await assert.rejects(f.manager.configure({ expectedRevision: 1, settings: f.settings, admin: f.admin }), /web_account_already_configured/);
  assert.equal((await f.manager.status()).running, true); assert.equal(f.calls.includes('close'), false);
});
test('gateway identity changes cannot reassign history, and edited credentials block the active backend', async t => {
  const f = await fixture(t); await f.manager.configure({ expectedRevision: 0, settings: f.settings, admin: f.admin });
  f.key('changed_key'); await assert.rejects(f.manager.active.assertCurrent(), /web_connections_changed/);
  assert.equal((await f.manager.status()).error, 'web_connections_changed');
  f.identity('FFEEDDCCBBAA9988');
  await assert.rejects(f.manager.configure({ expectedRevision: 1, settings: f.settings, admin: null }), /web_gateway_identity_changed/);
  assert.equal((await f.manager.settings.read()).revision, 1);
});
test('occupied port reports an isolated failure without stopping the other listener', async t => {
  const f = await fixture(t), other = http.createServer();
  await new Promise(resolve => other.listen(f.settings.port, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => other.close(resolve)));
  const result = await f.manager.configure({ expectedRevision: 0, settings: f.settings, admin: f.admin });
  assert.equal(result.running, false); assert.equal(result.error, 'web_port_in_use'); assert.equal(result.settings.enabled, true);
  assert.equal(other.listening, true); assert.equal(f.calls.includes('collect'), false);
});
test('shutdown prevents subsequent starts and configure requests', async t => {
  const f = await fixture(t); await f.manager.close(); await f.manager.start();
  await assert.rejects(f.manager.configure({ expectedRevision: 0, settings: f.settings, admin: f.admin }), /web_admin_stopping/);
  assert.deepEqual(f.calls, []);
});
test('application preferences persist, reject stale saves, and validate original timer and title limits', async t => {
  const f = await fixture(t), application = new WebAdminApplication(f.storagePath); await application.load();
  const revision = application.public().application_revision;
  const settings = { discovery_seconds: 10, display_seconds: 2, home_screen_name: 'My Keypad' };
  await application.save({ revision, settings });
  await assert.rejects(application.save({ revision, settings }), /settings_changed_refresh/);
  const restored = new WebAdminApplication(f.storagePath); await restored.load(); assert.deepEqual(restored.public(), application.public());
  for (const change of [{ discovery_seconds: 9 }, { display_seconds: 301 }, { home_screen_name: ' padded ' }, { home_screen_name: 'bad\u0000name' }])
    await assert.rejects(application.save({ revision: application.public().application_revision, settings: { ...settings, ...change } }));
});
