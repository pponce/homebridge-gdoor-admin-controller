// Synthetic test server: no Homebridge instance or hardware is used.
import { readFile } from 'node:fs/promises';
import { createManagementServer, listenLocal, closeServer } from '../src/api.js';
import { validateConfiguration } from '../src/config.js';
import { Diagnostics } from '../src/diagnostics.js';
import { hardwareFixture } from '../test/support/hardware.mjs';
const config = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
const token = process.env.COORDINATOR_TEST_TOKEN;
if (!token || token.length < 32) throw new Error('test_token_required');
const hardware = await hardwareFixture(config.controllers[0]);
config.controllers[0] = hardware.config;
const configuration = validateConfiguration(config);
const server = createManagementServer({
  identity: { instanceId: '00000000-0000-4000-8000-000000000001', token },
  configuration,
  diagnostics: new Diagnostics(configuration, async () => hardware.credentials),
});
const port = await listenLocal(server, 0);
process.stdout.write(JSON.stringify({ port }) + '\n');
process.stdin.resume();
async function stop() { await closeServer(server); await hardware.close(); }
process.stdin.once('end', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); process.stdin.pause(); });
