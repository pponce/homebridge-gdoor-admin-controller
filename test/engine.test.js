import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementEngine } from '../src/engine.js';
import { Fault } from '../src/fault.js';

function fixture(options = {}) {
  const model = { door: 'closed', locked: true, blocked: false, obstruction: false,
    now: 0, writes: [], reads: 0, journal: { inProgress: false, fault: false }, ...options.model };
  const clock = { now: () => model.now, sleep: async ms => { model.now += ms; options.tick?.(model); } };
  const journal = {
    read: async () => structuredClone(model.journal),
    write: async value => { options.journal?.(value, model); model.journal = structuredClone(value); },
  };
  const door = {
    read: async () => { model.reads++; options.read?.(model); return { door: model.door, blocked: model.blocked,
      obstruction: model.obstruction, evidence: 'closed-sensor' }; },
    write: async command => { assert.equal(model.journal.inProgress, true); assert.equal(model.locked, false);
      model.writes.push(['door', command, model.now]); options.door?.(command, model); },
  };
  const bolt = {
    read: async () => ({ locked: model.locked, evidence: 'relay' }),
    write: async locked => { assert.equal(model.journal.inProgress, true);
      model.writes.push(['bolt', locked, model.now]); if (options.bolt) options.bolt(locked, model); else model.locked = locked; },
  };
  const engine = new MovementEngine({ door, bolt, journal, clock,
    feedback: { opening: 'timed', closing: 'sensor', bolt: 'relay', allowEstimatedBolting: false, ...options.feedback },
    timing: { pollMs: 10, boltTimeoutMs: 50, motionTimeoutMs: 500,
      openRetractSettleMs: 20, closeRetractSettleMs: 40, closedStableMs: 20,
      boltSettleMs: 20, openingMs: 100, closingMs: 200, ...options.timing } });
  return { engine, model };
}

test('startup reassesses clean, interrupted and faulted journals without hardware writes', async () => {
  for (const journal of [{ inProgress: false, fault: false }, { inProgress: true, fault: false }, { inProgress: false, fault: true }]) {
    const { engine, model } = fixture({ model: { journal, locked: false } });
    await engine.initialize();
    assert.equal(engine.state.fault, null); await engine.observe();
    assert.deepEqual(model.writes, []);
  }
});

test('a command arriving during an idle read claims the worker without overlapping reads and actuation', async () => {
  const {engine,model}=fixture({door:(_command,m)=>{m.door='not-closed';}});
  await engine.initialize();const read=engine.door.read;let release;
  engine.door.read=()=>{engine.door.read=read;return new Promise(resolve=>{release=resolve;});};
  const observed=engine.observe();
  assert.equal(engine.snapshot().busy,false);
  const operation=engine.execute('open');
  assert.equal(engine.busy,true);assert.deepEqual(model.writes,[]);assert.equal(model.journal.inProgress,false);
  await assert.rejects(engine.execute('close'),/controller_busy/);
  release(await read());await observed;await operation;
  assert.equal(engine.state.phase,'open');assert.equal(engine.state.fault,null);
  assert.deepEqual(model.writes.map(row=>row.slice(0,2)),[['bolt',false],['door','open']]);
});

test('an identity fault discovered by an outstanding idle check blocks an already admitted command', async () => {
  const {engine,model}=fixture();await engine.initialize();let reject;
  engine.door.read=()=>new Promise((_resolve,fail)=>{reject=fail;});
  const observed=engine.observe();const operation=engine.execute('open');
  reject(new Fault('bolt_resource_identity_mismatch'));await observed;await operation;
  assert.equal(engine.state.fault,'bolt_resource_identity_mismatch');assert.deepEqual(model.writes,[]);
});

