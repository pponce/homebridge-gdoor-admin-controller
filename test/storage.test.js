import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadIdentity } from '../src/storage.js';

async function root(t) {
  const value = await mkdtemp(path.join(os.tmpdir(), 'coordinator-test-'));
  t.after(() => rm(value, { recursive: true, force: true }));
  return value;
}
test('persistent API identity survives restart with owner-only storage', async t => {
  const directory = await root(t);
  const first = await loadIdentity(directory); const second = await loadIdentity(directory);
  assert.deepEqual(first, second); assert.equal(first.token.length, 64);
  const file = path.join(directory, 'gdoorandbolt-coordinator', 'identity.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
});
test('corrupted identity is held for review instead of silently regenerated', async t => {
  const directory = await root(t); await loadIdentity(directory);
  const file = path.join(directory, 'gdoorandbolt-coordinator', 'identity.json');
  await writeFile(file, '{interrupted');
  await assert.rejects(loadIdentity(directory));
  assert.equal(await readFile(file, 'utf8'), '{interrupted');
});
test('does not follow identity or storage-directory symlinks', async t => {
  const directory = await root(t); const external = await root(t);
  await symlink(external, path.join(directory, 'gdoorandbolt-coordinator'));
  await assert.rejects(loadIdentity(directory), /untrusted_storage_directory/);
  await rm(path.join(directory, 'gdoorandbolt-coordinator'));
  await mkdir(path.join(directory, 'gdoorandbolt-coordinator'), { mode: 0o700 });
  const target = path.join(external, 'unrelated'); await writeFile(target, 'unchanged');
  await symlink(target, path.join(directory, 'gdoorandbolt-coordinator', 'identity.json'));
  await assert.rejects(loadIdentity(directory));
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
});
