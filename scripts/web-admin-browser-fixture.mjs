// Synthetic loopback gateway for browser acceptance. No device addresses,
// installed service, live secrets or command delivery can enter this fixture.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebAdminManager } from '../src/web-admin-manager.js';
import { defaultWebSettings } from '../src/web-admin-settings.js';

export async function webBrowserFixture() {
  const storagePath = await mkdtemp(join(tmpdir(), 'web-admin-acceptance-'));
  await mkdir(join(storagePath, 'gdoorandbolt-coordinator'), { mode: 0o700 });
  const data = JSON.parse(await readFile(new URL('../test/fixtures/web-admin-read-parity.json', import.meta.url)));
  const writes = [], errors = [], state = { loseNextAlarmReply: false };
  const gateway = http.createServer(async (request, response) => {
    try {
      assert.ok(request.url.startsWith('/api/synthetic_key/'));
      const route = request.url.slice('/api/synthetic_key'.length);
      const send = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
      if (request.method === 'GET') {
        if (route === '/config') return send({ bridgeid: '0011223344556677' });
        const caps = /^\/alarmsystems\/(\d+)\/users\/capabilities$/.exec(route);
        if (caps) return send(data.capabilities[caps[1]]);
        assert.ok(Object.hasOwn(data.responses, route), route); return send(data.responses[route]);
      }
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); writes.push([request.method, route]);
      if (request.method === 'PUT' && route === '/alarmsystems/1/config') {
        Object.assign(data.responses['/alarmsystems/1'].config, body);
        if (state.loseNextAlarmReply) { state.loseNextAlarmReply = false; response.destroy(); return; }
        return send(Object.entries(body).map(([key, value]) => ({ success: { [route + '/' + key]: value } })));
      }
      const grants = /^\/alarmsystems\/(\d+)\/users(?:\/([a-f0-9]{32}))?$/.exec(route);
      if (grants) {
        const prefix = '/alarmsystems/' + grants[1] + '/users', rows = data.responses[prefix], identities = data.responses['/alarmsystems/users'];
        const id = grants[2] ?? 'cccccccccccccccccccccccccccccccc';
        if (request.method === 'DELETE') { assert.ok(rows[id]); delete rows[id]; return send({ deleted: id }); }
        assert.ok(['PUT', 'POST'].includes(request.method));
        const current = identities[id], changed = !current || current.name !== body.name || current.enabled !== body.enabled;
        const userRevision = (current?.user_revision ?? 0) + Number(changed);
        const { pin, ...publicBody } = body;
        identities[id] = { id, name: body.name, enabled: body.enabled, revision: userRevision, user_revision: userRevision };
        for (const aid of Object.keys(data.responses['/alarmsystems'])) {
          const other = data.responses['/alarmsystems/' + aid + '/users'][id];
          if (other) Object.assign(other, { name: body.name, enabled: body.enabled, user_revision: userRevision });
        }
        rows[id] = { ...publicBody, id, revision: body.revision + 1, user_revision: userRevision, schedule: body.schedule ?? null }; return send(rows[id]);
      }
      const identity = /^\/alarmsystems\/users\/([a-f0-9]{32})$/.exec(route);
      if (identity && request.method === 'PUT') {
        const row = data.responses['/alarmsystems/users'][identity[1]]; assert.ok(row); assert.match(body.pin, /^[0-9]{4,16}$/);
        row.revision++; row.user_revision++; delete row.pin;
        for (const aid of Object.keys(data.responses['/alarmsystems'])) {
          const grant = data.responses['/alarmsystems/' + aid + '/users'][row.id]; if (grant) grant.user_revision = row.user_revision;
        }
        return send(row);
      }
      if (route === '/alarmsystems/1/users/lockout') {
        const row = data.responses[route];
        if (request.method === 'PUT') row.policy = { ...body, revision: row.policy.revision + 1 };
        else { assert.equal(request.method, 'DELETE'); for (const pad of row.keypads) Object.assign(pad, { level: 0, remaining_seconds: 0, locked_until: 0 }); }
        return send(row);
      }
      throw Error('Unsupported synthetic write');
    } catch (error) { errors.push(error.message); response.statusCode = 400; response.end('{}'); }
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const runtime = { configuration: { managementPort: 27773, controllers: [], connections: [
    { id: 'deconz', name: 'Synthetic gateway', type: 'deconz', baseUrl: 'http://127.0.0.1:' + gateway.address().port, credentialRef: 'synthetic' },
  ] }, guard() {}, state: { maintenance: null } };
  const manager = new WebAdminManager({ storagePath, runtime, credentials: async () => ({ synthetic: 'synthetic_key' }) });
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const origin = 'https://127.0.0.1:' + port, password = 'synthetic-browser-password';
  const settings = { ...defaultWebSettings(), enabled: true, port, origin, publicUrl: origin, connectionIds: ['deconz'] };
  return { manager, settings, origin, password, data, writes, errors, state,
    async enable() { const value = await manager.configure({ expectedRevision: 0, settings, admin: { username: 'Owner', password } }); assert.equal(value.error, null); },
    async close() { await manager.close(); await new Promise(resolve => { gateway.close(resolve); gateway.closeAllConnections(); }); await rm(storagePath, { recursive: true, force: true }); },
  };
}