test('successful operation reads clear a recovered idle communication error during closing', async () => {
  const {engine,model}=fixture({model:{door:'not-closed',locked:false},door:(_command,m)=>{m.door='closed';}});
  await engine.initialize();const read=engine.door.read;
  engine.door.read=async()=>{throw new Fault('door_read_failed');};
  await engine.observe();assert.equal(engine.state.unavailable,'door_read_failed');
  engine.door.read=read;let healthyDuringClose=false;
  const write=engine.door.write;engine.door.write=async command=>{healthyDuringClose=engine.state.unavailable===null;await write(command);};
  await engine.execute('close');assert.equal(healthyDuringClose,true);
  assert.equal(engine.state.unavailable,null);assert.equal(engine.state.phase,'closed');assert.equal(engine.state.fault,null);
});

test('open retracts, settles, commands once, then estimates from closed-sensor departure', async () => {
  const { engine, model } = fixture({ door: (_command, m) => { m.departAt = m.now + 50; },
    tick: m => { if (m.departAt && m.now >= m.departAt) m.door = 'not-closed'; } });
  await engine.initialize(); const state = await engine.execute('open');
  assert.equal(state.phase, 'open'); assert.equal(state.openEstimated, true); assert.equal(state.door, 'not-closed');
  assert.deepEqual(model.writes.map(x => x.slice(0, 2)), [['bolt', false], ['door', 'open']]);
  assert.equal(model.writes[1][2] - model.writes[0][2], 20);
  assert.equal(model.now, model.departAt + 100);
  assert.deepEqual(model.journal, { inProgress: false, fault: false });
});

test('already retracted open still waits; fully-open sensor mode never uses timer', async () => {
  const { engine, model } = fixture({ model: { locked: false }, feedback: { opening: 'sensor' }, door: (_c, m) => { m.door = 'not-closed'; } });
  await engine.initialize(); await engine.execute('open');
  assert.deepEqual(model.writes, [['door', 'open', 20]]);
  assert.equal(engine.state.fault, 'door_open_timeout'); assert.equal(engine.state.openEstimated, false);
});

test('close skips an already-OFF write, retains configured settling and bolts after continuous closed stability', async () => {
  const { engine, model } = fixture({ model: { door: 'not-closed', locked: false },
    door: (_command, m) => { m.closeAt = m.now + 80; },
    tick: m => { if (m.closeAt && m.now >= m.closeAt) m.door = 'closed'; } });
  await engine.initialize(); await engine.execute('close');
  assert.equal(engine.state.phase, 'closed'); assert.equal(engine.state.closeEstimated, false);
  assert.deepEqual(model.writes.map(x => x.slice(0, 2)), [['door', 'close'], ['bolt', true]]);
  assert.equal(model.writes[0][2], 40); assert.equal(model.writes[1][2], model.closeAt + 20);
  assert.equal(model.now, model.closeAt + 40); // No obsolete second pre-bolt wait.
});

test('close bounces restart the closed stability interval', async () => {
  const { engine, model } = fixture({ model: { door: 'not-closed', locked: false },
    tick: m => { if (m.now >= 60) m.door = m.now === 70 ? 'not-closed' : 'closed'; } });
  await engine.initialize(); await engine.execute('close');
  assert.equal(model.writes.find(x => x[0] === 'bolt' && x[1])[2], 100);
});

test('a re-extension during close sends one corrective OFF without another motor command', async () => {
  const { engine, model } = fixture({ model: { door: 'not-closed', locked: false },
    tick: m => { if (m.now === 60) m.locked = true; if (m.now >= 100) m.door = 'closed'; } });
  await engine.initialize(); await engine.execute('close');
  assert.equal(engine.state.phase, 'closed');
  assert.deepEqual(model.writes.map(x => x.slice(0, 2)), [['door', 'close'], ['bolt', false], ['bolt', true]]);
});

test('a stuck bolt during close times out with no retry or second motor command', async () => {
  const { engine, model } = fixture({ model: { door: 'not-closed', locked: false },
    tick: m => { if (m.now >= 60) m.locked = true; }, bolt: (locked, m) => { if (m.now < 60) m.locked = locked; } });
  await engine.initialize(); await engine.execute('close');
  assert.equal(engine.state.fault, 'bolt_retract_timeout');
  assert.equal(model.writes.filter(x => x[0] === 'door').length, 1);
  assert.equal(model.writes.filter(x => x[0] === 'bolt').length, 1);
});

