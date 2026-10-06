import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

test('npm publication reconciles a lost response, verifies repeat runs and rejects unknown/different artifacts', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'coordinator-release-test-'));
  try {
    const root = path.join(temp, 'repo');
    const original = fileURLToPath(new URL('../', import.meta.url));
    await cp(original, root, { recursive: true, filter: p => !path.relative(original, p).split(path.sep).some(x => ['.git', '.release', 'node_modules', '__pycache__'].includes(x)) });
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Synthetic release test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'Synthetic release fixture');
    const commit = git('rev-parse', 'HEAD');
    const bin = path.join(temp, 'bin'); await mkdir(bin);
    const realNpm = process.env.npm_execpath ?? execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();
    const state = path.join(temp, 'registry-state');
    const calls = path.join(temp, 'publish-calls');
    await writeFile(state, 'absent'); await writeFile(calls, '');
    await writeFile(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs'), cp = require('node:child_process'), path = require('node:path');
const args = process.argv.slice(2), command = args[0];
if (command === 'test') process.exit(0);
if (command === 'pack') { const r = cp.spawnSync(process.execPath, [process.env.RELEASE_TEST_NPM, ...args], {stdio:'inherit'}); process.exit(r.status ?? 1); }
if (command === 'whoami') { console.log('synthetic-publisher'); process.exit(0); }
if (command === 'publish') { fs.appendFileSync(process.env.RELEASE_TEST_CALLS, 'publish\\n'); fs.writeFileSync(process.env.RELEASE_TEST_STATE, 'published'); process.exit(1); }
if (command === 'view') {
 const state = fs.readFileSync(process.env.RELEASE_TEST_STATE, 'utf8');
 if (state === 'absent' || state === 'offline') { console.log(JSON.stringify({error:{code:state === 'absent'?'E404':'ETIMEDOUT'}})); process.exit(1); }
 const pkg = JSON.parse(fs.readFileSync('package.json'));
 const [pack] = JSON.parse(fs.readFileSync(path.join('.release',pkg.version,'pack.json')));
 console.log(JSON.stringify({integrity:state === 'different'?'sha512-different':pack.integrity})); process.exit(0);
}
process.exit(99);
`, { mode: 0o755 });
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      RELEASE_TEST_NPM: realNpm, RELEASE_TEST_STATE: state, RELEASE_TEST_CALLS: calls };
    const publish = () => spawnSync('bash', ['scripts/publish-npm.sh', commit], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    let result = publish(); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /RESULT: npm publication verified/);
    assert.equal(await readFile(calls, 'utf8'), 'publish\n');
    result = publish(); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /already published/);
    assert.equal(await readFile(calls, 'utf8'), 'publish\n');
    for (const value of ['different', 'offline']) {
      await writeFile(state, value); result = publish();
      assert.notEqual(result.status, 0); assert.equal(await readFile(calls, 'utf8'), 'publish\n');
    }
    // A stray local file must never be accepted into an npm artifact.
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const manifest = path.join(root, '.release', pkg.version, 'pack.json');
    const packs = JSON.parse(await readFile(manifest, 'utf8'));
    packs[0].files.push({ path: 'src/private-key.json', size: 16 });
    await writeFile(manifest, JSON.stringify(packs));
    result = spawnSync(process.execPath, ['scripts/check-package.mjs', manifest], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Untracked package file/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
