import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DeconzSeparateBolt } from '../src/separate-bolt.js';
import { MovementEngine } from '../src/engine.js';

const example = JSON.parse(await readFile(new URL('../examples/separate-bolt-config.json', import.meta.url)));
const flush = () => new Promise(resolve => setImmediate(resolve));

// Independent sleepers share a timeline. A sleep must not advance other work
// immediately: that would hide overlap between pulse cleanup and garage travel.
class Clock {
  time = 0;
  timers = [];
  now = () => this.time;
  sleep = ms => new Promise(resolve => this.timers.push({ at: this.time + ms, resolve }));
  async advance(ms) {
    const until = this.time + ms;
    await flush();
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      if (!this.timers.length || this.timers[0].at > until) break;
      const timer = this.timers.shift(); this.time = timer.at; timer.resolve(); await flush();
    }
    this.time = until; await flush();
  }
  async finish(promise) {
    let done = false;
    promise.finally(() => { done = true; }).catch(() => {});
    for (let i = 0; !done && i < 2000; i++) {
      await flush(); if (done) break;
      assert.ok(this.timers.length, 'Operation stalled without a scheduled wakeup');
      await this.advance(Math.max(0, Math.min(...this.timers.map(t => t.at)) - this.time));
    }
    assert.ok(done, 'Operation did not finish'); return promise;
  }
}

function fixture({ pulse = 1, settling = 300, momentary = true, timing = {}, door = 'closed' } = {}) {
  const config = { ...structuredClone(example.controllers[0].bolt), momentary, pulseSeconds: pulse };
  const clock = new Clock();
  const state = { outputs: { '3': false, '4': false }, events: [], door, journal: { inProgress: false, fault: false } };
  const request = async ({ url, method = 'GET', body }) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/config')) return { bridgeid: config.gatewayId };
    const id = /\/lights\/(\d+)/.exec(path)[1];
    const row = id === '3' ? config.lockRelay : config.unlockRelay;
    if (method === 'GET') {
      state.events.push(['read', id, state.outputs[id], clock.now()]);
      return { uniqueid: row.uniqueId, type: row.resourceType, modelid: row.modelId,
        manufacturername: row.manufacturer, state: { reachable: true, on: state.outputs[id] } };
    }
    assert.equal(state.journal.inProgress, true, 'Intent stays durable during every pulse write');
    state.events.push(['relay', id, body.on, clock.now()]);
    if (body.on || state.stuck !== id) state.outputs[id] = body.on;
    assert.ok(!(state.outputs['3'] && state.outputs['4']), 'Opposing outputs cannot overlap');
    if (body.on && state.ambiguousOn) throw Error('Synthetic lost acknowledgement');
    await state.onWrite?.(id, body.on);
    return [{ success: { ['/lights/' + id + '/state/on']: body.on } }];
  };
  const bolt = new DeconzSeparateBolt(config, 'synthetic', { request, clock, readOnly: false });
  const motor = { capabilities: { directional: true },
    read: async () => ({ door: state.door, evidence: 'closed-sensor', blocked: false, obstruction: Boolean(state.obstruction) }),
    write: async (command, { beforeWrite }) => {
      await beforeWrite();
      state.events.push(['motor', command, clock.now(), { ...state.outputs }]);
      state.door = command === 'close' ? 'closed' : 'not-closed';
    } };
  const engine = new MovementEngine({ door: motor, bolt, clock,
    feedback: { opening: 'timed', closing: 'sensor', bolt: momentary ? 'command' : 'relay', allowEstimatedBolting: false },
    timing: { pollMs: 10, motionTimeoutMs: 3000, openingMs: 1500, closedStableMs: 0,
      boltSettleMs: settling, ...timing },
    journal: { read: async () => structuredClone(state.journal), write: async value => {
      state.journal = value; state.events.push(['journal', value.inProgress, value.fault, clock.now()]);
    } } });
  return { engine, bolt, state, clock, relays: () => state.events.filter(e => e[0] === 'relay'),
    motors: () => state.events.filter(e => e[0] === 'motor') };
}

for (const pulse of [.1, .5, 1]) test(`pulse ${pulse}s and shared settling .3s run independently`, async () => {
  const f = fixture({ pulse }); await f.engine.initialize();
  const operation = f.engine.execute('open'); await f.clock.advance(300);
  assert.deepEqual(f.motors(), [['motor', 'open', 300, { '3': false, '4': pulse > .3 }]]);
  assert.equal(f.engine.state.bolt, 'unlocked'); assert.equal(f.engine.state.boltEstimated, true);
  await f.clock.finish(operation);
  assert.equal(f.engine.state.fault, null);
  assert.deepEqual(f.relays(), [['relay', '4', true, 0], ['relay', '4', false, pulse * 1000]]);
  assert.deepEqual(f.state.outputs, { '3': false, '4': false });
});

test('closing starts after settling, then extension waits for the unlock pulse OFF check', async () => {
  const f = fixture({ door: 'not-closed' }); await f.engine.initialize();
  const operation = f.engine.execute('close'); await f.clock.advance(999);
  assert.equal(f.motors()[0][2], 300); assert.equal(f.motors()[0][3]['4'], true);
  assert.deepEqual(f.relays(), [['relay', '4', true, 0]]);
  assert.equal(f.engine.busy, true); assert.equal(f.state.journal.inProgress, true);
  await f.clock.advance(1);
  assert.deepEqual(f.relays(), [['relay', '4', true, 0], ['relay', '4', false, 1000], ['relay', '3', true, 1000]]);
  const release = f.state.events.findIndex(e => e[0] === 'relay' && e[1] === '4' && !e[2]);
  const extension = f.state.events.findIndex(e => e[0] === 'relay' && e[1] === '3' && e[2]);
  assert.ok(f.state.events.slice(release + 1, extension).some(e => e[0] === 'read' && e[1] === '4' && e[2] === false));
  await f.clock.advance(300);
  assert.equal(f.engine.busy, true, 'Completed settling does not relinquish the pulse');
  assert.equal(f.state.journal.inProgress, true);
  await assert.rejects(f.engine.execute('unlock'), /controller_busy/);
  await assert.rejects(f.bolt.write(false, { beforeWrite: async () => {} }), /bolt_relay_busy/);
  await f.clock.finish(operation);
  assert.equal(f.engine.state.fault, null); assert.equal(f.engine.state.phase, 'closed');
  assert.equal(f.relays().at(-1)[3], 2000);
  assert.deepEqual(f.state.journal, { inProgress: false, fault: false });
});

