import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createManagementServer, listenLocal, closeServer } from '../src/api.js';
import { validateConfiguration } from '../src/config.js';

const token = 'synthetic-test-token-never-a-live-credential';
const instanceId = '00000000-0000-4000-8000-000000000001';
const configuration = validateConfiguration(JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8')));
async function fixture(t) {
  const server = createManagementServer({ identity: { token, instanceId }, configuration });
  const port = await listenLocal(server, 0);
  t.after(() => closeServer(server));
  return { server, port };
}
function request(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Authorization: `Bearer ${token}`, ...headers } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.end();
  });
}
test('real socket identity and inventory explicitly report no operational capabilities', async t => {
  const { port, server } = await fixture(t);
  assert.equal(server.address().address, '127.0.0.1');
  const identity = await request(port, '/v1/identity');
  assert.equal(identity.status, 200); assert.equal(identity.body.instanceId, instanceId);
  assert.equal(identity.body.pluginVersion, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.equal(identity.body.capabilities.motion, false); assert.equal(identity.body.capabilities.maintenance, false);
  assert.equal(identity.headers['cache-control'], 'no-store');
  const all = await request(port, '/v1/controllers');
  const one = await request(port, '/v1/controllers/example-garage');
  assert.deepEqual(one.body.controller, all.body.controllers[0]);
  assert.deepEqual(one.body.controller.status, { phase: 'not-commissioned', door: 'unknown', bolt: 'unknown', actuationEnabled: false });
  assert.equal(JSON.stringify(all).includes(token), false);
  assert.equal(JSON.stringify(all).includes('example.invalid'), false);
});
test('every endpoint requires authentication including identity and error routes', async t => {
  const { port } = await fixture(t);
  for (const path of ['/v1/identity', '/v1/controllers', '/v1/controllers/example-garage/routing', '/missing']) {
    const result = await request(port, path, { headers: { Authorization: 'Bearer wrong' } });
    assert.equal(result.status, 401); assert.deepEqual(result.body, { error: 'unauthorized' });
  }
});
test('routing inventory is explicit, sanitized and read-only', async t => {
  const { port } = await fixture(t);
  const response = await request(port, '/v1/controllers/example-garage/routing');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.routing.builtins, { homekit: 'primary', virtualKeypad: 'primary' });
  assert.equal(response.body.routing.runtimeEnabled, false);
  assert.equal(response.body.routing.motorPaths[0].type, 'tailwind');
  assert.equal(JSON.stringify(response).includes('example.invalid'), false);
  assert.equal((await request(port, '/v1/controllers/example-garage/routing', { method: 'POST' })).status, 405);
});
test('rejects browser origins and alternate Host headers even with a valid token', async t => {
  const { port } = await fixture(t);
  assert.equal((await request(port, '/v1/identity', { headers: { Origin: 'https://example.invalid' } })).status, 403);
  assert.equal((await request(port, '/v1/identity', { headers: { Host: 'example.invalid' } })).status, 403);
});
test('motion, settings and maintenance writes cannot succeed in milestone 1', async t => {
  const { port } = await fixture(t);
  for (const path of ['/v1/controllers/example-garage/commands', '/v1/settings', '/v1/maintenance/pause']) {
    const result = await request(port, path, { method: 'POST' });
    assert.equal(result.status, 405); assert.equal(result.body.error, 'read_only_milestone');
  }
  assert.equal((await request(port, '/v1/controllers/example-garage?token=anything')).status, 404);
  assert.equal((await request(port, '/v1/controllers/missing')).status, 404);
});

test('HomeKit reporting inspection is authenticated, read-only and isolates diagnostic failures', async t => {
  let calls=0; let fail=false;
  const server=createManagementServer({identity:{token,instanceId},configuration,reporting:()=>{
    calls++; if(fail)throw Error('private-internals'); return {schema:1,tiles:[],clients:[],events:[]};
  }});
  const port=await listenLocal(server,0); t.after(()=>closeServer(server));
  const path='/v1/homekit-reporting';
  assert.equal((await request(port,path,{headers:{Authorization:'wrong'}})).status,401);
  assert.equal((await request(port,path,{headers:{Origin:'https://example.invalid'}})).status,403);
  assert.equal((await request(port,path,{method:'POST'})).status,405); assert.equal(calls,0);
  const ok=await request(port,path); assert.equal(ok.status,200); assert.equal(ok.body.reporting.schema,1);
  fail=true; const unavailable=await request(port,path); assert.equal(unavailable.status,503);
  assert.deepEqual(unavailable.body,{error:'reporting_inspection_unavailable'});
});
