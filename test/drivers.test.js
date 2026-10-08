import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { TailwindDoor, DeconzBolt } from '../src/drivers.js';
import { Diagnostics } from '../src/diagnostics.js';
import { requestJson } from '../src/transport.js';
import { createManagementServer, listenLocal, closeServer } from '../src/api.js';
import { hardwareFixture } from './support/hardware.mjs';

const example = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
const identity = { instanceId: '00000000-0000-4000-8000-000000000001', token: 'synthetic-token-for-real-loopback-tests' };
async function fixture(t, lockedValue = true) {
  const config = structuredClone(example.controllers[0]); config.bolt.lockedValue = lockedValue;
  const result = await hardwareFixture(config); t.after(result.close); return result;
}

test('real transport probe reads devices without any actuator write and does not mislabel Tailwind open', async t => {
  const f = await fixture(t); f.state.closed = false; f.state.locked = false;
  const diagnostics = new Diagnostics({ controllers: [f.config] }, async () => f.credentials);
  assert.deepEqual(f.state.requests, []);
  const value = await diagnostics.probe(f.config.id);
  assert.equal(value.compatible, true); assert.equal(value.actuationEnabled, false);
  assert.deepEqual(value.door, { state: 'not-closed', feedback: 'closed-sensor', blocked: false, error: null });
  assert.deepEqual(value.bolt, { state: 'unlocked', feedback: 'relay', error: null });
  assert.deepEqual(f.state.writes, []); assert.equal(f.state.requests.length, 3);
  for (const secret of Object.values(f.credentials)) assert.equal(JSON.stringify(value).includes(secret), false);
});

test('drivers are read-only by default, even after successful checks', async t => {
  const f = await fixture(t); const door = new TailwindDoor(f.config.door, '123456');
  const bolt = new DeconzBolt(f.config.bolt, 'synthetic-deconz-key');
  await door.read(); await bolt.read();
  await assert.rejects(door.write('open'), /actuation_disabled/);
  await assert.rejects(bolt.write(false), /actuation_disabled/);
  assert.deepEqual(f.state.writes, []);
});

test('Tailwind write uses local TOKEN protocol and never retries a lost acknowledgement', async t => {
  const f = await fixture(t); f.state.ambiguousDoorWrite = true;
  const door = new TailwindDoor(f.config.door, '123456', { readOnly: false });
  await assert.rejects(door.write('open'), /door_write_ambiguous/);
  assert.deepEqual(f.state.writes, [['door', 'open']]); assert.equal(f.state.closed, false);
});

test('deCONZ checks endpoint identities immediately before a write and supports inverted mapping', async t => {
  const f = await fixture(t, false); const bolt = new DeconzBolt(f.config.bolt, 'synthetic-deconz-key', { readOnly: false });
  assert.equal((await bolt.read()).locked, true);
  await bolt.write(false);
  assert.deepEqual(f.state.writes, [['bolt', true]]); assert.equal((await bolt.read()).locked, false);
  f.state.uniqueId = 'replaced-device';
  await assert.rejects(bolt.write(true), /bolt_resource_identity_mismatch/);
  assert.equal(f.state.writes.length, 1);
});

test('deCONZ gateway, model, type, manufacturer and reachability failures block all writes', async t => {
  const f = await fixture(t); const bolt = new DeconzBolt(f.config.bolt, 'synthetic-deconz-key', { readOnly: false });
  for (const [key, value] of [['gatewayId', 'FFFFFFFFFFFFFFFF'], ['modelId', 'changed'], ['resourceType', 'Dimmable light'],
    ['manufacturer', 'changed'], ['reachable', false]]) {
    const previous = f.state[key]; f.state[key] = value;
    await assert.rejects(bolt.write(false)); f.state[key] = previous;
  }
  assert.deepEqual(f.state.writes, []);
});

test('deCONZ acknowledgement mismatch cannot cause a retry or claim position sensing', async t => {
  const f = await fixture(t); f.state.badBoltAcknowledgement = true;
  const bolt = new DeconzBolt(f.config.bolt, 'synthetic-deconz-key', { readOnly: false });
  await assert.rejects(bolt.write(false), /bolt_write_unconfirmed/);
  assert.equal(f.state.writes.length, 1); assert.equal((await bolt.read()).evidence, 'relay');
});

test('probe reports identity mismatch without private device data', async t => {
  const f = await fixture(t); f.state.uniqueId = 'private-replacement-identity';
  const diagnostics = new Diagnostics({ controllers: [f.config] }, async () => f.credentials);
  const value = await diagnostics.probe(f.config.id);
  assert.equal(value.compatible, false); assert.equal(value.bolt.state, 'unknown');
  assert.equal(value.bolt.error, 'bolt_resource_identity_mismatch');
  assert.equal(JSON.stringify(value).includes('private-replacement'), false); assert.deepEqual(f.state.writes, []);
});

