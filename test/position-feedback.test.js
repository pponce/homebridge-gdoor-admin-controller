import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfiguration } from '../src/config.js';
import { PositionFeedbackDoor, withPositionFeedback } from '../src/position-feedback.js';
import { TailwindDoor } from '../src/drivers.js';
import { MovementEngine } from '../src/engine.js';
import { PulseMotor } from '../src/pulse-motor.js';
import { CoordinatorRuntime } from '../src/runtime.js';
import { Fault } from '../src/fault.js';
import { Diagnostics } from '../src/diagnostics.js';
import { createHash } from 'node:crypto';
import { builtinSensors, sensorChoices } from '../homebridge-ui/public/position-sensors.js';
import { updateConnection, withConnections } from '../homebridge-ui/public/connections.js';

const example = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
const contact = (id, serviceId) => ({ id, name: id, activeValue: 0,
  connection: { type: 'homebridge', baseUrl: 'http://homebridge.example.invalid:51001', bridgeId: 'fixture-bridge',
    serviceId, accessoryIdentity: 'a'.repeat(64), credentialRef: 'contact-key' } });
function configuration() {
  const config = structuredClone(example), p = config.controllers[0];
  p.sensors = [contact('closed-contact', '2.15'), contact('open-contact', '3.15'), contact('unused-contact', '4.15')];
  p.feedback.opening = 'sensor'; p.feedback.closedSensor = 'closed-contact'; p.feedback.openSensor = 'open-contact';
  return config;
}

test('sensor selection preserves old configuration and validates references, mappings and ownership', () => {
  const old = validateConfiguration(example).controllers[0];
  assert.equal(Object.hasOwn(old, 'sensors'), false); assert.equal(Object.hasOwn(old.feedback, 'openSensor'), false);
  const config = configuration(), p = config.controllers[0];
  assert.equal(validateConfiguration(config).controllers[0].sensors.length, 3);
  for (const [mutate, error] of [
    [p => p.feedback.openSensor = 'missing', /feedback_sensor_not_found/],
    [p => p.feedback.closedSensor = 'open-contact', /duplicate_endpoint_sensor/],
    [p => p.sensors[0].activeValue = true, /invalid_sensor_mapping/],
    [p => p.sensors[0].connection.type = 'homekit', /unsupported_sensor_backend/],
    [p => p.sensors[0].connection.serviceId = 'name', /sensor_identity_required/],
    [p => p.sensors[1].id = 'closed-contact', /invalid_sensor_id/],
    [p => p.sensors[1].id = 'opener-open', /invalid_sensor_id/],
    [p => p.sensors[1].connection.serviceId = '2.15', /duplicate_hardware_owner/],
  ]) {
    const bad = configuration(); mutate(bad.controllers[0]); assert.throws(() => validateConfiguration(bad), error);
  }
  p.door.openSensorDoorIndex = 1;
  assert.deepEqual(builtinSensors(p).map(s => [s.id,s.input]), [['opener-closed',0],['opener-open',1]]);
  assert.deepEqual(sensorChoices(p,'open').map(s => s.id), ['opener-open','closed-contact','open-contact','unused-contact']);
  p.feedback.opening = 'timed';
  assert.equal(validateConfiguration(config).controllers[0].door.openSensorDoorIndex, 1);
  p.door = { type: 'homebridge', ...p.sensors[0].connection };
  assert.throws(() => validateConfiguration(config), /duplicate_hardware_owner/);
});

test('Homebridge connection updates include contact devices without clearing their pinned identity', () => {
  const config = withConnections(configuration());
  const bridge = config.connections.find(c => c.type === 'homebridge');
  const before = structuredClone(config.controllers[0].sensors);
  updateConnection(config, bridge.id, {...bridge, baseUrl:'http://homebridge.example.invalid:51002'});
  for (const sensor of config.controllers[0].sensors) assert.equal(sensor.connection.baseUrl,'http://homebridge.example.invalid:51002');
  before.forEach((s,i) => assert.equal(config.controllers[0].sensors[i].connection.accessoryIdentity,s.connection.accessoryIdentity));
});

