import test from 'node:test';
import assert from 'node:assert/strict';
import { CoordinatorAccessories } from '../src/accessories.js';

function fixture() {
  const values=new Map();const events=[];const pending=new Map();let serial=0;
  class HapStatusError extends Error {}
  const Characteristic=Object.fromEntries(['CurrentDoorState','TargetDoorState','ObstructionDetected','LockCurrentState','LockTargetState'].map(key=>[key,key]));
  const api={hap:{Characteristic,HapStatusError,HAPStatus:{SERVICE_COMMUNICATION_FAILURE:-70402}}};
  const status={actuationEnabled:true,state:{}};
  const entry={engine:{observedAt:Date.now()},profile:{timing:{idlePollSeconds:2}}};
  const runtime={status:()=>status,entry:()=>entry};
  const timers={setTimeout(fn,ms){const id=++serial;pending.set(id,{fn,ms});return id;},clearTimeout(id){pending.delete(id);}};
  const accessories=new CoordinatorAccessories(api,{},runtime,[],timers);
  for(const kind of ['garage','bolt'])accessories.active.set(kind,{kind,id:'example',service:{
    updateCharacteristic:(key,value)=>values.set(key,value),
    getCharacteristic:key=>({sendEventNotification(value){values.set(key,value);events.push([key,value]);}})
  }});
  return {values,events,pending,accessories,HapStatusError,status,entry,
    publish(state){status.state=state;accessories.update('example',state);},
    tick(){const callbacks=[...pending.values()];pending.clear();for(const {fn,ms}of callbacks){assert.equal(ms,2000);fn();}}
  };
}

test('garage-driven bolt changes publish both lock current and target values, including external unlock',()=>{
  const f=fixture();
  for(const [phase,bolt,expected]of [['closed','locked',1],['unbolting','unlocked',0],['opening','unlocked',0],['open','unlocked',0],['closing','unlocked',0],['closed','locked',1],['closed','unlocked',0]]){
    f.accessories.update('example',{phase,bolt,target:phase==='opening'?'open':'closed',fault:null});
    assert.equal(f.values.get('LockCurrentState'),expected);assert.equal(f.values.get('LockTargetState'),expected);
  }
});

test('terminal garage state is pushed even when already cached, with bounded reaffirmation and no hardware calls',()=>{
  const f=fixture();
  // A cached value alone cannot prove a subscriber received its notification.
  f.values.set('CurrentDoorState',1);f.values.set('TargetDoorState',1);
  const closed={phase:'closed',door:'closed',bolt:'locked',target:'closed',busy:false,fault:null};
  f.publish(closed);
  const pair=[['TargetDoorState',1],['CurrentDoorState',1]];
  assert.deepEqual(f.events,pair);
  f.publish(closed);assert.equal(f.events.length,2);assert.equal(f.pending.size,1);
  f.tick();f.tick();assert.deepEqual(f.events,[...pair,...pair,...pair]);assert.equal(f.pending.size,0);
  for(let i=0;i<10;i++)f.publish(closed);
  assert.equal(f.events.length,6);assert.equal(f.pending.size,0);
});

test('new movement cancels old terminal notifications and only the new completed direction is reaffirmed',()=>{
  const f=fixture();
  f.publish({phase:'closed',door:'closed',bolt:'locked',target:'closed',busy:false});
  f.publish({phase:'closed',door:'closed',bolt:'locked',target:'open',busy:true});
  f.tick();assert.equal(f.events.length,2);assert.equal(f.values.get('TargetDoorState'),0);
  f.publish({phase:'opening',door:'not-closed',bolt:'unlocked',target:'open',busy:true});
  f.publish({phase:'open',door:'not-closed',bolt:'unlocked',target:'open',openEstimated:true,busy:false});
  f.tick();f.tick();assert.deepEqual(f.events.slice(2),Array(3).fill([['TargetDoorState',0],['CurrentDoorState',0]]).flat());
  assert.equal(f.values.get('CurrentDoorState'),0);
});

test('scheduled reaffirmation rechecks live availability, freshness, direction and worker ownership',()=>{
  const changes=[
    f=>{f.status.actuationEnabled=false;},
    f=>{f.status.state.fault='closed_confirmation_lost';},
    f=>{f.status.state.unavailable='door_read_failed';},
    f=>{f.status.state.phase='opening';f.status.state.target='open';},
    f=>{f.status.state.busy=true;},
    f=>{f.entry.engine.observedAt=Date.now()-60000;},
    f=>{f.accessories.stop();},
    f=>{f.accessories.runtime.entry=()=>{throw Error('controller_not_found');};}
  ];
  for(const change of changes){
    const f=fixture();f.publish({phase:'closed',door:'closed',bolt:'locked',target:'closed',busy:false});
    change(f);f.tick();assert.equal(f.events.length,2);assert.equal(f.pending.size,0);
  }
});

test('an open startup with no previous command has matching garage target and current state',()=>{
  const f=fixture();const state={phase:'open',door:'open',bolt:'unlocked',target:null,busy:false};
  f.publish(state);assert.equal(f.accessories.doorTarget(state),0);
  assert.equal(f.values.get('CurrentDoorState'),0);assert.equal(f.values.get('TargetDoorState'),0);
});

test('garage reports the requested direction while retracting and all characteristics recover after read failure',()=>{
  const f=fixture();
  for(const [target,expected]of [['open',2],['closed',3]]){
    f.accessories.update('example',{phase:'unbolting',bolt:'unlocked',target,fault:null});
    assert.equal(f.values.get('CurrentDoorState'),expected);
  }
  f.accessories.update('example',{phase:'unavailable',bolt:'unlocked',target:'closed',unavailable:'door_read_failed',fault:null});
  assert.ok(f.values.get('CurrentDoorState') instanceof f.HapStatusError);
  assert.ok(f.values.get('LockCurrentState') instanceof f.HapStatusError);
  f.accessories.update('example',{phase:'closing',bolt:'unlocked',target:'closed',unavailable:null,fault:null});
  assert.equal(f.values.get('CurrentDoorState'),3);assert.equal(f.values.get('TargetDoorState'),1);
  assert.equal(f.values.get('LockCurrentState'),0);assert.equal(f.values.get('LockTargetState'),0);
});