test('additional connection checks verify released motors and public keypad membership without writes or secret disclosure', async t => {
  const inputExample=JSON.parse(await readFile(new URL('../examples/input-routing-config.json',import.meta.url),'utf8'));
  inputExample.controllers[0].inputs=inputExample.controllers[0].inputs.slice(0,2);
  const f=await hardwareFixture(inputExample.controllers[0]);t.after(f.close);
  const diagnostics=new Diagnostics({controllers:[f.config]},async()=>f.credentials);
  let checks=await diagnostics.probeControls(f.config.id);
  assert.deepEqual(checks.map(row=>[row.kind,row.error]),[['motor',null],['input',null],['input',null]]);
  f.state.alarmMembership=false;
  checks=await diagnostics.probeControls(f.config.id);
  assert.equal(checks.find(row=>row.id==='physical-keypad').error,'input_alarm_mapping_changed');
  assert.equal(checks.find(row=>row.id==='indoor-button').error,null);
  f.state.alarmMembership=true;f.motors.values().next().value.active=true;
  checks=await diagnostics.probeControls(f.config.id);
  assert.equal(checks.find(row=>row.kind==='motor').error,'motor_relay_active_requires_review');
  f.motors.values().next().value.active=false;
  f.config.inputs[1].enabled=false;f.state.alarmMembership=false;
  assert.equal((await diagnostics.probeControls(f.config.id)).length,2);
  diagnostics.credentials=async()=>{throw Error('private-key-and-path');};
  checks=await diagnostics.probeControls(f.config.id);
  assert.ok(checks.every(row=>row.error==='credentials_unavailable'));
  assert.equal(JSON.stringify(checks).includes('private-key-and-path'),false);
  for(const secret of Object.values(f.credentials))assert.equal(JSON.stringify(checks).includes(secret),false);
  assert.deepEqual(f.state.writes,[]);assert.ok(f.state.requests.every(row=>row.method==='GET'));
});

test('misstated feedback modes and physically conflicting states are explicit limitations', async t => {
  const f = await fixture(t); f.config.feedback.opening = 'sensor'; f.config.feedback.bolt = 'position';
  f.state.closed = false;
  const value = await new Diagnostics({ controllers: [f.config] }, async () => f.credentials).probe(f.config.id);
  assert.equal(value.compatible, false);
  assert.deepEqual(value.limitations, ['tailwind_open_requires_estimate', 'deconz_relay_is_not_position', 'bolt_extended_with_door_not_closed']);
  assert.deepEqual(f.state.writes, []);
});

test('missing credentials and incomplete Homebridge identities fail without attempted requests', async t => {
  const f = await fixture(t);
  let d = new Diagnostics({ controllers: [f.config] }, async () => { throw Error('private path'); });
  assert.equal((await d.probe(f.config.id)).door.error, 'credentials_unavailable');
  d = new Diagnostics({ controllers: [f.config] }, async () => ({}));
  assert.equal((await d.probe(f.config.id)).bolt.error, 'credential_reference_missing');
  f.config.door.type = 'homebridge'; f.config.bolt.type = 'homebridge';
  d = new Diagnostics({ controllers: [f.config] }, async () => f.credentials);
  assert.equal((await d.probe(f.config.id)).door.error, 'device_probe_failed');
  assert.deepEqual(f.state.requests, []);
});

test('only one probe per controller runs; a failed probe does not lock out the next check', async t => {
  const f = await fixture(t); let release;
  const d = new Diagnostics({ controllers: [f.config] }, () => new Promise(resolve => { release = resolve; }));
  const first = d.probe(f.config.id);
  await assert.rejects(d.probe(f.config.id), /probe_busy/); release({}); await first;
  d.credentials = async () => f.credentials;
  assert.equal((await d.probe(f.config.id)).compatible, true);
});

test('real management probe authenticates and pins instance before touching hardware', async t => {
  const f = await fixture(t);
  const diagnostics = new Diagnostics({ controllers: [f.config] }, async () => f.credentials);
  const server = createManagementServer({ identity, configuration: { controllers: [f.config] }, diagnostics });
  t.after(() => closeServer(server)); const port = await listenLocal(server, 0);
  const url = `http://127.0.0.1:${port}/v1/controllers/${f.config.id}/probe`;
  const options = { method: 'POST', headers: { Authorization: 'Bearer ' + identity.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: identity.instanceId }) };
  for (const changed of [{ headers: { 'Content-Type': 'application/json' } }, { body: '{"instanceId":"wrong"}' },
    { headers: { ...options.headers, Origin: 'http://127.0.0.1' } }, { body: '{"open":true}' }, { body: 'x'.repeat(1025) }]) {
    assert.notEqual((await fetch(url, { ...options, ...changed })).status, 200);
  }
  assert.deepEqual(f.state.requests, []);
  const response = await fetch(url, options); assert.equal(response.status, 200);
  assert.equal((await response.json()).probe.compatible, true);
  assert.deepEqual(f.state.writes, []);
});

test('transport rejects redirects, oversized JSON and slow responses with fixed errors', async t => {
  let received = 0;
  const server = http.createServer((request, response) => {
    received++;
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/private-target' }); response.end(); }
    else if (request.url === '/large') response.end('"' + 'x'.repeat(65536) + '"');
    else if (request.url === '/slow') { response.writeHead(200); response.write('{'); }
    else response.end('private-bad-json');
  });
  t.after(() => closeServer(server)); const port = await listenLocal(server, 0);
  for (const name of ['redirect', 'large', 'slow', 'invalid']) {
    await assert.rejects(requestJson({ url: `http://127.0.0.1:${port}/${name}`, timeoutMs: 50 }), error => error.message === 'device_request_failed');
  }
  assert.equal(received, 4);
});