test('sensor name edits retain approval; selected sources, contact mappings and hardware edits require review', () => {
  const config=validateConfiguration(configuration()),p=config.controllers[0];
  const runtime=new CoordinatorRuntime({configuration:config,storagePath:'/synthetic'});
  runtime.state={configuration:config,commissioned:{[p.id]:createHash('sha256').update(JSON.stringify(p)).digest('hex')}};
  const renamed=structuredClone(p);renamed.sensors[0].name='Closed contact renamed';
  assert.equal(runtime.retainsCommissioning(renamed),true);
  for(const edit of [p=>p.feedback.openSensor='unused-contact',p=>p.feedback.opening='timed',
    p=>p.sensors[0].activeValue=1,p=>p.sensors[0].connection.serviceId='5.15']){
    const changed=structuredClone(p);edit(changed);assert.equal(runtime.retainsCommissioning(changed),false);
  }
});

test('read-only diagnostics resolves selected external feedback and ignores unused contacts and Tailwind input',async()=>{
  const p=configuration().controllers[0];delete p.feedback.closedSensor;p.door.openSensorDoorIndex=1;
  const values=['Fixture','Test','open-contact'],info=serial=>({type:'3E',iid:1,characteristics:
    ['20','21','30'].map((type,i)=>({type,iid:i+2,value:i===2?serial:values[i],perms:['pr']}))});
  p.sensors[1].connection.accessoryIdentity=createHash('sha256').update(JSON.stringify(values)).digest('hex');
  let value=0;const requests=[];
  const credentials={[p.door.credentialRef]:'123456',[p.bolt.credentialRef]:'synthetic-key','contact-key':'031-45-154'};
  const diagnostics=new Diagnostics({controllers:[p]},async()=>credentials,{request:async args=>{
    requests.push(args);assert.ok(!args.body||args.body.data.type==='get','probe never writes');
    if(args.url.endsWith('/json'))return{result:'OK',data:{door1:{index:0,status:'open',disabled:false,lockup:false}}};
    if(args.url.endsWith('/accessories'))return{accessories:[{aid:1,services:[info('fixture-bridge')]},
      {aid:3,services:[info('open-contact'),{type:'80',iid:15,characteristics:[{type:'6A',iid:16,value:1,perms:['pr','ev']}]}]}]};
    if(args.url.includes('/characteristics?id='))return{characteristics:[{aid:3,iid:16,value}]};
    if(args.url.endsWith('/config'))return{bridgeid:p.bolt.gatewayId};
    return{uniqueid:p.bolt.uniqueId,type:p.bolt.resourceType,modelid:p.bolt.modelId,manufacturername:p.bolt.manufacturer,state:{reachable:true,on:false}};
  }});
  let result=await diagnostics.probe(p.id);assert.equal(result.compatible,true);assert.equal(result.door.state,'open');
  assert.equal(result.door.feedback,'open-sensor');
  assert.equal(requests.filter(r=>r.url.includes('/characteristics?id=')).length,1);
  value=1;result=await diagnostics.probe(p.id);assert.equal(result.door.state,'not-closed');
  value=2;result=await diagnostics.probe(p.id);assert.equal(result.compatible,false);assert.equal(result.door.error,'door_sensor_invalid');
});

test('only selected contacts replace endpoints; native obstruction/disabled flags and commands remain with the opener', async () => {
  const p = configuration().controllers[0], state = {closed:true,open:false};
  const resolved = [], writes = []; let base = {door:'open',evidence:'native',blocked:false,obstruction:false,disabled:false};
  const opener = {read:async()=>base,write:async command=>writes.push(command)};
  const door = withPositionFeedback(p,opener,sensor=>{
    resolved.push(sensor.id); return {read:async()=>({active:state[sensor.id === 'closed-contact' ? 'closed':'open']})};
  });
  assert.deepEqual(resolved,['closed-contact','open-contact']);
  assert.equal((await door.read()).door,'closed'); assert.equal((await door.read()).evidence,'closed-sensor');
  state.closed=false;assert.equal((await door.read()).door,'not-closed','native open cannot replace the selected inactive contact');
  state.open=true;assert.equal((await door.read()).door,'open');
  base={...base,blocked:true,obstruction:true,disabled:true};
  const reading=await door.read();assert.equal(reading.blocked,true);assert.equal(reading.obstruction,true);assert.equal(reading.disabled,true);
  state.closed=true;await assert.rejects(door.read(),/door_sensor_conflict/);
  await assert.rejects(door.write('open'),/door_sensor_conflict/);assert.deepEqual(writes,[]);
});

