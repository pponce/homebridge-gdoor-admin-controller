import test from 'node:test';
import assert from 'node:assert/strict';
import { debugReport } from '../src/debug-report.js';
function input(){return {identity:{pluginVersion:'0.4.16',token:'PRIVATE-TOKEN'},controllers:[{id:'PRIVATE-ID',name:'PRIVATE-NAME',baseUrl:'PRIVATE-ADDRESS',status:{bootId:'boot',actuationEnabled:true,state:{phase:'closed',door:'closed',bolt:'locked',busy:false,fault:null,obstruction:false}}}],reporting:{schema:1,bootId:'boot',recording:false,traceMode:'off',publicationMode:'inline',homebridgeVersion:'2.4.0',hapVersion:'2.2.2',connectionInspection:'available',
 tiles:[{controllerId:'PRIVATE-ID',kind:'garage',available:true,fields:[{field:'doorCurrent',reported:1,cached:1,subscribers:['connection-1','PRIVATE-PAIRING'],secret:'PRIVATE-SECRET'}]}],
 clients:[{id:'connection-1',paired:true,username:'PRIVATE-PAIRING',remoteAddress:'PRIVATE-ADDRESS',subscriptions:[{controllerId:'PRIVATE-ID',field:'doorCurrent'}],queued:[]}],
 events:[{controllerId:'PRIVATE-ID',field:'doorCurrent',kind:'publish',value:1,sequence:1,at:1,monotonicMs:1,subscribers:[{id:'connection-1',paired:true,username:'PRIVATE-PAIRING'}]}]},
 activity:[{controllerId:'PRIVATE-ID',at:'2026-10-07T00:00:00Z',type:'complete',detail:'close',name:'PRIVATE-NAME'},{controllerId:null,at:'PRIVATE-TIME',type:'PRIVATE-TYPE',detail:'PRIVATE-DETAIL'}]};}
test('debug export is allowlisted, numbered and retains useful event/state data without source identities',()=>{
 const report=debugReport(input());assert.equal(JSON.stringify(report).includes('PRIVATE'),false);
 assert.equal(report.controllers[0].garage,'Garage 1');assert.equal(report.controllers[0].door,'closed');
 assert.equal(report.events[0].value,1);assert.equal(report.clients[0].subscriptions[0].garage,'Garage 1');
 assert.equal(report.activity[0].command,'close');assert.equal(report.activity[1].command,null);
 assert.equal(report.recording,false);assert.equal(report.versions.homebridge,'2.4.0');
});
test('unsupported diagnostics or snapshots spanning a restart cannot appear as a valid report',()=>{
 const x=input();x.reporting.schema=0;assert.throws(()=>debugReport(x),/unavailable/);
 x.reporting.schema=1;x.reporting.bootId='new-boot';assert.throws(()=>debugReport(x),/restarted/);
});
test('diagnostics include fixed hold/fault reasons and original time while rejecting arbitrary strings',()=>{
 const x=input(),s=x.controllers[0].status;s.held='controller_requires_review';
 Object.assign(s.state,{fault:'bolt_write_ambiguous',faultAt:'2026-10-08T18:00:00.000Z',unavailable:'bolt_unreachable',reconciling:false});
 let row=debugReport(x).controllers[0];assert.equal(row.faultReason,'bolt_write_ambiguous');assert.equal(row.faultAt,s.state.faultAt);
 assert.equal(row.heldReason,'controller_requires_review');assert.equal(row.unavailableReason,'bolt_unreachable');
 s.held=s.state.fault=s.state.unavailable=s.state.faultAt='PRIVATE';
 row=debugReport(x).controllers[0];assert.equal(JSON.stringify(row).includes('PRIVATE'),false);
 assert.equal(row.faultReason,null);assert.equal(row.faultAt,null);
});
test('unexpected scalar content, extra fields and unbounded histories cannot leak into debug downloads',()=>{
 const x=input();x.controllers[0].status.state.door='PRIVATE-DOOR';x.reporting.tiles[0].fields[0].cached='PRIVATE-CACHED';
 x.reporting.events=Array.from({length:400},()=>({...x.reporting.events[0],value:{secret:'PRIVATE-KEY'}}));
 x.reporting.events.push({controllerId:'PRIVATE-UNRELATED',field:'doorCurrent'});
 const result=debugReport(x);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(result.events.length,200);
 assert.equal(result.controllers[0].door,null);assert.equal(result.tiles[0].fields[0].cached,null);
});
