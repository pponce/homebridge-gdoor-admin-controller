import test from 'node:test';
import assert from 'node:assert/strict';
import { CoordinatorAccessories } from '../src/accessories.js';

function fixture() {
  const values=new Map();
  class HapStatusError extends Error {}
  const Characteristic=Object.fromEntries(['CurrentDoorState','TargetDoorState','ObstructionDetected','LockCurrentState','LockTargetState'].map(key=>[key,key]));
  const api={hap:{Characteristic,HapStatusError,HAPStatus:{SERVICE_COMMUNICATION_FAILURE:-70402}}};
  const runtime={status:()=>({actuationEnabled:true})};
  const accessories=new CoordinatorAccessories(api,{},runtime);
  for(const kind of ['garage','bolt'])accessories.active.set(kind,{kind,id:'example',service:{updateCharacteristic:(key,value)=>values.set(key,value)}});
  return {values,accessories,HapStatusError};
}

test('garage-driven bolt changes publish both lock current and target values, including external unlock',()=>{
  const f=fixture();
  for(const [phase,bolt,expected]of [['closed','locked',1],['unbolting','unlocked',0],['opening','unlocked',0],['open','unlocked',0],['closing','unlocked',0],['closed','locked',1],['closed','unlocked',0]]){
    f.accessories.update('example',{phase,bolt,target:phase==='opening'?'open':'closed',fault:null});
    assert.equal(f.values.get('LockCurrentState'),expected);assert.equal(f.values.get('LockTargetState'),expected);
  }
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
