// Synthetic test server: no Homebridge instance or hardware is used.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoordinatorRuntime } from '../src/runtime.js';
import { loadIdentity } from '../src/storage.js';
import { readFile } from 'node:fs/promises';
import { createManagementServer, listenLocal, closeServer } from '../src/api.js';
import { validateConfiguration } from '../src/config.js';
import { Diagnostics } from '../src/diagnostics.js';
import { hardwareFixture } from '../test/support/hardware.mjs';
const config = JSON.parse(await readFile(new URL('../examples/input-routing-config.json', import.meta.url), 'utf8'));
const token = process.env.COORDINATOR_TEST_TOKEN;
if (!token || token.length < 32) throw new Error('test_token_required');
const hardware = await hardwareFixture(config.controllers[0]);
config.controllers[0] = hardware.config;
let runtime, storagePath;
if(process.env.COORDINATOR_MANAGED_FIXTURE==='1'){
  config.controllers[0].inputs=[];config.controllers[0].motorPaths=[];
  config.controllers[0].keypad={baseUrl:hardware.config.bolt.baseUrl,gatewayId:hardware.config.bolt.gatewayId,alarmId:1,credentialRef:hardware.config.bolt.credentialRef};
  Object.assign(config.controllers[0].feedback,{openingSeconds:1,closedStableSeconds:0,boltSettleSeconds:0});
  config.controllers[0].timing={openRetractSettleSeconds:0,closeRetractSettleSeconds:0,idlePollSeconds:30};
  storagePath=await mkdtemp(path.join(os.tmpdir(),'coordinator-cross-'));await loadIdentity(storagePath);let now=0;
  runtime=new CoordinatorRuntime({storagePath,configuration:config,credentials:async()=>hardware.credentials,clock:{now:()=>now,wall:()=>Date.now(),sleep:async ms=>{now+=ms;}}});await runtime.start();
}
const configuration = validateConfiguration(config);
const server = createManagementServer({
  identity: { instanceId: '00000000-0000-4000-8000-000000000001', token },
  configuration, runtime,
  diagnostics: new Diagnostics(configuration, async () => hardware.credentials),
});
const port = await listenLocal(server, 0);
process.stdout.write(JSON.stringify({ port }) + '\n');
process.stdin.resume();
async function stop() { await runtime?.stop(); await closeServer(server); await hardware.close(); if(storagePath)await rm(storagePath,{recursive:true,force:true}); }
process.stdin.once('end', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); process.stdin.pause(); });
