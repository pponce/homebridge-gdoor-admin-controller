import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadIdentity } from '../src/storage.js';
import { StateJournal } from '../src/journal.js';
import { readCredentials } from '../src/credentials.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'coordinator-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await loadIdentity(directory);
  return { directory, root: path.join(directory, 'gdoorandbolt-coordinator') };
}

test('durable operation intent survives a new journal instance', async t => {
  const f = await fixture(t); const first = new StateJournal(f.directory, 'garage');
  assert.deepEqual(await first.read(), { inProgress: false, fault: false });
  await first.write({ inProgress: true, fault: false });
  assert.deepEqual(await new StateJournal(f.directory, 'garage').read(), { inProgress: true, fault: false });
  await first.write({ inProgress: false, fault: true });
  assert.deepEqual(await first.read(), { inProgress: false, fault: true });
});

test('journal cannot follow a symlink or replace corrupt/shared-permission state silently', async t => {
  const f = await fixture(t); const file = path.join(f.root, 'garage.state.json');
  const journal = new StateJournal(f.directory, 'garage');
  await writeFile(file, '{bad', { mode: 0o600 });
  await assert.rejects(journal.read(), /journal_invalid/);
  await chmod(file, 0o644); await assert.rejects(journal.write({ inProgress: true, fault: false }), /journal_write_failed/);
  await rm(file); await symlink(path.join(f.root, 'identity.json'), file);
  await assert.rejects(journal.read(), /journal_invalid/);
  await assert.rejects(journal.write({ inProgress: true, fault: false }), /journal_write_failed/);
});

test('device credentials remain in owner-private storage and reject unsafe files', async t => {
  const f = await fixture(t); const file = path.join(f.root, 'credentials.json');
  await assert.rejects(readCredentials(f.directory), /credentials_unavailable/);
  await writeFile(file, JSON.stringify({ 'tailwind-key': '123456' }), { mode: 0o600 });
  assert.deepEqual(await readCredentials(f.directory), { 'tailwind-key': '123456' });
  await chmod(file, 0o644); await assert.rejects(readCredentials(f.directory), /credentials_unavailable/);
  await chmod(file, 0o600); await link(file, path.join(f.root, 'duplicate.json'));
  await assert.rejects(readCredentials(f.directory), /credentials_unavailable/);
  await rm(file); await symlink(path.join(f.root, 'identity.json'), file);
  await assert.rejects(readCredentials(f.directory), /credentials_unavailable/);
});