test('zero-wait closing uses one recent assembly check before the motor command', async () => {
  const {engine,model}=fixture({model:{door:'not-closed',locked:false},timing:{closeRetractSettleMs:0}});
  await engine.initialize();model.reads=0;let readsAtMotor;
  engine.door.write=async(command,{beforeWrite})=>{
    await beforeWrite();assert.equal(model.journal.inProgress,true);assert.equal(model.locked,false);
    readsAtMotor=model.reads;model.writes.push(['door',command,model.now]);model.door='closed';
  };
  await engine.execute('close');
  assert.equal(readsAtMotor,1);assert.deepEqual(model.writes[0],['door','close',0]);
  assert.equal(model.writes.some(([kind,value])=>kind==='bolt'&&value===false),false);
  assert.equal(engine.state.phase,'closed');assert.equal(engine.state.fault,null);
});

test('an initially-ON bolt closes after unlock acknowledgement at zero wait, or after OFF confirmation and positive settling', async () => {
  for(const settling of [0,20]){
    const {engine,model}=fixture({model:{door:'not-closed',locked:false},timing:{closeRetractSettleMs:settling},
      bolt:(locked,m)=>{if(locked)m.locked=true;else m.retractAt=m.now+30;},
      tick:m=>{if(m.retractAt!==undefined&&m.now>=m.retractAt){m.locked=false;delete m.retractAt;}if(m.closeAt&&m.now>=m.closeAt)m.door='closed';}});
    await engine.initialize();model.locked=true;
    engine.door.write=async(command,{beforeWrite})=>{
      await beforeWrite();assert.equal(model.locked,settling===0);
      assert.equal(engine.state.bolt,settling===0?'locked':'unlocked','No fabricated OFF report');
      assert.equal(model.now,settling===0?0:50);
      model.writes.push(['door',command,model.now]);model.closeAt=model.now+80;
    };
    await engine.execute('close');
    assert.deepEqual(model.writes.map(x=>x.slice(0,2)),[['bolt',false],['door','close'],['bolt',true]]);
    assert.equal(engine.state.phase,'closed');assert.equal(engine.state.fault,null);
  }
});

test('zero-wait closing never repeats a pending unlock or bolts a closed door before OFF is observed', async () => {
  const {engine,model}=fixture({model:{door:'not-closed',locked:false},timing:{closeRetractSettleMs:0},bolt:()=>{},
    tick:m=>{if(m.now>=20)m.door='closed';}});
  await engine.initialize();model.locked=true;
  engine.door.write=async(command,{beforeWrite})=>{await beforeWrite();model.writes.push(['door',command,model.now]);};
  await engine.execute('close');
  assert.deepEqual(model.writes.map(x=>x.slice(0,2)),[['bolt',false],['door','close']]);
  assert.equal(engine.state.fault,'bolt_retract_timeout');
});

test('zero-wait closing does not pulse after an ambiguous unlock acknowledgement', async () => {
  const {engine,model}=fixture({model:{door:'not-closed',locked:false},timing:{closeRetractSettleMs:0},
    bolt:()=>{throw new Fault('bolt_write_ambiguous');}});
  await engine.initialize();model.locked=true;await engine.execute('close');
  assert.deepEqual(model.writes.map(x=>x.slice(0,2)),[['bolt',false]]);
  assert.equal(engine.state.fault,'bolt_write_ambiguous');
});

test('slow motor preparation refreshes an old OFF sample and blocks a now-locked start', async () => {
  const {engine,model}=fixture({model:{door:'not-closed',locked:false},timing:{closeRetractSettleMs:0}});
  await engine.initialize();model.reads=0;
  engine.door.write=async(_command,{beforeWrite})=>{
    model.now+=1600;model.locked=true;await beforeWrite();assert.fail('must not reach actuator');
  };
  await engine.execute('close');
  assert.equal(model.reads,2);assert.equal(engine.state.fault,'motor_precondition_lost');assert.deepEqual(model.writes,[]);
});

