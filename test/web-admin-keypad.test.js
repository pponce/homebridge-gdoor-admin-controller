import test from 'node:test';
import assert from 'node:assert/strict';
import { WebAdminKeypad, classifyWebKeypad } from '../src/web-admin-keypad.js';
import { WebAdminTransactions } from '../src/web-admin-transactions.js';
import { webCoordinatorKeypad, webCoordinatorParticipant } from '../src/web-admin-coordinator.js';

function fixture() {
  const requests = new Set(), events = [], journal = []; let state = null, calls = 0;
  const transactions = new WebAdminTransactions({ store: { read: async () => structuredClone(state), write: async tx => { state = structuredClone(tx); journal.push(structuredClone(tx)); } } });
  const client = { verify: async () => ({ managed: true }), exchange: async (path, method, body) => {
    calls++; assert.deepEqual([path, method, body], ['/alarmsystems/1/disarm', 'PUT', { code0: '1234' }]);
    return [200, [{ success: { '/alarmsystems/1/config/armmode': 'disarmed' } }]];
  } };
  const hook = { api_version: 1, note: null, after: async (...args) => events.push(['after', ...args]), failed: async outcome => events.push(['failed', outcome]) };
  const history = { reserveRequest: async (gateway, alarm, id) => { if (requests.has(id)) return false; requests.add(id); return true; }, add: async (...args) => events.push(['audit', ...args]) };
  const keypad = new WebAdminKeypad({ gateway: 'test', identity: '0011223344556677', alarm: 1, client, transactions, history, accessMode: 'manage', begin: async () => hook });
  return { keypad, client, transactions, events, journal, hook, history, calls: () => calls, body: () => ({ code: '1234', mode: 'disarm', request_id: 'a'.repeat(32) }) };
}
test('virtual keypad verifies exactly one command, provides only its result to the controller, and suppresses duplicate delivery', async () => {
  const f = fixture(), body = f.body();
  assert.deepEqual(await f.keypad.send(body), { result: 'accepted', extension: null, mode: 'disarm' });
  assert.equal(Object.hasOwn(body, 'code'), false); assert.equal(f.calls(), 1);
  assert.deepEqual(f.events.filter(row => row[0] === 'after'), [['after', 'accepted', 'disarm']]);
  assert.equal((await f.keypad.send(f.body())).result, 'duplicate'); assert.equal(f.calls(), 1);
  assert.equal(JSON.stringify(f.journal).includes('1234'), false); assert.equal(JSON.stringify(f.events).includes('1234'), false);
});
test('unknown keypad replies hold the transaction, never invoke the movement hook and never repeat delivery', async () => {
  const f = fixture(); f.client.exchange = async () => [200, [{ success: { '/wrong/path': 'disarmed' } }]];
  const result = await f.keypad.send(f.body()); assert.equal(result.uncertain, true); assert.equal(result.result, 'unknown');
  assert.equal(f.events.some(row => row[0] === 'after'), false); assert.ok(f.events.some(row => row[0] === 'failed'));
  await assert.rejects(f.keypad.send({ ...f.body(), request_id: 'b'.repeat(32) }), /transaction_recovery_required/);
  assert.equal((await f.transactions.status('test')).outcome, 'unknown');
});
test('unavailable required hook, observation mode and malformed requests fail before any command or reservation', async () => {
  const f = fixture(); f.keypad.begin = async () => { throw Error('Required controller missing'); };
  await assert.rejects(f.keypad.send(f.body())); assert.equal(f.calls(), 0); assert.equal(f.events.length, 0);
  f.keypad.accessMode = 'observe'; assert.equal((await f.keypad.status({})).available, false);
  await assert.rejects(f.keypad.send(f.body()), /candidate_read_only_required/);
  await assert.rejects(f.keypad.send({ ...f.body(), automatic_retry: true }), /invalid_keypad_request/);
});
test('only the exact redacted deCONZ validation failure is a rejected code', () => {
  const body = [{ error: { type: 7, address: '/alarmsystems/1/code0', description: 'invalid value, [redacted], for parameter, code0' } }];
  assert.equal(classifyWebKeypad(400, body, 1, 'disarm'), 'rejected');
  assert.throws(() => classifyWebKeypad(500, body, 1, 'disarm'), /keypad_result_unknown_no_retry/);
  assert.throws(() => classifyWebKeypad(400, body, 2, 'disarm'), /keypad_result_unknown_no_retry/);
  body[0].error.description = 'invalid value, 1234, for parameter, code0';
  assert.throws(() => classifyWebKeypad(400, body, 1, 'disarm'), /keypad_result_unknown_no_retry/);
});
test('coordinator bridge uses the existing scoped begin/after API, rejects ambiguous scope and sends no startup command', async () => {
  const calls = [], profile = { id: 'garage', keypad: { gatewayId: '00:11:22:33:44:55:66:77', alarmId: 1 } };
  const runtime = { configuration: { controllers: [profile] }, keypadBegin: (...args) => { calls.push(['begin', ...args]); return { token: 'synthetic' }; },
    keypadAfter: async (...args) => { calls.push(['after', ...args]); return { note: 'Open requested; completion not confirmed' }; } };
  const begin = webCoordinatorKeypad(runtime, { identity: '0011223344556677' }, 1, { clock: () => 12 }); assert.deepEqual(calls, []);
  const hook = begin(11); await hook.after('accepted', 'disarm');
  assert.deepEqual(calls, [['begin', 'garage', { gatewayId: profile.keypad.gatewayId, alarmId: 1 }], ['after', 'synthetic', 'accepted', 'disarm', 1]]);
  assert.match(hook.note, /completion not confirmed/);
  assert.equal(webCoordinatorKeypad(runtime, { identity: '0011223344556677' }, 2)(11), null);
  runtime.configuration.controllers.push({ ...profile, id: 'second' }); assert.throws(() => begin(11), /keypad_scope_ambiguous/);
});
test('maintenance bridge keeps command authorization separate and is idempotent after completion or an unsent failed pause', async () => {
  const calls = [], runtime = { configuration: { controllers: [{}] }, state: { maintenance: null }, guard() {}, assertIdle() {},
    maintenance: async (...args) => { calls.push(args); return true; } };
  const participant = webCoordinatorParticipant(runtime), tx = { id: 'synthetic', gateway: 'test', write_attempted: true };
  assert.equal(participant.applies({ operation: 'keypad_send' }), false); assert.equal(participant.applies({ operation: 'save_user' }), true);
  await participant.preflight(tx); await participant.pause(tx); assert.equal(calls[1][0], 'pause');
  runtime.state.lastMaintenanceId = tx.id;
  for (const method of ['verify', 'resume', 'complete']) assert.equal(await participant[method](tx), true);
  assert.equal(calls.length, 2);
  delete runtime.state.lastMaintenanceId;
  assert.equal(participant.recovery_ready(tx), false); assert.equal(participant.recovery_ready({ ...tx, write_attempted: false }), true);
});
