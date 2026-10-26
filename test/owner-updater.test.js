import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

for (const version of ['0.4.45', '0.4.46', '0.4.47', '0.4.48', '0.4.49', '0.4.50', '0.4.51', '0.4.52', '0.4.53', '0.4.54', '0.4.55']) {
const script = await readFile(new URL('../scripts/update-owner-' + version + '.sh', import.meta.url), 'utf8');
const installation = script.slice(script.lastIndexOf('\nsudo -v\n'));
assert.ok(installation.startsWith('\nsudo -v\n'), 'Updater installation boundary changed');

for (const outcome of ['apt-success', 'ui-success', 'failed-zero', 'failed-nonzero', 'wrong-version', 'missing-package']) {
  test('owner updater ' + version + ' restarts only after confirmed installation: ' + outcome, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'owner-updater-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const plugins = path.join(directory, 'installed');
    if (outcome !== 'missing-package') {
      await mkdir(path.join(plugins, 'homebridge-gdoor-admin-controller'), {recursive:true});
      await writeFile(path.join(plugins, 'homebridge-gdoor-admin-controller/package.json'), JSON.stringify({
        name:'homebridge-gdoor-admin-controller', version:outcome==='wrong-version'?'0.4.44':version,
      }));
    }
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
release_spec='homebridge-gdoor-admin-controller@${version}'
release_directory="$UPDATER_TEST_DIRECTORY"
release_plugin_path="$UPDATER_TEST_DIRECTORY/installed"
sudo() {
  printf '%s\\n' "$*" >> "$UPDATER_TEST_DIRECTORY/calls.txt"
  if [[ "$1" == 'node' ]]; then command "$@"; return; fi
  if [[ "$1" == 'hb-service' && "$2" == 'add' ]]; then
    case "$UPDATER_TEST_OUTCOME" in
      apt-success) printf 'changed 1 package in 1s\\n' ;;
      ui-success|wrong-version) printf '\\033[32mInstalled %s.\\033[0m\\n' "$3" ;;
      failed-zero) echo 'Plugin installation failed as npm returned an error.' ;;
      failed-nonzero) return 1 ;;
      missing-package) echo 'changed 1 package in 1s' ;;
    esac
  fi
}
${installation}
`], { env: { ...process.env, UPDATER_TEST_DIRECTORY: directory, UPDATER_TEST_OUTCOME: outcome }, encoding: 'utf8' });
    const calls = (await readFile(path.join(directory, 'calls.txt'), 'utf8')).trim().split('\n');
    assert.deepEqual(calls.slice(0, 3), ['-v', 'hb-service stop', 'hb-service add homebridge-gdoor-admin-controller@' + version]);
    if (outcome.endsWith('success')) {
      assert.equal(result.status, 0, result.stderr); assert.equal(calls.at(-1), 'hb-service start');
    } else {
      assert.notEqual(result.status, 0); assert.ok(!calls.includes('hb-service start'), 'A failed or unconfirmed install must leave Homebridge stopped');
    }
  });
}
}