test('unselected contacts need no credentials and timed opening skips unused Tailwind extra input', async () => {
  const config=configuration(),p=config.controllers[0];p.feedback.closedSensor='opener-closed';p.feedback.opening='timed';p.door.openSensorDoorIndex=1;
  const runtime=new CoordinatorRuntime({storagePath:'/synthetic',configuration:config,
    credentials:async()=>({[p.door.credentialRef]:'123456',[p.bolt.credentialRef]:'synthetic-key'})});
  const hw=await runtime.makeDrivers(validateConfiguration(config).controllers[0]);
  assert.equal(hw.door.sensors.size,0);assert.equal(hw.door.capabilities.openSensor,false);
  const writes=[];
  const opener=new TailwindDoor(p.door,'123456',{readOnly:false,feedback:p.feedback,request:async({body})=>{
    if(body.data.type==='set'){writes.push(body.data.value);return{result:'OK'};}
    return{result:'OK',data:{door1:{index:0,status:'open',lockup:false,disabled:false}}};
  }});
  const door=withPositionFeedback(p,opener,()=>{throw Error('unused contact resolved');});
  assert.equal((await door.read()).door,'not-closed');await door.write('close');
  assert.deepEqual(writes,[{door_idx:0,cmd:'close'}]);
  p.feedback.opening='sensor';
  await assert.rejects(runtime.makeDrivers(validateConfiguration(config).controllers[0]),/credential_reference_missing/);
});

test('another contact can replace the configured Tailwind open sensor and override native closed feedback', async () => {
  const p=configuration().controllers[0];p.door.openSensorDoorIndex=1;
  let status='close',open=false,closed=false;
  const opener=new TailwindDoor(p.door,'123456',{feedback:p.feedback,request:async()=>({result:'OK',data:{
    door1:{index:0,status,disabled:false,lockup:false},
  }})}); // The unused extra input is deliberately absent.
  const door=new PositionFeedbackDoor(p,opener,s=>({read:async()=>({active:s.id==='open-contact'?open:closed})}));
  assert.equal((await door.read()).door,'not-closed');open=true;assert.equal((await door.read()).door,'open');
  open=false;closed=true;status='open';assert.equal((await door.read()).door,'closed');
  closed=false;p.feedback.openSensor='opener-open';
  const builtin=new TailwindDoor(p.door,'123456',{feedback:p.feedback,request:async()=>({result:'OK',data:{
    door1:{index:0,status:'close',disabled:false,lockup:false},door2:{index:1,status:'close',disabled:true,lockup:true},
  }})});
  const alternateClosed=new PositionFeedbackDoor(p,builtin,()=>({read:async()=>({active:closed})}));
  assert.equal((await alternateClosed.read()).door,'open','unselected primary closed contact cannot contradict selected contacts');
});

