import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadWebAdminAssets } from '../src/web-admin-assets.js';

test('reused UI retains pinned source provenance and explicit Homebridge adaptation hashes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/web-admin-assets.json', import.meta.url)));
  assert.equal(manifest.files.length, 12);
  for (const entry of manifest.files) {
    const bytes = await readFile(new URL('../' + entry.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.adaptedSha256 ?? entry.sha256, entry.path);
    if(entry.adaptedSha256)assert.ok(typeof entry.adaptation==='string'&&entry.adaptation.length>0);
  }
  for (const entry of manifest.additions ?? []) {
    assert.equal(createHash('sha256').update(await readFile(new URL('../' + entry.path, import.meta.url))).digest('hex'), entry.sha256);
  }
});
test('only reviewed browser assets are exposed, with all initial page resources present', async () => {
  const assets = await loadWebAdminAssets();
  const index = assets.get('/').content.toString('utf8');
  assert.match(index, /Welcome back/);
  assert.equal(assets.size, 14);
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(assets.has(match[1]), match[1]);
  }
  assert.equal(assets.has('/web-accounts.json'), false);
  assert.equal(assets.has('/install.html'), false);
  assert.equal(assets.has('/../src/web-admin-auth.js'), false);
  assert.equal(assets.get('/app-icon-192.png').type, 'image/png');
  assert.equal(assets.get('/manifest.webmanifest').type, 'application/manifest+json');
});
