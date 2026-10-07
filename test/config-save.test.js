import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurationSave } from '../homebridge-ui/public/config-save.js';
const configuration={managementPort:27773,controllers:[{id:'synthetic',name:'Example'}]};
function fixture(connected=true){
  const calls=[];let blocks=[{platform:'GDoorAndBoltCoordinator',name:'Custom name',_bridge:{username:'synthetic-bridge',port:12345},custom:'preserved'}];
  const hb={request:async(path,body)=>{calls.push([path,structuredClone(body)]);
    if(path==='/validate')return body.configuration;
    if(path==='/review')return{review:{token:'synthetic-token',configuration:body.configuration,requiresCommissioning:[]}};
    if(path==='/apply')return{settings:{configuration,revision:3}};
    if(path==='/cancel')return{};
    throw Error('unexpected');},getPluginConfig:async()=>structuredClone(blocks),updatePluginConfig:async(value)=>{calls.push(['update']);blocks=structuredClone(value);},
    savePluginConfig:async()=>{calls.push(['save']);return blocks;}};
  const flow=new ConfigurationSave(hb);flow.load({configuration,connected,revision:2,saved:connected});
  return{flow,hb,calls,blocks:()=>blocks};
}
test('managed save waits for native persistence, preserves bridge metadata and uses the reviewed snapshot',async()=>{
  const f=fixture();assert.equal(f.flow.canClose,true);f.flow.changed();assert.equal(f.flow.canClose,false);
  const draft=structuredClone(configuration);await f.flow.prepare(draft);draft.controllers[0].name='Unreviewed mutation';
  assert.equal(f.flow.review.configuration.controllers[0].name,'Example');
  let release;f.hb.savePluginConfig=()=>new Promise(resolve=>{release=resolve;});
  const saving=f.flow.save();while(!release)await new Promise(setImmediate);
  assert.equal(f.flow.canClose,false);assert.equal(f.flow.canEdit,false);
  release(true);await saving;assert.equal(f.flow.canClose,true);
  assert.deepEqual(f.blocks()[0]._bridge,{username:'synthetic-bridge',port:12345});
  assert.equal(f.blocks()[0].name,'Custom name');assert.equal(f.blocks()[0].custom,'preserved');
  assert.deepEqual(f.blocks()[0].controllers,configuration.controllers);
  assert.deepEqual(f.calls.map(c=>c[0]),['/validate','/review','/apply','update']);
});
test('initial setup saves through Homebridge without calling managed apply',async()=>{
  const f=fixture(false);assert.equal(f.flow.canClose,false);await f.flow.prepare(configuration);await f.flow.save();
  assert.deepEqual(f.calls.map(c=>c[0]),['/validate','update','save']);assert.equal(f.flow.canClose,true);
});
test('failed native save retries only Homebridge, keeps controls held and rejects new drafts',async()=>{
  for(const reject of [true,false]){
    const f=fixture();await f.flow.prepare(configuration);const original=f.hb.savePluginConfig;
    f.hb.savePluginConfig=async()=>{if(reject)throw Error('network');return false;};
    await assert.rejects(f.flow.save());assert.equal(f.flow.phase,'sync-pending');assert.equal(f.flow.canClose,false);
    assert.throws(()=>f.flow.changed(),/finish_save_first/);await assert.rejects(f.flow.prepare(configuration),/finish_save_first/);
    f.hb.savePluginConfig=original;await f.flow.save();
    assert.equal(f.calls.filter(c=>c[0]==='/apply').length,1);assert.equal(f.flow.canClose,true);
  }
});
test('uncertain apply is not retried and cannot produce a success state or native save',async()=>{
  const f=fixture();const request=f.hb.request;
  f.hb.request=async(path,body)=>{if(path==='/apply'){f.calls.push([path]);throw Error('response_lost');}return request(path,body);};
  await f.flow.prepare(configuration);await assert.rejects(f.flow.save());
  assert.equal(f.flow.phase,'save-uncertain');assert.equal(f.flow.canClose,false);
  await assert.rejects(f.flow.save(),/review_required/);
  assert.deepEqual(f.calls.map(c=>c[0]),['/validate','/review','/apply']);
  // Reloading saved managed settings may stage the confirmed snapshot without
  // another apply or disk save, allowing the native bottom Save to finish.
  await f.flow.stage(configuration);assert.equal(f.calls.at(-1)[0],'update');
});
test('editing or cancelling review invalidates its token and prevents stale saves',async()=>{
  for(const cancel of [true,false]){
    const f=fixture();await f.flow.prepare(configuration);if(cancel)await f.flow.cancel();else f.flow.changed();
    await assert.rejects(f.flow.save(),/review_required/);assert.equal(f.flow.canClose,false);
    assert.equal(f.calls.some(c=>c[0]==='/apply'||c[0]==='save'),false);
  }
});
test('staging is memory-only and preserves the newest native bridge settings',async()=>{
  const f=fixture();f.hb.getPluginConfig=async()=>[{_bridge:{port:43210},name:'Latest bridge name'}];
  await f.flow.stage(configuration);assert.equal(f.blocks()[0]._bridge.port,43210);
  assert.equal(f.blocks()[0].name,'Latest bridge name');assert.deepEqual(f.calls,[['update']]);
});
