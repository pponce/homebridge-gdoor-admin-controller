import test from 'node:test';
import assert from 'node:assert/strict';
import { HomekitReporting } from '../src/homekit-reporting.js';

function fixture() {
  const subscriptions = new Set(['2.10','2.11','7.99']);
  const paired = { username: 'PRIVATE-PAIRING-IDENTITY', remoteAddress: 'PRIVATE-ADDRESS',
    handlingRequest: false, tcpSocket: { bytesWritten: 1200, writable: true },
    hasEventNotifications: (aid,iid) => subscriptions.has(aid+'.'+iid),
    queuedEvents: [{aid:2,iid:10,value:1},{aid:7,iid:99,value:'PRIVATE-OTHER-ACCESSORY'}] };
  const unpaired = { hasEventNotifications:()=>true, queuedEvents:[], handlingRequest:true,
    tcpSocket:{bytesWritten:120,writable:true} };
  const server = { connections:new Set([paired,unpaired]) };
  const current = {iid:10,value:1,statusCode:0,props:{perms:['pr','ev']}};
  const target = {iid:11,value:1,statusCode:0,props:{perms:['pr','pw','ev']}};
  const tile = {id:'example',kind:'garage',report:{available:true,current:1,target:1},
    characteristics:new Map([['current',current],['target',target]]),
    accessory:{_associatedHAPAccessory:{aid:2,getPrimaryAccessory:()=>({_server:{httpServer:server}})}}};
  const publisher = {api:{serverVersion:'2.0.0',hap:{HAPLibraryVersion:()=> '2.1.4'}},
    fields:()=>[['current'],['target']],active:new Map([['garage',tile]])};
  return { trace:new HomekitReporting(publisher),tile,current,target,paired,unpaired,server,subscriptions };
}

test('diagnostic distinguishes paired subscriptions and queued garage values without exposing connection identities', () => {
  const f=fixture(); const before=[...f.subscriptions]; const result=f.trace.snapshot();
  assert.equal(result.connectionInspection,'available'); assert.equal(result.hapVersion,'2.1.4');
  assert.equal(result.clients[0].paired,true); assert.equal(result.clients[1].paired,false);
  assert.deepEqual(result.clients[0].subscriptions,[{controllerId:'example',field:'doorCurrent'},{controllerId:'example',field:'doorTarget'}]);
  assert.deepEqual(result.clients[0].queued,[{controllerId:'example',field:'doorCurrent',value:1}]);
  assert.equal(result.clients[1].requestInProgress,true);
  assert.deepEqual(result.tiles[0].fields[0].subscribers,['connection-1','connection-2']);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.deepEqual([...f.subscriptions],before); assert.equal(f.current.value,1);
  assert.equal(f.paired.tcpSocket.bytesWritten,1200); assert.equal(f.paired.queuedEvents.length,2);
});

test('snapshot exposes missing paired current subscriptions and cached/reported mismatches instead of hiding them', () => {
  const f=fixture(); f.subscriptions.delete('2.10'); f.current.value=3;
  const result=f.trace.snapshot(); const row=result.tiles[0].fields[0];
  assert.equal(row.reported,1); assert.equal(row.cached,3); assert.deepEqual(row.subscribers,['connection-2']);
  assert.equal(result.clients[0].subscriptions.some(s=>s.field==='doorCurrent'),false);
});

test('each publication records its subscribers at that moment, before later subscription changes', () => {
  const f=fixture(); f.trace.record('publish',f.tile,'current',1,null,true);
  f.subscriptions.delete('2.10');
  const event=f.trace.snapshot().events.at(-1);
  assert.deepEqual(event.subscribers,[{id:'connection-1',paired:true},{id:'connection-2',paired:false}]);
  f.trace.record('publish',f.tile,'current',1,null,true);
  assert.deepEqual(f.trace.snapshot().events.at(-1).subscribers,[{id:'connection-2',paired:false}]);
});

test('trace is bounded and stores only scalar state and anonymous client labels', () => {
  const f=fixture();
  for(let i=0;i<230;i++)f.trace.record('get',f.tile,'current',i%2,f.paired);
  f.trace.record('get-error',f.tile,'current',new Error('PRIVATE-ERROR'),f.paired);
  const result=f.trace.snapshot(); assert.equal(result.events.length,200);
  assert.equal(result.events[0].sequence,32); assert.equal(result.events.at(-1).value,null);
  assert.deepEqual(result.events.at(-1).client,{id:'connection-1',paired:true});
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

test('unsupported HAP connection internals affect only diagnostic availability', () => {
  const f=fixture(); delete f.server.connections;
  const result=f.trace.snapshot(); assert.equal(result.connectionInspection,'unavailable');
  assert.equal(result.tiles[0].fields[0].cached,1); assert.deepEqual(result.clients,[]);
  // Missing characteristics are skipped, never recreated by reading diagnostics.
  f.tile.characteristics.clear(); assert.deepEqual(f.trace.snapshot().tiles[0].fields,[]);
});
