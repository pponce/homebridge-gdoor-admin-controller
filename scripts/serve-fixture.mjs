// Synthetic test server: no Homebridge instance or hardware is used.
import { readFile } from 'node:fs/promises';
import { createManagementServer, listenLocal, closeServer } from '../src/api.js';
import { validateConfiguration } from '../src/config.js';
const config = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
const token = process.env.COORDINATOR_TEST_TOKEN;
if (!token || token.length < 32) throw new Error('test_token_required');
const server = createManagementServer({
  identity: { instanceId: '00000000-0000-4000-8000-000000000001', token },
  configuration: validateConfiguration(config),
});
const port = await listenLocal(server, 0);
process.stdout.write(JSON.stringify({ port }) + '\n');
process.stdin.resume();
process.stdin.once('end', () => { void closeServer(server); });
process.once('SIGTERM', () => { void closeServer(server); process.stdin.pause(); });
