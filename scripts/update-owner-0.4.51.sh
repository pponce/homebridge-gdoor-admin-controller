#!/usr/bin/env bash
# Owner-run publication and update, pinned to the reviewed release source.
# Run while the garage is stationary. Keep both plugins in separate child bridges.
set -euo pipefail
umask 077
trap 'printf "Update stopped after an error. Review the output before retrying.\n" >&2' ERR

release_commit="${1:?Usage: bash scripts/update-owner-0.4.51.sh REVIEWED_COMMIT_SHA}"
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Use the full reviewed release commit." >&2; exit 1; }
release_remote='git@github.com:pponce/homebridge-gdoor-admin-controller.git'
release_branch='main'
release_checkout="$HOME/devProjects/homebridge-gdoor-admin-controller"
release_spec='homebridge-gdoor-admin-controller@0.4.51'
release_registry='https://registry.npmjs.org/'
release_plugin_path="${OWNER_HOMEBRIDGE_PLUGIN_PATH:-/var/lib/homebridge/node_modules}"

[[ -t 0 && -t 1 ]] || { echo 'Run this script in an interactive terminal for npm browser approval.' >&2; exit 1; }
for release_command in git node npm sudo hb-service; do command -v "$release_command" >/dev/null; done
echo 'START Garage Door Admin Controller 0.4.51 update'
mkdir -p "$HOME/devProjects"
if [[ ! -e "$release_checkout" ]]; then
  git clone "$release_remote" "$release_checkout"
fi
cd -P "$release_checkout"
[[ "$(git rev-parse --show-toplevel)" == "$PWD" ]] || { echo 'This directory is not the expected repository root.' >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo 'Local changes found. They were preserved; stop and review them before updating.' >&2; exit 1; }
git fetch "$release_remote" "$release_branch"
git merge-base --is-ancestor "$release_commit" FETCH_HEAD
git switch --detach "$release_commit"
node -e 'const p=require("./package.json"); if(p.name!=="homebridge-gdoor-admin-controller"||p.version!=="0.4.51") throw Error("Unexpected release package"); if(![22,24].includes(Number(process.versions.node.split(".")[0]))) throw Error("Use Node 22 or 24");'
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
bash scripts/publish-npm.sh "$release_commit" </dev/tty >/dev/tty

# Verify a real registry download before stopping Homebridge.
release_directory="$PWD/.release/0.4.51"
release_download="$release_directory/download"
mkdir -p "$release_download"
release_download_deadline=$((SECONDS + 600))
while true; do
  if npm pack "$release_spec" --ignore-scripts --json --registry "$release_registry" --prefer-online --fetch-timeout=30000 --fetch-retries=0 --pack-destination "$release_download" > "$release_download/pack.json"; then
    break
  fi
  if (( SECONDS >= release_download_deadline )); then
    echo 'The published package is not downloadable yet. Homebridge was not stopped. Rerun this updater later.' >&2
    exit 1
  fi
  echo 'Waiting for npm download availability; no publication is repeated and Homebridge remains running.'
  sleep 10
done
node scripts/check-package.mjs "$release_download/pack.json"
node -e 'const fs=require("node:fs"), assert=require("node:assert/strict"); const [saved]=JSON.parse(fs.readFileSync(process.argv[1])), [downloaded]=JSON.parse(fs.readFileSync(process.argv[2])); assert.equal(downloaded.integrity,saved.integrity,"Registry download differs from the reviewed release archive"); console.log("Downloaded npm artifact matches the reviewed release.");' "$release_directory/pack.json" "$release_download/pack.json"

sudo -v
sudo hb-service stop
# The APT hb-service shim prints npm output, without an "Installed" message.
# Check the managed package on disk; retain a hold for explicit CLI failures.
release_install_output="$release_directory/install-output.txt"
sudo hb-service add "$release_spec" 2>&1 | tee "$release_install_output"
sudo node --input-type=module - "$release_plugin_path" "$release_install_output" <<'NODE'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const [plugins, file] = process.argv.slice(2);
assert.ok(path.isAbsolute(plugins), 'Use the absolute managed plugin path. Homebridge remains stopped.');
const output = readFileSync(file, 'utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
assert.ok(!output.includes('Plugin installation failed'), 'Installation failed. Homebridge remains stopped.');
const installed = JSON.parse(readFileSync(path.join(plugins, 'homebridge-gdoor-admin-controller/package.json'), 'utf8'));
assert.equal(installed.name, 'homebridge-gdoor-admin-controller', 'Wrong managed package. Homebridge remains stopped.');
assert.equal(installed.version, '0.4.51', 'Wrong installed version. Homebridge remains stopped.');
console.log('Managed plugin verified: homebridge-gdoor-admin-controller@0.4.51');
NODE
sudo hb-service start
echo 'RESULT: Homebridge updated to homebridge-gdoor-admin-controller@0.4.51'
echo 'Current garage configuration and HomeKit pairing are retained.'
echo 'Bolt extension/retraction settling now applies to every enabled bolt setup.'
echo 'Existing numeric retraction waits remain overrides. Select Use shared settling before opening/closing to inherit the shared value.'
echo 'Pulse duration runs independently; the coordinator keeps ownership through checked OFF and prevents opposite-output overlap.'
echo 'Momentary bolt position is estimated and remains Unknown after restart until an acknowledged bolt command.'
echo 'END Garage Door Admin Controller update'
