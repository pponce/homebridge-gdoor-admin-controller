// Extract the matching user-facing changelog section, never generated commit history.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const destination = process.argv[2];
assert.ok(destination, 'Usage: node scripts/prepare-release.mjs NOTES_FILE');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Official releases must use a stable version');
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const section = changelog.split(/^## /m).find(value => value.startsWith(pkg.version + ' — '));
assert.ok(section, 'Missing dated changelog section for ' + pkg.version);
let body = section.slice(section.indexOf('\n') + 1).trim();
const root = 'https://github.com/pponce/homebridge-gdoor-admin-controller';
body = body.replace(/\]\((docs\/[^)]+)\)/g, `](${root}/blob/v${pkg.version}/$1)`);
body = 'Coordinate a garage door and separate bolt in Homebridge, with optional deCONZ user, PIN, keypad-protection, and alarm web administration.\n\n' + body;
body += `\n\n### Downloads\n\nThe release includes the reviewed npm archive and a static demo ZIP. Extract the demo ZIP onto a static HTTPS web server to explore fictional data without connecting to hardware. See [installation and requirements](${root}/blob/v${pkg.version}/README.md).\n`;
await writeFile(destination, body);
console.log('Prepared release notes for v' + pkg.version);
