// CI only: actual Homebridge 2 child bridge, temporary storage and loopback
// hardware emulators. No pairing, real accessories or household configuration.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { hardwareFixture } from '../test/support/hardware.mjs';
import { HapSubscription } from '../src/homebridge-devices.js';
import { verifyHapReporting } from './hap-reporting-smoke.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const allocatedPorts = new Set();
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  // Sequential ephemeral allocations can return the same port before launch.
  if (allocatedPorts.has(port)) return freePort();
  allocatedPorts.add(port); return port;
}
async function until(check, milliseconds = 20000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (await check()) return; await sleep(100); }
  throw new Error('Homebridge smoke check timed out');
}
async function main() {
  assert.ok(process.env.HOMEBRIDGE_BIN, 'HOMEBRIDGE_BIN must point to the CI installation');
  await verifyHapReporting();
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'coordinator-homebridge-'));
  const platform = JSON.parse(await readFile(path.join(root, 'examples/input-routing-config.json'), 'utf8'));
  platform.controllers[0].inputs = platform.controllers[0].inputs.slice(0, 1);
  const button = platform.controllers[0].inputs[0]; button.rearmSeconds = 0; button.timing = {};
  platform.controllers[0].motorPaths[0].openPulseSeconds = platform.controllers[0].motorPaths[0].closePulseSeconds = .1;
  const hardware = await hardwareFixture(platform.controllers[0]);
  let child; let capture; let captureOutput=''; const captureEvents=[]; let logs = ''; let identity; const subscriptions=[];let releaseRead;
  try {
    platform.controllers[0] = hardware.config;
    Object.assign(hardware.config.feedback,{openingSeconds:1,closedStableSeconds:0,boltSettleSeconds:0});
    hardware.config.timing={openRetractSettleSeconds:0,closeRetractSettleSeconds:0,operationPollSeconds:.1,idlePollSeconds:.5};
    hardware.state.closeDelayMs=500;
    platform.managementPort = await freePort();
    platform._bridge = { username: '0E:11:22:33:44:66', port: await freePort() };
    await writeFile(path.join(directory, 'config.json'), JSON.stringify({
      bridge: { name: 'Synthetic coordinator test', username: '0E:11:22:33:44:55',
        pin: '031-45-154', port: await freePort(), bind: ['127.0.0.1'] },
      platforms: [platform], accessories: [],
    }), { mode: 0o600 });
    const launch = () => {
      child = spawn(process.execPath, [process.env.HOMEBRIDGE_BIN, '-I', '-U', directory, '-P', root], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', data => { logs = (logs + data).slice(-32768); });
      child.stderr.on('data', data => { logs = (logs + data).slice(-32768); });
    };
    launch();
    const origin = 'http://127.0.0.1:' + platform.managementPort;
    await until(async () => {
      assert.equal(child.exitCode, null, 'Homebridge exited during startup');
      try {
        identity = JSON.parse(await readFile(path.join(directory, 'gdoorandbolt-coordinator/identity.json'), 'utf8'));
        return (await fetch(origin + '/v1/identity', { headers: { Authorization: 'Bearer ' + identity.token }, signal: AbortSignal.timeout(1000) })).ok;
      } catch { return false; }
    });
    assert.deepEqual(hardware.state.requests, [], 'Startup must not read or operate hardware');
    await writeFile(path.join(directory, 'gdoorandbolt-coordinator/credentials.json'), JSON.stringify(hardware.credentials), { mode: 0o600 });
    const response = await fetch(origin + '/v1/controllers/' + platform.controllers[0].id + '/probe', {
      method: 'POST', headers: { Authorization: 'Bearer ' + identity.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: identity.instanceId }), signal: AbortSignal.timeout(12000),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).probe.compatible, true);
    assert.deepEqual(hardware.state.writes, []);
    const management = async (endpoint, body) => {
      const response = await fetch(origin + endpoint, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer '+identity.token, 'X-Coordinator-Status':'detailed', ...(body?{'Content-Type':'application/json'}:{}) }, ...(body?{body:JSON.stringify({instanceId:identity.instanceId,...body})}:{}), signal:AbortSignal.timeout(10000) });
      assert.ok(response.ok); return response.json();
    };
    const id=platform.controllers[0].id;const endpoint='/v1/controllers/'+id;
    const enabled=await management(endpoint+'/commission',{revision:1,previousControllerStopped:true,physicalSetupReviewed:true,recover:false});assert.equal(enabled.status.actuationEnabled,true);
    const hapOrigin='http://127.0.0.1:'+platform._bridge.port;let accessories;
    await until(async()=>{try{const r=await fetch(hapOrigin+'/accessories',{headers:{Authorization:'031-45-154'},signal:AbortSignal.timeout(1000)});accessories=await r.json();return accessories.accessories?.length===3;}catch{return false;}});
    const serviceType=(s,type)=>s.type.toUpperCase().replace(/^0+/,'').startsWith(type+'-')||s.type.toUpperCase()===type;
    const garage=accessories.accessories.find(a=>a.services.some(s=>serviceType(s,'41')));
    const garageService=garage.services.find(s=>serviceType(s,'41'));const target=garageService.characteristics.find(c=>serviceType(c,'32'));
    const current=garageService.characteristics.find(c=>serviceType(c,'E'));
    const bolt=accessories.accessories.find(a=>a.services.some(s=>serviceType(s,'45')));
    const lock=bolt.services.find(s=>serviceType(s,'45'));
    const lockTarget=lock.characteristics.find(c=>serviceType(c,'1E'));
    const lockCurrent=lock.characteristics.find(c=>serviceType(c,'1D'));
    // The owner diagnostic uses one event connection for all four fields and
    // reads only the management API afterwards. Exercise that exact script.
    capture=spawn('python3',['-B','-u',path.join(root,'scripts/watch-homekit-events.py'),'--storage',directory,'--seconds','180'],{stdio:['ignore','pipe','pipe']});
    let captureBuffer='';
    capture.stdout.on('data',data=>{
      captureOutput+=data;captureBuffer+=data;
      const lines=captureBuffer.split('\n');captureBuffer=lines.pop();
      for(const line of lines){const match=/^\s*[\d.]+s PUSH\s+(.*)$/.exec(line);if(match)captureEvents.push(JSON.parse(match[1]));}
    });
    capture.stderr.on('data',data=>{captureOutput+=data;});
    await until(async()=>{assert.equal(capture.exitCode,null,captureOutput);return captureOutput.includes('READY:');});
    const lockTargets=[];const subscription=new HapSubscription(hapOrigin,'031-45-154',bolt.aid,lockTarget.iid);
    subscriptions.push(subscription);subscription.on('value',value=>lockTargets.push(value));subscription.start();await until(async()=>subscription.ready);
    const garageEvents=[];
    for(const [name,characteristic]of [['current',current],['target',target]]){
      const listener=new HapSubscription(hapOrigin,'031-45-154',garage.aid,characteristic.iid);
      subscriptions.push(listener);listener.on('value',value=>garageEvents.push({name,value,at:Date.now()}));listener.start();await until(async()=>listener.ready);
    }
    const reporting=(await management('/v1/homekit-reporting')).reporting;
    assert.equal(reporting.recording,false);assert.equal(reporting.traceMode,'off');assert.deepEqual(reporting.events,[]);
    assert.equal((await management('/v1/homekit-reporting/recording',{recording:true})).recording,true);
    assert.equal(reporting.connectionInspection,'available','Actual Homebridge connection inventory must be inspectable');
    assert.ok(reporting.clients.some(c=>!c.paired&&['doorCurrent','doorTarget','boltCurrent','boltTarget'].every(field=>c.subscriptions.some(s=>s.field===field))), 'Identify the existing four-field diagnostic subscriber');
    assert.ok(reporting.tiles.every(t=>t.fields.every(f=>f.supportsEvents===true)));
    assert.equal(JSON.stringify(reporting).includes('031-45-154'),false);
    // Reading the diagnostic must not produce another HomeKit GET or subscriber.
    const beforeDiagnosticReads=reporting.events.filter(e=>e.kind==='get').map(e=>e.sequence);
    const afterDiagnostic=(await management('/v1/homekit-reporting')).reporting;
    assert.deepEqual(afterDiagnostic.events.filter(e=>e.kind==='get').map(e=>e.sequence),beforeDiagnosticReads);
    const readCharacteristics=async()=>{
      const ids=garage.aid+'.'+current.iid+','+garage.aid+'.'+target.iid+','+bolt.aid+'.'+lockCurrent.iid;
      const result=await fetch(hapOrigin+'/characteristics?id='+ids,{headers:{Authorization:'031-45-154'},signal:AbortSignal.timeout(3000)});
      const body=await result.json();assert.equal(result.status,200,JSON.stringify(body));
      assert.ok(body.characteristics.every(c=>c.status===undefined||c.status===0),JSON.stringify(body));
      return body.characteristics;
    };
    let captureSince=0;
    const assertTerminalEvents=async(value,since)=>{
      await until(async()=>['doorCurrent','doorTarget','boltCurrent','boltTarget'].every(field=>
        captureEvents.slice(captureSince).some(event=>event[field]===(field.startsWith('door')?(value?'closed':'open'):(value?'locked':'unlocked')))),3000);
      // A live client must receive both values, then receive the same terminal
      // current value again without polling it or sending another motor command.
      await until(async()=>['current','target'].every(name=>garageEvents.slice(since).some(e=>e.name===name&&e.value===value)),3000);
      const first=garageEvents.slice(since).find(e=>e.name==='current'&&e.value===value);
      const writes=structuredClone(hardware.state.writes);
      await until(async()=>garageEvents.slice(since).some(e=>e.name==='current'&&e.value===value&&e.at>=first.at+1000),5000);
      await until(async()=>['boltCurrent','boltTarget'].every(field=>captureEvents.slice(captureSince).filter(event=>event[field]===(value?'locked':'unlocked')).length>=2),5000);
      await until(async()=>garageEvents.slice(since).some(e=>e.name==='target'&&e.value===value&&e.at>=first.at+1000),5000);
      assert.deepEqual(hardware.state.writes,writes,'Reaffirmation must not operate hardware');
      const rows=await readCharacteristics();
      for(const iid of [current.iid,target.iid])assert.equal(rows.find(c=>c.aid===garage.aid&&c.iid===iid).value,value);
    };
    for(const [value,phase]of [[0,'open'],[1,'closed']]){
      const since=garageEvents.length;
      captureSince=captureEvents.length;
      let reading=false;const heldRead=new Promise(resolve=>{releaseRead=resolve;});
      hardware.state.beforeDoorRead=async()=>{hardware.state.beforeDoorRead=null;reading=true;await heldRead;};
      await until(async()=>reading);
      const before=hardware.state.writes.length;
      const write=await fetch(hapOrigin+'/characteristics',{method:'PUT',headers:{Authorization:'031-45-154','Content-Type':'application/hap+json'},body:JSON.stringify({characteristics:[{aid:garage.aid,iid:target.iid,value}]}),signal:AbortSignal.timeout(5000)});if(write.status!==204)throw Error('HAP write rejected '+write.status+' '+await write.text()+' runtime '+JSON.stringify((await management(endpoint+'/state')).status));
      assert.equal(hardware.state.writes.length,before,'HAP must acknowledge before waiting for the outstanding read; no overlapping actuator command');
      releaseRead();releaseRead=null;
      await until(async()=>{await readCharacteristics();const s=(await management(endpoint+'/state')).status.state;return s.phase===phase&&!s.busy;});
      await until(async()=>lockTargets.at(-1)===(value===0?0:1));
      await assertTerminalEvents(value,since);
    }
    assert.deepEqual(hardware.state.writes,[['bolt',false],['door','open'],['door','close'],['bolt',true]]);
    const beforeOff=(await management('/v1/homekit-reporting')).reporting;
    const subscriberIds=beforeOff.clients.filter(c=>c.subscriptions.length>=4).map(c=>c.id);
    const recordedSequence=beforeOff.events.at(-1).sequence;
    const writesBeforeSwitch=structuredClone(hardware.state.writes);
    assert.equal((await management('/v1/homekit-reporting/recording',{recording:false})).recording,false);
    assert.deepEqual(hardware.state.writes,writesBeforeSwitch);
    for(const [value,phase]of [[0,'open'],[1,'closed']]){
      await until(async()=>(await management(endpoint+'/state')).status.inputStates[button.id]==='ready');
      // Allow the live-source context to settle after the previous worker ends.
      await sleep(200);const since=garageEvents.length;captureSince=captureEvents.length;
      hardware.emit(button.source.resourceId,button.trigger);
      await until(async()=>{const s=(await management(endpoint+'/state')).status.state;return s.phase===phase&&!s.busy;});
      await assertTerminalEvents(value,since);
    }
    assert.deepEqual(hardware.state.writes.slice(4),[['bolt',false],['motor',true],['motor',false],['motor',true],['motor',false],['bolt',true]]);
    const afterOff=(await management('/v1/homekit-reporting')).reporting;
    assert.equal(afterOff.recording,false);assert.equal(afterOff.bootId,beforeOff.bootId);
    assert.equal(afterOff.events.at(-1).sequence,recordedSequence,'Off must bypass all internal event recording');
    assert.ok(subscriberIds.every(id=>afterOff.clients.some(c=>c.id===id&&c.subscriptions.length>=4)),'Existing subscribers survive recording switch');
    assert.equal((await management('/v1/homekit-reporting/recording',{recording:true})).recording,true);
    for(const [traceMode,publicationMode]of [['events','inline'],['subscribers','inline'],['off','deferred']]) {
      const before=(await management('/v1/homekit-reporting')).reporting;
      const beforeSequence=before.events.at(-1).sequence;
      const beforeWrites=hardware.state.writes.length;
      const selected=await management('/v1/homekit-reporting/experiment',{traceMode,publicationMode});
      assert.equal(selected.traceMode,traceMode); assert.equal(selected.publicationMode,publicationMode);
      assert.equal(hardware.state.writes.length,beforeWrites,'Experiment selection cannot actuate');
      for(const [value,phase]of [[0,'open'],[1,'closed']]) {
        await until(async()=>(await management(endpoint+'/state')).status.inputStates[button.id]==='ready');
        await sleep(200); const since=garageEvents.length; captureSince=captureEvents.length;
        hardware.emit(button.source.resourceId,button.trigger);
        await until(async()=>{const s=(await management(endpoint+'/state')).status.state;return s.phase===phase&&!s.busy;});
        await assertTerminalEvents(value,since);
      }
      assert.deepEqual(hardware.state.writes.slice(beforeWrites),[['bolt',false],['motor',true],['motor',false],['motor',true],['motor',false],['bolt',true]]);
      const after=(await management('/v1/homekit-reporting')).reporting;
      assert.equal(after.bootId,before.bootId); assert.equal(after.traceMode,traceMode); assert.equal(after.publicationMode,publicationMode);
      assert.ok(subscriberIds.every(id=>after.clients.some(c=>c.id===id&&c.subscriptions.length>=4)),'Experiments keep the same subscriber connections');
      const newEvents=after.events.filter(e=>e.sequence>beforeSequence);
      if(traceMode==='events') {
        assert.ok(newEvents.some(e=>e.kind==='publish'&&e.field==='doorCurrent'&&e.value===1));
        assert.ok(newEvents.filter(e=>e.kind==='publish').every(e=>e.subscribers===null));
      } else assert.deepEqual(newEvents,[],'Inspection-only and diagnostics-OFF do not record events');
    }
    const restored=await management('/v1/homekit-reporting/experiment',{traceMode:'full',publicationMode:'inline'});
    assert.equal(restored.traceMode,'full'); assert.equal(restored.publicationMode,'inline');
    const finalTrace=(await management('/v1/homekit-reporting')).reporting;
    assert.ok(finalTrace.events.some(e=>e.kind==='publish'&&e.field==='doorCurrent'&&e.value===1));
    assert.ok(finalTrace.events.some(e=>e.kind==='get'&&e.field==='doorCurrent'&&e.client?.paired===false));
    assert.equal(logs.includes(identity.token), false);
    assert.equal(captureOutput.includes(identity.token),false);
    assert.equal(captureOutput.includes('031-45-154'),false);
    capture.kill('SIGINT');await until(async()=>capture.exitCode!==null,5000);
    assert.equal(capture.exitCode,0,captureOutput);
    for(const subscription of subscriptions)subscription.stop();
    const restart = async full => {
      const boot = (await management(endpoint+'/state')).status.bootId;
      if (full) {
        child.kill('SIGTERM'); await until(async()=>child.exitCode!==null||child.signalCode!==null,10000); launch();
      } else {
        // This isolated Homebridge has exactly one child bridge. Killing that
        // process exercises Homebridge's real supervisor and durable recovery.
        const pids=execFileSync('ps',['-o','pid=','--ppid',String(child.pid)],{encoding:'utf8'}).trim().split(/\s+/).map(Number);
        assert.equal(pids.length,1);assert.ok(Number.isInteger(pids[0])&&pids[0]>1);
        process.kill(pids[0],'SIGKILL');
      }
      await until(async()=>{try{return (await management(endpoint+'/state')).status.bootId!==boot;}catch{return false;}},45000);
      return (await management(endpoint+'/state')).status;
    };
    let writes=structuredClone(hardware.state.writes);
    let state=await restart(false);assert.equal(state.actuationEnabled,true);assert.equal(state.state.phase,'closed');
    assert.deepEqual(hardware.state.writes,writes,'Child-bridge restart cannot move hardware');
    hardware.state.closed=false;hardware.state.locked=false;
    state=await restart(true);assert.equal(state.actuationEnabled,true);assert.equal(state.state.phase,'position-unknown');
    assert.deepEqual(hardware.state.writes,writes,'Full Homebridge restart while open cannot move hardware');
    hardware.state.reachable=false;
    state=await restart(false);assert.equal(state.held,'waiting-for-devices');assert.equal(state.commissioned,true);assert.equal(state.enabled,true);assert.equal(state.configurationValid,true);
    hardware.state.reachable=true;
    await until(async()=>(await management(endpoint+'/state')).status.actuationEnabled,12000);
    assert.deepEqual(hardware.state.writes,writes,'Late startup recovery cannot move hardware');
    // A real fault blocks control, but never changes the saved Enabled setting.
    hardware.state.blocked=true;
    await until(async()=>(await management(endpoint+'/state')).status.state.fault==='door_blocked');
    state=(await management(endpoint+'/state')).status;
    assert.equal(state.enabled,true);assert.equal(state.configurationValid,true);assert.equal(state.actuationEnabled,false);
    const writesBeforeFault=structuredClone(hardware.state.writes);
    state=await restart(false);assert.equal(state.enabled,true);assert.equal(state.state.fault,'door_blocked');
    hardware.state.blocked=false;
    state=await restart(true);assert.equal(state.enabled,true);assert.equal(state.state.fault,null);
    assert.equal(state.lastFault.reason,'door_blocked');assert.equal(state.actuationEnabled,true);
    assert.deepEqual(hardware.state.writes,writesBeforeFault,'Rechecking a saved fault cannot move hardware');
    // Crash while a real Tailwind open operation is in progress. The new process
    // must retain enablement, report unknown position and never replay the write.
    hardware.state.closed=true;hardware.state.locked=true;
    await until(async()=>{const s=(await management(endpoint+'/state')).status.state;return s.phase==='closed'&&!s.busy;});
    state=(await management(endpoint+'/state')).status;
    await management(endpoint+'/commands',{command:'open',requestId:'restart-open-fixture',issuedAt:Date.now(),bootId:state.bootId});
    await until(async()=>(await management(endpoint+'/state')).status.state.phase==='opening');
    writes=structuredClone(hardware.state.writes);
    state=await restart(false);assert.equal(state.actuationEnabled,true);assert.equal(state.state.reconciling,true);
    assert.equal(state.state.openEstimated,false);assert.equal(state.state.fault,null);assert.deepEqual(hardware.state.writes,writes);
    hardware.state.closed=true;hardware.state.locked=false;
    await until(async()=>{const s=(await management(endpoint+'/state')).status;return s.state.phase==='closed'&&!s.state.reconciling;});
    assert.deepEqual(hardware.state.writes,writes,'Post-restart observation cannot replay a pulse or automatically bolt');
    child.kill('SIGTERM');
    await until(async () => child.exitCode !== null || child.signalCode !== null, 10000);
    await assert.rejects(fetch(origin + '/v1/identity', { signal: AbortSignal.timeout(1000) }));
    console.log('Actual Homebridge passed HomeKit/button cycles, reporting checks, child/full restarts, delayed startup, interrupted-motion observation without replay, and shutdown.');
  } catch (error) {
    // Synthetic logs only, with the generated management token still redacted.
    const safeLogs = logs.replaceAll(identity?.token || 'never-match-placeholder', '[redacted]');
    console.error(safeLogs);
    throw new Error(String(error) + ': ' + safeLogs.slice(-1400));
  } finally {
    releaseRead?.();for(const subscription of subscriptions)subscription.stop();
    if(capture&&capture.exitCode===null&&capture.signalCode===null)capture.kill('SIGKILL');
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await sleep(1000); child.kill('SIGKILL'); }
    await hardware.close(); await rm(directory, { recursive: true, force: true });
  }
}
main().catch(async error => {
  const result = String(error).replaceAll('\n', ' ').replace(/\x1b\[[0-9;]*m/g, '').slice(0, 1600);
  console.error(result);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'result=' + result + '\n');
  process.exitCode = 1;
});