function engineFixture(position='closed') {
  const profile=configuration().controllers[0],m={now:0,position,locked:position==='closed',direction:null,writes:[],active:false,unavailable:false};
  let tick=()=>{};
  const clock={now:()=>m.now,sleep:async ms=>{m.now+=ms;tick(m);}};
  const opener={capabilities:{directional:true},read:async()=>({
    door:m.direction??'not-closed',evidence:'command',blocked:false,obstruction:false,
  }),write:async command=>{m.direction=command==='open'?'opening':'closing';m.writes.push(['door',command]);}};
  const door=new PositionFeedbackDoor(profile,opener,s=>({read:async()=>{
    if(m.unavailable)throw new Fault('homebridge_state_unavailable');
    return{active:m.position===(s.id==='closed-contact'?'closed':'open')};
  }}));
  const motor=new PulseMotor({readOnly:false,clock,openPulseMs:100,closePulseMs:100,interruption:true,
    relay:{capabilities:{inactiveWriteIdempotent:true},read:async()=>({active:m.active}),write:async active=>{
      m.active=active;m.writes.push(['relay',active]);
      if(active)m.direction=m.direction==='opening'?null:m.direction==='closing'?'opening':m.position==='closed'?'opening':'closing';
    }}});
  const engine=new MovementEngine({door,clock,motorPaths:{relay:motor},
    bolt:{read:async()=>({locked:m.locked,evidence:'relay'}),write:async locked=>{m.locked=locked;m.writes.push(['bolt',locked]);}},
    journal:{read:async()=>({inProgress:false,fault:false}),write:async()=>{}},feedback:profile.feedback,
    timing:{openingMs:1,closingMs:1,pollMs:10,motionTimeoutMs:500,boltTimeoutMs:50,closedStableMs:30,
      openRetractSettleMs:0,closeRetractSettleMs:0,boltSettleMs:0,interruptedOpenMarginMs:10000}});
  return{m,engine,tick:fn=>{tick=fn;},options:{motorPath:'relay',interruption:true,owner:'indoor',timing:{openingMs:1}}};
}

for(const relay of [false,true])test('selected contacts determine arrival and stable closure/bolting across routes; relay='+relay,async()=>{
  const f=engineFixture();await f.engine.initialize();assert.deepEqual(f.m.writes,[]);
  f.tick(m=>{if(m.direction==='opening'){m.position=m.now>=200?'open':'between';if(m.position==='open')m.direction=null;}});
  assert.equal((await f.engine.execute('open',relay?f.options:{})).phase,'open');
  assert.equal(f.engine.state.openEstimated,false);assert.ok(f.m.now>=200);assert.equal(f.engine.travel,null);
  const closeAt=f.m.now+100;let stableAt;
  f.tick(m=>{if(m.direction==='closing'){m.position=m.now>=closeAt?'closed':'between';if(m.position==='closed')m.direction=null;}if(m.position==='closed')stableAt??=m.now;});
  assert.equal((await f.engine.execute('close',relay?f.options:{})).phase,'closed');
  assert.ok(f.m.now>=stableAt+30);assert.equal(f.m.locked,true);assert.equal(f.engine.state.closeEstimated,false);
});

test('missing or lost selected open confirmation cannot become an estimate or retry movement',async()=>{
  for(const unavailable of [false,true]){
    const f=engineFixture();await f.engine.initialize();f.tick(m=>{m.position='between';m.unavailable=unavailable;});
    const result=await f.engine.execute('open');
    assert.equal(result.fault,unavailable?'homebridge_state_unavailable':'door_open_timeout');assert.equal(result.openEstimated,false);
    assert.deepEqual(f.m.writes,[['bolt',false],['door','open']]);
  }
});

test('external sensor observation and restart use endpoints without any command',async()=>{
  const f=engineFixture('open');await f.engine.initialize();assert.equal(f.engine.state.phase,'open');
  f.m.position='between';await f.engine.observe();assert.equal(f.engine.state.phase,'position-unknown');
  f.m.position='closed';await f.engine.observe();assert.equal(f.engine.state.phase,'closed');
  assert.deepEqual(f.m.writes,[]);
});

test('relay interruption with selected contacts accepts native direction but waits for sensor arrival on reversal',async()=>{
  const f=engineFixture('open');await f.engine.initialize();let interrupted=false;
  f.tick(m=>{
    if(m.direction==='closing'){m.position='between';if(f.engine.interruptionAllowed&&!interrupted){interrupted=true;assert.equal(f.engine.requestInterruption(),true);}}
    if(m.direction==='opening')m.position=m.now>=200?'open':'between';
  });
  const result=await f.engine.execute('close',f.options);
  assert.equal(interrupted,true);assert.equal(result.phase,'open');assert.equal(result.openEstimated,false);
  assert.ok(f.m.now>=200);assert.equal(f.engine.travel,null);assert.equal(f.m.locked,false);
});
