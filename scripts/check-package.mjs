// Check the exact npm artifact before it can be published. No network or devices.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PLUGIN_VERSION } from '../src/api.js';

const manifestPath = process.argv[2];
assert.ok(manifestPath, 'Usage: node scripts/check-package.mjs /path/to/pack.json');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.name, 'homebridge-gdoor-admin-controller');
assert.equal(pkg.private, undefined);
assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
assert.equal(pkg.publishConfig.access, 'public');
assert.equal(PLUGIN_VERSION, pkg.version, 'API version label must match the npm package');
for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack', 'prepublish', 'prepublishOnly', 'publish', 'postpublish']) {
  assert.equal(pkg.scripts?.[hook], undefined, 'Unexpected release/install lifecycle hook: ' + hook);
}
const [pack, ...rest] = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(rest.length, 0);
assert.equal(pack.name, pkg.name);
assert.equal(pack.version, pkg.version);
assert.equal(pack.filename, `${pkg.name}-${pkg.version}.tgz`);
assert.deepEqual(pack.bundled ?? [], []);
const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0'));
const packed = new Set();
for (const file of pack.files) {
  assert.ok(tracked.has(file.path), 'Untracked package file: ' + file.path);
  assert.ok(/^(?:package\.json|README\.md|config\.schema\.json|src\/[\w-]+\.js|homebridge-ui\/(?:server\.js|public\/[\w-]+\.(?:js|css|html))|web-admin\/public\/[\w-]+\.(?:js|css|html|svg|png|webmanifest)|docs\/web-admin-assets\.json|docs\/[\w-]+\.md|examples\/[\w-]+\.json)$/.test(file.path), 'Unexpected package file: ' + file.path);
  assert.equal(packed.has(file.path), false, 'Duplicate package file');
  packed.add(file.path);
}
for (const file of ['package.json', 'README.md', 'config.schema.json', 'src/index.js', 'src/runtime.js', 'homebridge-ui/server.js', 'homebridge-ui/public/index.html', 'homebridge-ui/public/app.js', 'homebridge-ui/public/editor.js', 'homebridge-ui/public/style.css', 'docs/owner-test.md', 'src/web-admin-auth.js', 'src/web-admin-store.js', 'web-admin/public/index.html', 'docs/web-admin-assets.json']) {
  assert.ok(packed.has(file), 'Required package file missing: ' + file);
}
const directory = await realpath(path.dirname(manifestPath));
const archivePath = path.join(directory, pack.filename);
assert.equal(await realpath(archivePath), archivePath);
const archive = await readFile(archivePath);
assert.equal(archive.length, pack.size);
assert.equal('sha512-' + createHash('sha512').update(archive).digest('base64'), pack.integrity);
console.log(`Verified ${pkg.name}@${pkg.version}: ${packed.size} tracked package files; archive integrity matches.`);