test('release failure during travel faults and never repeats ON or extends', async () => {
  const f = fixture(); f.state.stuck = '4'; await f.engine.initialize();
  await f.clock.finish(f.engine.execute('open'));
  assert.equal(f.motors().length, 1); assert.equal(f.motors()[0][2], 300);
  assert.equal(f.engine.state.fault, 'bolt_relay_release_unconfirmed');
  assert.equal(f.engine.state.bolt, 'unknown'); assert.equal(f.engine.state.boltEstimated, false);
  assert.deepEqual(f.relays().map(e => e.slice(1, 3)), [['4', true], ['4', false], ['4', false], ['4', false]]);
  assert.equal(f.state.journal.fault, true); assert.equal(f.engine.busy, false);
  const writes = f.relays(); await f.engine.observe(); assert.deepEqual(f.relays(), writes);
});

test('an uncertain ON never starts travel and still attempts release', async () => {
  const f = fixture(); f.state.ambiguousOn = true; await f.engine.initialize();
  await f.clock.finish(f.engine.execute('open'));
  assert.equal(f.engine.state.fault, 'bolt_write_ambiguous'); assert.deepEqual(f.motors(), []);
  assert.deepEqual(f.relays().map(e => e.slice(1, 3)), [['4', true], ['4', false]]);
  assert.equal(f.state.outputs['4'], false);
});

test('settling starts at acknowledgement while the pulse duration includes acknowledgement latency', async () => {
  const f = fixture(); f.state.onWrite = async (_id, on) => { if (on) await f.clock.sleep(250); };
  await f.engine.initialize(); await f.clock.finish(f.engine.execute('open'));
  assert.equal(f.motors()[0][2], 550);
  assert.deepEqual(f.relays(), [['relay', '4', true, 0], ['relay', '4', false, 1000]]);
  assert.equal(f.engine.state.fault, null);
});

test('failed release during shutdown remains a durable fault', async () => {
  const f = fixture(); f.state.stuck = '4'; await f.engine.initialize();
  const operation = f.engine.execute('open'); await f.clock.advance(400); f.engine.stop();
  await f.clock.finish(operation);
  assert.equal(f.engine.state.fault, 'bolt_relay_release_unconfirmed');
  assert.equal(f.state.journal.fault, true); assert.equal(f.engine.busy, false);
  assert.equal(f.engine.state.bolt, 'unknown'); assert.equal(f.engine.state.boltEstimated, false);
  assert.equal(f.relays().filter(e => e[2]).length, 1);
});

for (const failure of ['stop', 'obstruction']) test(`${failure} during travel releases the owned pulse early`, async () => {
  const f = fixture(); await f.engine.initialize();
  const operation = f.engine.execute('open'); await f.clock.advance(400);
  if (failure === 'stop') f.engine.stop(); else f.state.obstruction = true;
  await f.clock.finish(operation);
  assert.equal(f.relays().length, 2); assert.ok(f.relays()[1][3] <= 410);
  assert.equal(f.state.outputs['4'], false); assert.equal(f.engine.busy, false);
  assert.equal(f.engine.state.boltEstimated, false);
  assert.equal(f.state.journal.inProgress, failure === 'stop');
  assert.equal(f.state.journal.fault, failure !== 'stop');
});

test('loss of closure while waiting for the old pulse blocks extension and releases unlock', async () => {
  const f = fixture({ door: 'not-closed' }); await f.engine.initialize();
  const operation = f.engine.execute('close'); await f.clock.advance(600); f.state.door = 'not-closed';
  await f.clock.finish(operation);
  assert.equal(f.engine.state.fault, 'closed_confirmation_lost');
  assert.deepEqual(f.relays().map(e => e.slice(1, 3)), [['4', true], ['4', false]]);
});

for (const override of [0, 100, 600]) test(`retraction override ${override}ms replaces shared settling`, async () => {
  const f = fixture({ timing: { openRetractSettleMs: override } }); await f.engine.initialize();
  await f.clock.finish(f.engine.execute('open'));
  assert.equal(f.motors()[0][2], override); assert.equal(f.engine.state.fault, null);
  assert.equal(f.relays()[1][3], 1000);
});

test('maintained separate outputs share retraction and extension settling without pulse cleanup', async () => {
  const f = fixture({ momentary: false }); await f.engine.initialize();
  await f.clock.finish(f.engine.execute('open')); assert.equal(f.motors()[0][2], 300);
  const start = f.clock.now(); await f.clock.finish(f.engine.execute('close'));
  assert.equal(f.motors()[1][2] - start, 300);
  assert.equal(f.clock.now() - f.relays().at(-1)[3], 300);
  assert.deepEqual(f.relays().map(e => e.slice(1, 3)), [['4', true], ['4', false], ['3', true]]);
  assert.equal(f.engine.state.boltEstimated, undefined); assert.equal(f.engine.state.fault, null);
});
