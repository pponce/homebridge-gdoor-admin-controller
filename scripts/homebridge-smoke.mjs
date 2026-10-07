// CI only: actual Homebridge 2 child bridge, temporary storage and loopback
// hardware emulators. No pairing, real accessories or household configuration.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { hardwareFixture } from '../test/support/hardware.mjs';
import { HapSubscription } from '../src/homebridge-devices.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve)); return port;
}
async function until(check, milliseconds = 20000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (await check()) return; await sleep(100); }
  throw new Error('Homebridge smoke check timed out');
}
async function main() {
  assert.ok(process.env.HOMEBRIDGE_BIN, 'HOMEBRIDGE_BIN must point to the CI installation');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'coordinator-homebridge-'));
  const platform = JSON.parse(await readFile(path.join(root, 'examples/input-routing-config.json'), 'utf8'));
  platform.controllers[0].inputs = platform.controllers[0].inputs.slice(0, 1);
  const button = platform.controllers[0].inputs[0]; button.rearmSeconds = 0; button.timing = {};
  platform.controllers[0].motorPaths[0].openPulseSeconds = platform.controllers[0].motorPaths[0].closePulseSeconds = .1;
  const hardware = await hardwareFixture(platform.controllers[0]);
  let child; let logs = ''; let identity; const subscriptions=[];let releaseRead;
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
    child = spawn(process.execPath, [process.env.HOMEBRIDGE_BIN, '-I', '-U', directory, '-P', root], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { logs = (logs + data).slice(-32768); });
    child.stderr.on('data', data => { logs = (logs + data).slice(-32768); });
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
      const response = await fetch(origin + endpoint, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer '+identity.token, ...(body?{'Content-Type':'application/json'}:{}) }, ...(body?{body:JSON.stringify({instanceId:identity.instanceId,...body})}:{}), signal:AbortSignal.timeout(10000) });
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
    const lockTargets=[];const subscription=new HapSubscription(hapOrigin,'031-45-154',bolt.aid,lockTarget.iid);
    subscriptions.push(subscription);subscription.on('value',value=>lockTargets.push(value));subscription.start();await until(async()=>subscription.ready);
    const garageEvents=[];
    for(const [name,characteristic]of [['current',current],['target',target]]){
      const listener=new HapSubscription(hapOrigin,'031-45-154',garage.aid,characteristic.iid);
      subscriptions.push(listener);listener.on('value',value=>garageEvents.push({name,value,at:Date.now()}));listener.start();await until(async()=>listener.ready);
    }
    const readCharacteristics=async()=>{
      const ids=garage.aid+'.'+current.iid+','+garage.aid+'.'+target.iid+','+bolt.aid+'.'+lockCurrent.iid;
      const result=await fetch(hapOrigin+'/characteristics?id='+ids,{headers:{Authorization:'031-45-154'},signal:AbortSignal.timeout(3000)});
      const body=await result.json();assert.equal(result.status,200,JSON.stringify(body));
      assert.ok(body.characteristics.every(c=>c.status===undefined||c.status===0),JSON.stringify(body));
      return body.characteristics;
    };
    const assertTerminalEvents=async(value,since)=>{
      // A live client must receive both values, then receive the same terminal
      // current value again without polling it or sending another motor command.
      await until(async()=>['current','target'].every(name=>garageEvents.slice(since).some(e=>e.name===name&&e.value===value)),3000);
      const first=garageEvents.slice(since).find(e=>e.name==='current'&&e.value===value);
      const writes=structuredClone(hardware.state.writes);
      await until(async()=>garageEvents.slice(since).some(e=>e.name==='current'&&e.value===value&&e.at>=first.at+1000),5000);
      assert.deepEqual(hardware.state.writes,writes,'Reaffirmation must not operate hardware');
      const rows=await readCharacteristics();
      for(const iid of [current.iid,target.iid])assert.equal(rows.find(c=>c.aid===garage.aid&&c.iid===iid).value,value);
    };
    for(const [value,phase]of [[0,'open'],[1,'closed']]){
      const since=garageEvents.length;
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
    assert.deepEqual(hardware.state.writes,[['bolt',false],['door','open'],['bolt',false],['door','close'],['bolt',true]]);
    for(const [value,phase]of [[0,'open'],[1,'closed']]){
      await until(async()=>(await management(endpoint+'/state')).status.inputStates[button.id]==='ready');
      // Allow the live-source context to settle after the previous worker ends.
      await sleep(200);const since=garageEvents.length;
      hardware.emit(button.source.resourceId,button.trigger);
      await until(async()=>{const s=(await management(endpoint+'/state')).status.state;return s.phase===phase&&!s.busy;});
      await assertTerminalEvents(value,since);
    }
    assert.deepEqual(hardware.state.writes.slice(5),[['bolt',false],['motor',true],['motor',false],['bolt',false],['motor',true],['motor',false],['bolt',true]]);
    assert.equal(logs.includes(identity.token), false);
    child.kill('SIGTERM');
    await until(async () => child.exitCode !== null || child.signalCode !== null, 10000);
    await assert.rejects(fetch(origin + '/v1/identity', { signal: AbortSignal.timeout(1000) }));
    console.log('Actual Homebridge child bridge passed prompt command acknowledgement, healthy reads, lock updates, terminal garage notifications and bounded reaffirmation after HomeKit and physical-button operations, ordered coordination and shutdown.');
  } catch (error) {
    // Synthetic logs only, with the generated management token still redacted.
    const safeLogs = logs.replaceAll(identity?.token || 'never-match-placeholder', '[redacted]');
    console.error(safeLogs);
    throw new Error(String(error) + ': ' + safeLogs.slice(-1400));
  } finally {
    releaseRead?.();for(const subscription of subscriptions)subscription.stop();
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
