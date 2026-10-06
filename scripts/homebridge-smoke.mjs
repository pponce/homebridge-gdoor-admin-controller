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
  const platform = JSON.parse(await readFile(path.join(root, 'examples/development-config.json'), 'utf8'));
  const hardware = await hardwareFixture(platform.controllers[0]);
  let child; let logs = ''; let identity;
  try {
    platform.controllers[0] = hardware.config;
    platform.managementPort = await freePort();
    platform._bridge = { username: '0E:11:22:33:44:66', port: await freePort() };
    await writeFile(path.join(directory, 'config.json'), JSON.stringify({
      bridge: { name: 'Synthetic coordinator test', username: '0E:11:22:33:44:55',
        pin: '031-45-154', port: await freePort(), bind: ['127.0.0.1'] },
      platforms: [platform], accessories: [],
    }), { mode: 0o600 });
    child = spawn(process.execPath, [process.env.HOMEBRIDGE_BIN, '-U', directory, '-P', root], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    assert.equal(logs.includes(identity.token), false);
    child.kill('SIGTERM');
    await until(async () => child.exitCode !== null || child.signalCode !== null, 10000);
    await assert.rejects(fetch(origin + '/v1/identity', { signal: AbortSignal.timeout(1000) }));
    console.log('Actual Homebridge 2 child-bridge startup, explicit device probe, storage isolation and shutdown passed.');
  } catch (error) {
    // Synthetic logs only, with the generated management token still redacted.
    const safeLogs = logs.replaceAll(identity?.token || 'never-match-placeholder', '[redacted]');
    console.error(safeLogs);
    throw new Error(String(error) + ': ' + safeLogs.slice(-1400));
  } finally {
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
