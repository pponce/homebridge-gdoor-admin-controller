import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('read-only HAP capture parses fragmented multi-characteristic events and selects only coordinator tiles', () => {
  const result = spawnSync('python3', ['-B', fileURLToPath(new URL('./watch-homekit-events.py', import.meta.url))], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
