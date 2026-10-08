import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { WebAdminSettings, defaultWebSettings, validateWebSettings } from '../src/web-admin-settings.js';
import { WebAdminTls } from '../src/web-admin-tls.js';

async function storage(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'web-setup-test-')); await mkdir(path.join(dir, 'gdoorandbolt-coordinator'), { mode: 0o700 });
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
test('web administration defaults OFF and saves settings with independent durable revisions', async t => {
  const dir = await storage(t), store = new WebAdminSettings(dir);
  assert.equal((await store.read()).settings.enabled, false); assert.deepEqual(await readdir(path.join(dir, 'gdoorandbolt-coordinator')), []);
  const settings = { ...defaultWebSettings(), enabled: true, connectionIds: ['deconz-main'] };
  await store.save(0, settings, { 'deconz-main': '0011223344556677' });
  await assert.rejects(store.save(0, settings, {}), /web_settings_changed/);
  assert.equal((await new WebAdminSettings(dir).read()).revision, 1);
  assert.equal((await stat(path.join(dir, 'gdoorandbolt-coordinator/web-settings.json'))).mode & 0o777, 0o600);
});
test('the browser URL may differ from the nginx backend origin without accepting unsafe addresses', () => {
  const settings = { ...defaultWebSettings(), bind: '0.0.0.0', origin: 'https://192.0.2.10:9443', publicUrl: 'https://garage.example.test' };
  assert.equal(validateWebSettings(settings), settings);
  for (const change of [{ origin: 'http://192.0.2.10:9443' }, { origin: 'https://192.0.2.10:9444' }, { publicUrl: 'https://user:secret@example.test' },
    { publicUrl: 'https://example.test/path' }, { bind: 'host.example.test' }, { enabled: true }, { connectionIds: ['same', 'same'] }]) assert.throws(() => validateWebSettings({ ...settings, ...change }));
});
test('backend TLS is private, covers both configured names and reuses its certificate without a public nginx key', async t => {
  const dir = await storage(t), tls = new WebAdminTls(dir), settings = { ...defaultWebSettings(), origin: 'https://127.0.0.1:9443', publicUrl: 'https://garage.example.test' };
  const first = await tls.load(settings), cert = new X509Certificate(first.cert);
  assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1'); assert.equal(cert.checkHost('garage.example.test'), 'garage.example.test');
  assert.deepEqual(await tls.load(settings), first);
  const root = path.join(dir, 'gdoorandbolt-coordinator'); assert.deepEqual(await readdir(root), ['web-certificate.json']);
  assert.equal((await stat(path.join(root, 'web-certificate.json'))).mode & 0o777, 0o600);
});