test('an extension after the initial OFF check is corrected during closing without another motor command', async () => {
  const {engine,model}=fixture({model:{door:'not-closed',locked:false},timing:{closeRetractSettleMs:0},
    tick:m=>{if(m.now>=40)m.door='closed';}});
  await engine.initialize();
  engine.door.write=async(command,{beforeWrite})=>{
    await beforeWrite();model.writes.push(['door',command,model.now]);model.locked=true;
  };
  await engine.execute('close');
  assert.deepEqual(model.writes.map(x=>x.slice(0,2)),[['door','close'],['bolt',false],['bolt',true]]);
  assert.equal(engine.state.phase,'closed');assert.equal(engine.state.fault,null);
});

test('ambiguous motor result latches durable fault and never retries or switches route', async () => {
  const { engine, model } = fixture({ door: () => { throw new Fault('door_write_ambiguous'); } });
  await engine.initialize(); await engine.execute('open');
  assert.equal(engine.state.fault, 'door_write_ambiguous'); assert.equal(model.journal.fault, true);
  await assert.rejects(engine.execute('open'), /engine_unavailable/);
  assert.equal(model.writes.filter(x => x[0] === 'door').length, 1);
});

test('journal failure precedes all actuation', async () => {
  const { engine, model } = fixture({ journal: () => { throw Error('private diagnostic'); } });
  await engine.initialize(); await engine.execute('open');
  assert.equal(engine.state.fault, 'journal_write_failed'); assert.deepEqual(model.writes, []);
});

test('manual unlock is preserved through idle observations and blocks automatic locking', async () => {
  const { engine, model } = fixture(); await engine.initialize(); model.locked = false;
  await engine.observe(); await engine.observe();
  assert.equal(engine.state.externalUnlockOverride, true);
  await assert.rejects(engine.execute('observed-close'), /manual_unlock_override/);
  assert.deepEqual(model.writes, []);
  await engine.execute('lock'); assert.equal(engine.state.externalUnlockOverride, false);
  assert.deepEqual(model.writes.map(x => x.slice(0, 2)), [['bolt', true]]);
});

test('lock tile operation cannot extend while the door is not closed', async () => {
  const { engine, model } = fixture({ model: { door: 'not-closed', locked: false } });
  await engine.initialize(); await engine.execute('lock');
  assert.equal(engine.state.fault, 'locking_requires_closed_sensor'); assert.deepEqual(model.writes, []);
});

test('timed close requires explicit estimated bolting and remains labelled estimated', async () => {
  for (const allowed of [false, true]) {
    const { engine, model } = fixture({ model: { door: 'not-closed', locked: false },
      feedback: { closing: 'timed', allowEstimatedBolting: allowed } });
    await engine.initialize(); await engine.execute('close');
    assert.equal(engine.state.fault, allowed ? null : 'estimated_bolting_not_allowed');
    assert.equal(engine.state.closeEstimated, allowed);
    assert.equal(model.writes.some(x => x[0] === 'bolt' && x[1]), allowed);
  }
});

test('obstruction, reversal and extension during open hold without corrective door commands', async () => {
  for (const problem of ['obstruction', 'reversal', 'bolt']) {
    const { engine, model } = fixture({ door: (_c, m) => { m.door = 'not-closed'; },
      tick: m => { if (m.now >= 50) { if (problem === 'obstruction') m.obstruction = true;
        if (problem === 'reversal') m.door = 'closing'; if (problem === 'bolt') m.locked = true; } } });
    await engine.initialize(); await engine.execute('open');
    assert.equal(engine.state.phase, 'fault'); assert.equal(model.writes.filter(x => x[0] === 'door').length, 1);
  }
});

test('competing requests never queue and shutdown preserves intent for observation after restart', async () => {
  const { engine, model } = fixture({ door: (_c, m) => { m.door = 'not-closed'; } });
  await engine.initialize(); const operation = engine.execute('open');
  await assert.rejects(engine.execute('close'), /controller_busy/);
  engine.stop(); await operation;
  assert.equal(engine.state.fault, null); assert.equal(engine.state.reconciling, true);
  assert.equal(model.journal.fault, false);
});
