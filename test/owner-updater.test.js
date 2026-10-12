import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = await readFile(new URL('../scripts/update-owner-0.4.45.sh', import.meta.url), 'utf8');
const installation = script.slice(script.lastIndexOf('\nsudo -v\n'));
assert.ok(installation.startsWith('\nsudo -v\n'), 'Updater installation boundary changed');

for (const outcome of ['success', 'failed-zero', 'failed-nonzero', 'unconfirmed']) {
  test('owner updater restarts only after confirmed installation: ' + outcome, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'owner-updater-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
release_spec='homebridge-gdoor-admin-controller@0.4.45'
release_directory="$UPDATER_TEST_DIRECTORY"
sudo() {
  printf '%s\\n' "$*" >> "$UPDATER_TEST_DIRECTORY/calls.txt"
  if [[ "$1" == 'hb-service' && "$2" == 'add' ]]; then
    case "$UPDATER_TEST_OUTCOME" in
      success) printf '\\033[32mInstalled %s.\\033[0m\\n' "$3" ;;
      failed-zero) echo 'Plugin installation failed as npm returned an error.' ;;
      failed-nonzero) return 1 ;;
      unconfirmed) echo 'No confirmed installation result.' ;;
    esac
  fi
}
${installation}
`], { env: { ...process.env, UPDATER_TEST_DIRECTORY: directory, UPDATER_TEST_OUTCOME: outcome }, encoding: 'utf8' });
    const calls = (await readFile(path.join(directory, 'calls.txt'), 'utf8')).trim().split('\n');
    assert.deepEqual(calls.slice(0, 3), ['-v', 'hb-service stop', 'hb-service add homebridge-gdoor-admin-controller@0.4.45']);
    if (outcome === 'success') {
      assert.equal(result.status, 0, result.stderr); assert.equal(calls[3], 'hb-service start');
    } else {
      assert.notEqual(result.status, 0); assert.equal(calls.length, 3, 'A failed or unconfirmed install must leave Homebridge stopped');
    }
  });
}
