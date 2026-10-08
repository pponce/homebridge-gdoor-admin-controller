import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebAdminManager } from '../src/web-admin-manager.js';
import { defaultWebSettings } from '../src/web-admin-settings.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/web-admin-read-parity.json', import.meta.url)));
test('production lifecycle serves proxy-style HTTPS, saves through durable maintenance, and keeps accounts/history across restart', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'web-service-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'gdoorandbolt-coordinator'), { mode: 0o700 });
  const data = structuredClone(fixture), writes = [], maintenance = [];
  const gateway = http.createServer(async (request, response) => {
    const route = request.url.replace('/api/synthetic_key', '');
    const send = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    if (request.method === 'GET') {
      if (route === '/config') return send({ bridgeid: '0011223344556677' });
      const alarm = /^\/alarmsystems\/(\d+)\/users\/capabilities$/.exec(route);
      if (alarm) return send(data.capabilities[alarm[1]]);
      if (Object.hasOwn(data.responses, route)) return send(data.responses[route]);
    }
    if (request.method === 'PUT' && route === '/alarmsystems/1/config') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); writes.push(route); Object.assign(data.responses['/alarmsystems/1'].config, body);
      return send(Object.entries(body).map(([key, value]) => ({ success: { [route + '/' + key]: value } })));
    }
    response.statusCode = 400; send({ error: 'fixture_route_rejected' });
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { gateway.close(resolve); gateway.closeAllConnections(); }));
  const runtime = { configuration: { managementPort: 27773, controllers: [{ id: 'test' }], connections: [
    { id: 'deconz', name: 'Synthetic gateway', type: 'deconz', baseUrl: 'http://127.0.0.1:' + gateway.address().port, credentialRef: 'synthetic' },
  ] }, state: { maintenance: null }, assertIdle() {}, guard() { assert.equal(this.state.maintenance, null); },
  async maintenance(action, id) {
    maintenance.push(action); if (action === 'pause') this.state.maintenance = { id };
    if (action === 'complete') { this.state.maintenance = null; this.state.lastMaintenanceId = id; } return true;
  } };
  const options = { storagePath: root, runtime, credentials: async () => ({ synthetic: 'synthetic_key' }) };
  let manager = new WebAdminManager(options); t.after(() => manager.close()); await manager.start(); assert.deepEqual(writes, []);
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const settings = { ...defaultWebSettings(), enabled: true, port, origin: 'https://localhost:' + port, publicUrl: 'https://garage.example.test', connectionIds: ['deconz'] };
  const result = await manager.configure({ expectedRevision: 0, settings, admin: { username: 'Owner', password: 'synthetic-long-password' } });
  assert.equal(result.error, null); assert.equal(result.running, true); assert.deepEqual(writes, []); assert.deepEqual(maintenance, []);
  const request = (route, body, headers = {}) => new Promise((resolve, reject) => {
    const raw = body === undefined ? null : JSON.stringify(body);
    // Only this loopback test client accepts the generated self-signed backend
    // certificate, just as the separately configured proxy does in production.
    const req = https.request({ hostname: '127.0.0.1', port, path: route, rejectUnauthorized: false, method: raw ? 'POST' : 'GET',
      headers: { Host: 'localhost:' + port, ...(raw ? { Origin: settings.origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {}), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', value => { text += value; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) })); res.on('error', reject);
    }); req.on('error', reject); req.end(raw);
  });
  const login = await request('/api/login', { username: 'Owner', password: 'synthetic-long-password' }); assert.equal(login.status, 200);
  const headers = { Cookie: login.headers['set-cookie'][0].split(';')[0], 'X-CSRF-Token': login.body.csrf,
    'X-Configurator-Gateway': 'gateway-0011223344556677', 'X-Configurator-Alarm': '1' };
  assert.equal((await request('/api/setup', undefined, headers)).body.gateways.length, 1);
  const rejected = await request('/api/setup/application', {}, { ...headers, Origin: settings.publicUrl }); assert.equal(rejected.status, 400);
  const alarm = await request('/api/alarm', undefined, headers); assert.equal(alarm.status, 200);
  const timings = { ...alarm.body.timings, armed_stay_entry_delay: 29 };
  const saved = await request('/api/alarm/save', { timings, revision: alarm.body.revision, backup_acknowledged: true }, headers);
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.saved, true);
  assert.deepEqual(writes, ['/alarmsystems/1/config']); assert.deepEqual(maintenance, ['preflight', 'pause', 'verify', 'resume', 'complete']);
  assert.equal((await request('/api/history', undefined, headers)).body.rows.length, 1);
  await manager.close(); manager = new WebAdminManager(options); await manager.start(); assert.equal(manager.error, null);
  assert.equal((await request('/api/session', undefined, headers)).status, 401);
  const again = await request('/api/login', { username: 'Owner', password: 'synthetic-long-password' }); assert.equal(again.status, 200);
  headers.Cookie = again.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request('/api/history', undefined, headers)).body.rows.length, 1);
  assert.deepEqual(writes, ['/alarmsystems/1/config']);
});
