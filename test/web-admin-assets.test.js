import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadWebAdminAssets } from '../src/web-admin-assets.js';

test('reused UI bytes match the pinned standalone reference manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/web-admin-assets.json', import.meta.url)));
  assert.equal(manifest.files.length, 12);
  for (const entry of manifest.files) {
    const bytes = await readFile(new URL('../' + entry.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
  }
});
test('only reviewed browser assets are exposed, with all initial page resources present', async () => {
  const assets = await loadWebAdminAssets();
  const index = assets.get('/').content.toString('utf8');
  assert.match(index, /Welcome back/);
  assert.equal(assets.size, 12);
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    // The standalone installation help requires a Homebridge-specific replacement.
    if (match[1] !== '/installation-help.html') assert.ok(assets.has(match[1]), match[1]);
  }
  assert.equal(assets.has('/web-accounts.json'), false);
  assert.equal(assets.has('/install.html'), false);
  assert.equal(assets.has('/../src/web-admin-auth.js'), false);
  assert.equal(assets.get('/app-icon-192.png').type, 'image/png');
  assert.equal(assets.get('/manifest.webmanifest').type, 'application/manifest+json');
});
