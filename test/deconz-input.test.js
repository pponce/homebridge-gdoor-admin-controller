import test from 'node:test';
import assert from 'node:assert/strict';
import { DeconzInput, DeconzInputListener, deconzTimestamp } from '../src/deconz-input.js';
import { InputRouter } from '../src/input-routing.js';

function fixture(kind='button') {
  const state={ now:0, wall:Date.parse('2026-10-06T12:00:00Z'), stamp:Date.parse('2026-10-06T11:59:00Z'), value:kind==='button'?1002:'disarmed', configured:true, member:true, reachable:true, on:true, disarmed:true, identity:true, operations:[] };
  const source={ type:'deconz',kind,baseUrl:'http://192.0.2.2',gatewayId:'0011223344556677',resourceId:'3',uniqueId:'synthetic-input',resourceType:kind==='button'?'ZHASwitch':'ZHAAncillaryControl',modelId:'synthetic',manufacturer:'fixture',credentialRef:'test',...(kind==='keypad'?{alarmId:1}:{}) };
  const profile={ id:'input',name:'Input',enabled:true,source,trigger:kind==='button'?1002:'native-outcome',action:kind==='button'?'toggle':'keypad',motorPath:'primary',busyBehavior:'drop',rearmSeconds:0,timing:{} };
  const request=async ({url,method='GET'})=>{
    assert.equal(method,'GET');if(url.endsWith('/config'))return {bridgeid:source.gatewayId,websocketport:443};
    if(url.endsWith('/alarmsystems/1'))return {config:{configured:state.configured},state:{armstate:state.disarmed?'disarmed':'armed_away'},devices:state.member?{[source.uniqueId]:{}}:{}};
    return {uniqueid:state.identity?source.uniqueId:'replacement',type:source.resourceType,modelid:source.modelId,manufacturername:source.manufacturer,
      config:{reachable:state.reachable,on:state.on},state:{lastupdated:new Date(state.stamp).toISOString(),...(kind==='button'?{buttonevent:state.value}:{action:state.value})}};
  };
  const driver=new DeconzInput(source,'synthetic-key',{request});
  const engine={ initialized:true,busy:false,stopped:false,snapshot:()=>({busy:false,phase:'closed',fault:null}),execute:async(command)=>{state.operations.push(command);} };
  const clock={now:()=>state.now,wall:()=>state.wall};const router=new InputRouter(engine,[profile],clock);
  class Socket extends EventTarget{close(){this.dispatchEvent(new Event('close'));}}
  const listener=new DeconzInputListener({profile,driver,router,clock,socketFactory:()=>new Socket()});
  const open=async()=>{listener.running=true;await listener.tick();listener.socket.dispatchEvent(new Event('open'));await listener.tick();};
  const emit=()=>listener.message(JSON.stringify({t:'event',e:'changed',r:'sensors',id:'3',uniqueid:source.uniqueId,state:{lastupdated:new Date(state.stamp).toISOString(),...(kind==='button'?{buttonevent:state.value}:{action:state.value})}}));
  return {state,driver,router,listener,open,emit};
}
test('deCONZ startup/reconnect snapshots never become button presses and live timestamps cannot replay',async t=>{
  const f=fixture();t.after(()=>f.listener.stop());await f.open();assert.deepEqual(f.state.operations,[]);await f.emit();assert.deepEqual(f.state.operations,[]);
  f.state.stamp=f.state.wall;await f.emit();assert.deepEqual(f.state.operations,['open']);
  await f.emit();assert.deepEqual(f.state.operations,['open']);
  f.listener.socket.close();f.state.now=2500;await f.open();await f.emit();assert.deepEqual(f.state.operations,['open']);
});
test('periodic snapshots do not consume a fresh button notification that arrives afterward',async t=>{
  const f=fixture();t.after(()=>f.listener.stop());await f.open();
  f.state.now=5000;f.state.stamp=f.state.wall;
  await f.listener.tick();assert.deepEqual(f.state.operations,[]);
  await f.emit();assert.deepEqual(f.state.operations,['open']);
  await f.emit();assert.deepEqual(f.state.operations,['open']);
});
test('a healthy periodic input check does not discard a concurrent live button event',async t=>{
  const f=fixture();t.after(()=>f.listener.stop());await f.open();
  const inspect=f.driver.inspect.bind(f.driver);let release;let first=true;
  f.driver.inspect=()=>{if(first){first=false;return new Promise(resolve=>{release=resolve;});}return inspect();};
  f.state.now=5000;f.state.stamp=f.state.wall;
  const health=f.listener.tick();assert.equal(f.listener.checking,true);
  await f.emit();assert.deepEqual(f.state.operations,['open']);
  release(await inspect());await health;
  await f.emit();assert.deepEqual(f.state.operations,['open']);
});
test('keypad outcomes reverify identity, public alarm membership and disarmed state without any alarm writes',async t=>{
  const f=fixture('keypad');t.after(()=>f.listener.stop());await f.open();f.state.stamp=f.state.wall;f.state.disarmed=false;await f.emit();assert.deepEqual(f.state.operations,[]);
  f.state.stamp+=1;f.state.disarmed=true;await f.emit();assert.deepEqual(f.state.operations,['open']);
  await f.listener.tick();f.state.stamp+=1;f.state.value='invalid_code';await f.emit();assert.deepEqual(f.state.operations,['open','close']);
  await f.listener.tick();f.state.identity=false;f.state.stamp+=1;await f.emit();assert.deepEqual(f.state.operations,['open','close']);
});
test('public keypad responses without config.enrolled pass only with configured alarm membership and a reachable enabled source',async()=>{
  const f=fixture('keypad');
  assert.equal((await f.driver.inspect()).alarmDisarmed,true);
  for(const [key,code] of [['configured','input_alarm_mapping_changed'],['member','input_alarm_mapping_changed'],
    ['reachable','input_unreachable'],['on','input_unreachable'],['identity','input_resource_identity_mismatch']]){
    f.state[key]=false;await assert.rejects(f.driver.inspect(),error=>error.message===code);f.state[key]=true;
  }
  f.driver.source.resourceType='ZHASwitch';await assert.rejects(f.driver.inspect(),/input_resource_identity_mismatch/);
  assert.deepEqual(f.state.operations,[]);
});
test('deCONZ message parsing rejects unrelated resources, ambiguous timestamps and stale states',async()=>{
  const f=fixture();assert.ok(Number.isNaN(deconzTimestamp('none')));assert.equal(deconzTimestamp('2026-10-06T12:00:00'),f.state.wall);
  assert.equal(f.driver.event({t:'event',e:'changed',r:'sensors',id:'other',state:{buttonevent:1002,lastupdated:'2026-10-06T12:00:00'}}),null);
  f.state.identity=false;await assert.rejects(f.driver.inspect(),/identity_mismatch/);
});
