import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createManagementServer, listenLocal, closeServer } from '../src/api.js';
import { validateConfiguration } from '../src/config.js';
import { WebAdminError } from '../src/web-admin-auth.js';

const token = 'synthetic-test-token-never-a-live-credential';
const instanceId = '00000000-0000-4000-8000-000000000001';
const configuration = validateConfiguration(JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8')));
test('optional web setup stays on the authenticated local API and returns explicit save results', async t => {
  const calls = [];
  const webAdmin = { status: async () => ({ running: false }), configure: async body => { calls.push(body); throw new WebAdminError('web_settings_changed'); } };
  const server = createManagementServer({ identity: { token, instanceId }, configuration, runtime: { configuration }, webAdmin });
  const port = await listenLocal(server, 0); t.after(() => closeServer(server));
  assert.equal((await request(port, '/v1/web-admin', { headers: { Authorization: 'wrong' } })).status, 401);
  assert.equal((await request(port, '/v1/web-admin')).body.webAdmin.running, false);
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instanceId, expectedRevision: 0, settings: {}, admin: null } };
  assert.equal((await request(port, '/v1/web-admin/configure', { ...options, body: { ...options.body, command: 'open' } })).status, 409);
  assert.equal((await request(port, '/v1/web-admin/configure', { ...options, headers: { ...options.headers, Origin: 'https://example.test' } })).status, 403);
  const result = await request(port, '/v1/web-admin/configure', options);
  assert.equal(result.status, 200); assert.equal(result.body.configured, false); assert.equal(result.body.error, 'web_settings_changed'); assert.equal(calls.length, 1);
});
async function fixture(t) {
  const server = createManagementServer({ identity: { token, instanceId }, configuration });
  const port = await listenLocal(server, 0);
  t.after(() => closeServer(server));
  return { server, port };
}
function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Authorization: `Bearer ${token}`, ...headers } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
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

test('detailed status is opt-in and legacy inventory, state and mutation responses retain their exact shape', async t => {
  const id=configuration.controllers[0].id;
  const status={controllerId:id,bootId:instanceId,commissioned:true,actuationEnabled:true,held:null,inputStates:{},revision:1,
    state:{phase:'position-unknown',door:'not-closed',bolt:'unlocked',busy:false,fault:null,reconciling:true,restartCloseAvailable:true,faultAt:null},
    health:{title:'Enabled · Position unconfirmed',detail:'Synthetic explanation',code:null}};
  const runtime={configuration,inventory:()=>[{id,status}],status:()=>status,commission:async()=>status,disable:async()=>status};
  const server=createManagementServer({identity:{token,instanceId},configuration,runtime});
  const port=await listenLocal(server,0);t.after(()=>closeServer(server));
  for(const detailed of [false,true]){
    const headers=detailed?{'X-Coordinator-Status':'detailed'}:{};
    const inventory=(await request(port,'/v1/controllers',{headers})).body.controllers[0].status;
    const single=(await request(port,'/v1/controllers/'+id,{headers})).body.controller.status;
    const state=(await request(port,'/v1/controllers/'+id+'/state',{headers})).body.status;
    const enabled=(await request(port,'/v1/controllers/'+id+'/commission',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:{instanceId,revision:1,previousControllerStopped:true,physicalSetupReviewed:true,recover:true}})).body.status;
    const disabled=(await request(port,'/v1/controllers/'+id+'/disable',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:{instanceId,revision:1,bootId:instanceId}})).body.status;
    for(const row of [inventory,single,state,enabled,disabled]){
      assert.equal(Object.hasOwn(row,'health'),detailed);
      for(const key of ['reconciling','restartCloseAvailable','faultAt'])assert.equal(Object.hasOwn(row.state,key),detailed);
      assert.equal(row.actuationEnabled,true);assert.equal(row.state.door,'not-closed');
    }
  }
  assert.equal(status.state.reconciling,true,'Projection cannot mutate the internal state');
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

test('recording switch requires identity, exact boolean payload and idle controllers; never saves settings', async t => {
  let busy=false; const changes=[];
  const runtime={configuration,status:()=>({state:{busy}})};
  const server=createManagementServer({identity:{token,instanceId},configuration,runtime,
    setReporting:recording=>{changes.push(recording);return {recording};}});
  const port=await listenLocal(server,0); t.after(()=>closeServer(server));
  const path='/v1/homekit-reporting/recording';
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:{instanceId,recording:false}};
  assert.equal((await request(port,path,{...options,headers:{...options.headers,Authorization:'wrong'}})).status,401);
  assert.equal((await request(port,path,{...options,headers:{...options.headers,Origin:'https://example.invalid'}})).status,403);
  assert.equal((await request(port,path)).status,405);
  for(const body of [{instanceId,recording:'false'},{instanceId,recording:false,command:'close'},{instanceId:'wrong',recording:false}])
    assert.equal((await request(port,path,{...options,body})).status,409);
  busy=true; assert.equal((await request(port,path,options)).body.error,'reporting_controller_busy');
  assert.deepEqual(changes,[]);
  busy=false; assert.equal((await request(port,path,options)).body.recording,false);
  assert.equal((await request(port,path,{...options,body:{instanceId,recording:true}})).body.recording,true);
  assert.deepEqual(changes,[false,true]);
});

test('reporting experiment requires authenticated identity, exact supported modes and idle controllers', async t => {
  let busy=false; const changes=[];
  const runtime={configuration,status:()=>({state:{busy}})};
  const server=createManagementServer({identity:{token,instanceId},configuration,runtime,
    setReportingExperiment:(traceMode,publicationMode)=>{changes.push([traceMode,publicationMode]);return {traceMode,publicationMode};}});
  const port=await listenLocal(server,0); t.after(()=>closeServer(server));
  const path='/v1/homekit-reporting/experiment';
  const body={instanceId,traceMode:'off',publicationMode:'deferred'};
  const options={method:'POST',headers:{'Content-Type':'application/json'},body};
  for(const headers of [{Authorization:'wrong'},{Origin:'https://example.invalid'},{Host:'example.invalid'}])
    assert.ok([401,403].includes((await request(port,path,{...options,headers:{...options.headers,...headers}})).status));
  assert.equal((await request(port,path)).status,405);
  assert.equal((await request(port,path,{...options,headers:{}})).status,409);
  for(const bad of [{...body,instanceId:'wrong'},{...body,traceMode:'unknown'},{...body,publicationMode:'unknown'},
    {...body,command:'close'},{instanceId,traceMode:'off'}])
    assert.equal((await request(port,path,{...options,body:bad})).status,409);
  busy=true; assert.equal((await request(port,path,options)).body.error,'reporting_controller_busy');
  assert.deepEqual(changes,[]); busy=false;
  for(const traceMode of ['full','events','subscribers','off'])
    for(const publicationMode of ['inline','deferred']) {
      const result=await request(port,path,{...options,body:{instanceId,traceMode,publicationMode}});
      assert.equal(result.status,200); assert.equal(result.body.traceMode,traceMode); assert.equal(result.body.publicationMode,publicationMode);
    }
  assert.equal(changes.length,8);
});
