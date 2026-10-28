import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { webAdminDatabase } from '../src/web-admin-sqlite.js';

test('the actual SQLite API opens, writes and reads with the current runtime', async () => {
  const Database = await webAdminDatabase(), db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE sample(value TEXT);');
    db.prepare('INSERT INTO sample VALUES(?)').run('kept');
    assert.equal(db.prepare('SELECT value FROM sample').get().value, 'kept');
  } finally { db.close(); }
});

for (const scenario of ['canonical', 'legacy', 'missing', 'invalid']) {
  test('SQLite loading handles ' + scenario + ' API without a Node version assumption', () => {
    const source = scenario === 'canonical'
      ? 'export class Database { static fixture = "canonical"; } export class DatabaseSync { static fixture = "wrong"; }'
      : scenario === 'legacy' ? 'export class DatabaseSync { static fixture = "legacy"; }'
        : 'export const Database = null; export const DatabaseSync = undefined;';
    const loader = `export async function resolve(specifier, context, next) {
      if (specifier === 'node:sqlite') {
        ${scenario === 'missing' ? 'throw new Error("private synthetic dependency detail");' : `return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(source))}, shortCircuit: true };`}
      }
      return next(specifier, context);
    }`;
    const registration = 'data:text/javascript,' + encodeURIComponent(
      `import { register } from 'node:module'; register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(loader))});`);
    const program = `import assert from 'node:assert/strict';
      import { webAdminDatabase } from ${JSON.stringify(new URL('../src/web-admin-sqlite.js', import.meta.url).href)};
      ${['missing', 'invalid'].includes(scenario)
        ? "await assert.rejects(webAdminDatabase(), error => error.message === 'web_admin_sqlite_unavailable');"
        : `assert.equal((await webAdminDatabase()).fixture, ${JSON.stringify(scenario)});`}`;
    const result = spawnSync(process.execPath, ['--import', registration, '--input-type=module', '-e', program], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(!(result.stdout + result.stderr).includes('private synthetic dependency detail'));
  });
}
