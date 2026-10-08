import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfiguration } from '../src/config.js';
import { withConnections, endpoints, connectionUsers, updateConnection, selectConnection, connectionOrigin } from '../homebridge-ui/public/connections.js';
const raw=JSON.parse(await readFile(new URL('../examples/input-routing-config.json',import.meta.url),'utf8'));
const fixture=()=>validateConfiguration(raw);
test('legacy device addresses import once, deduplicate across routes and preserve controller bytes',()=>{
  const before=fixture();const legacy=structuredClone(before);delete legacy.connections;
  const imported=withConnections(legacy);
  assert.equal(JSON.stringify(imported.controllers),JSON.stringify(legacy.controllers));assert.equal(legacy.connections,undefined);
  assert.deepEqual(withConnections(imported),imported);
  const deconz=imported.connections.filter(row=>row.type==='deconz');assert.equal(deconz.length,1);
  assert.equal(imported.connections.find(row=>row.type==='tailwind').doorCount,null,'Used door indices cannot establish device door count');
  assert.deepEqual(connectionUsers(imported,deconz[0]).map(p=>p.id),[legacy.controllers[0].id]);
});
test('shared edit updates every matching device and virtual keypad, leaving other connections intact',()=>{
  const configuration=fixture(),profile=configuration.controllers[0];profile.keypad={baseUrl:profile.bolt.baseUrl,credentialRef:profile.bolt.credentialRef,gatewayId:profile.bolt.gatewayId,alarmId:1};
  const beforeDoor=structuredClone(profile.door),shared=configuration.connections.find(row=>row.type==='deconz');
  const bindings=endpoints(configuration).filter(row=>row.connection.baseUrl===shared.baseUrl);
  assert.ok(bindings.length>=3);
  updateConnection(configuration,shared.id,{...shared,baseUrl:'http://192.0.2.55:8080',credentialRef:'new-deconz-key'});
  assert.deepEqual(configuration.controllers[0].door,beforeDoor);
  for(const {connection} of endpoints(configuration).filter(row=>(row.connection.type??'deconz')==='deconz')){
    assert.equal(connection.baseUrl,'http://192.0.2.55:8080');assert.equal(connection.credentialRef,'new-deconz-key');
  }
  assert.equal(configuration.controllers[0].bolt.uniqueId,profile.bolt.uniqueId,'Pinned identity is retained for explicit verification at the new address');
  validateConfiguration(configuration);
});
test('catalog names/counts leave operational profiles intact and invalid smaller counts are atomic',()=>{
  const configuration=fixture(),shared=configuration.connections.find(row=>row.type==='tailwind');configuration.controllers[0].door.doorIndex=1;
  const profiles=structuredClone(configuration.controllers);
  updateConnection(configuration,shared.id,{...shared,name:'Driveway Tailwind',doorCount:2});assert.deepEqual(configuration.controllers,profiles);
  const before=structuredClone(configuration);
  assert.throws(()=>updateConnection(configuration,shared.id,{...shared,doorCount:1}),/tailwind_door_out_of_range/);assert.deepEqual(configuration,before);
});
test('catalog rejects raw secrets, duplicate addresses/keys, invalid counts and credentials embedded in URLs',()=>{
  for(const change of [row=>row.secret='no',row=>row.token='no',row=>row.doorCount=4,row=>row.baseUrl='http://name:password@example.invalid']){
    const configuration=fixture();change(configuration.connections.find(row=>row.type==='tailwind'));assert.throws(()=>validateConfiguration(configuration));
  }
  const configuration=fixture();configuration.connections.push({...configuration.connections[0],id:'another-id'});assert.throws(()=>validateConfiguration(configuration),/duplicate_connection/);
  assert.equal(connectionOrigin('192.0.2.10:8080',{allowBare:true}),'http://192.0.2.10:8080');
});
test('selecting another gateway clears pinned identities but preserves mappings and routes',()=>{
  const configuration=fixture(),bolt=configuration.controllers[0].bolt;
  selectConnection(bolt,{type:'deconz',baseUrl:'http://192.0.2.99:8080',credentialRef:'other-key'});
  assert.equal(bolt.lockedValue,true);assert.equal(bolt.type,'deconz');assert.equal(bolt.uniqueId,undefined);assert.equal(bolt.gatewayId,undefined);
  assert.equal(bolt.baseUrl,'http://192.0.2.99:8080');
});
