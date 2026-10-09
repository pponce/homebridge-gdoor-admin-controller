#!/usr/bin/env bash
# Owner-run publication and update, pinned to the reviewed release source.
# Run while the garage is stationary. Keep both plugins in separate child bridges.
set -euo pipefail
umask 077
trap 'printf "Update stopped after an error. Review the output before retrying.\n" >&2' ERR

release_commit='c0c4421f7a341a097648dc3c34192180d7a8af5b'
release_remote='git@github.com:pponce/homebridge-gdoor-admin-controller.git'
release_branch='main'
release_checkout="$HOME/devProjects/homebridge-gdoor-admin-controller"
release_spec='homebridge-gdoor-admin-controller@0.4.32'
release_registry='https://registry.npmjs.org/'

[[ -t 0 && -t 1 ]] || { echo 'Run this script in an interactive terminal for npm browser approval.' >&2; exit 1; }
for release_command in git node npm sudo hb-service; do command -v "$release_command" >/dev/null; done
echo 'START Garage Door Admin Controller 0.4.32 update'
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
node -e 'const p=require("./package.json"); if(p.name!=="homebridge-gdoor-admin-controller"||p.version!=="0.4.32") throw Error("Unexpected release package"); if(![22,24].includes(Number(process.versions.node.split(".")[0]))) throw Error("Use Node 22 or 24");'
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
bash scripts/publish-npm.sh "$release_commit" </dev/tty >/dev/tty

# Verify a real registry download before stopping Homebridge.
release_directory="$PWD/.release/0.4.32"
release_download="$release_directory/download"
mkdir -p "$release_download"
npm pack "$release_spec" --ignore-scripts --json --registry "$release_registry" --prefer-online --fetch-timeout=30000 --fetch-retries=2 --pack-destination "$release_download" > "$release_download/pack.json"
node scripts/check-package.mjs "$release_download/pack.json"
node -e 'const fs=require("node:fs"), assert=require("node:assert/strict"); const [saved]=JSON.parse(fs.readFileSync(process.argv[1])), [downloaded]=JSON.parse(fs.readFileSync(process.argv[2])); assert.equal(downloaded.integrity,saved.integrity,"Registry download differs from the reviewed release archive"); console.log("Downloaded npm artifact matches the reviewed release.");' "$release_directory/pack.json" "$release_download/pack.json"

sudo -v
sudo hb-service stop
sudo hb-service add "$release_spec"
sudo hb-service start
echo 'RESULT: Homebridge updated to homebridge-gdoor-admin-controller@0.4.32'
echo 'Refresh the web interface to load the clearer PIN and Homebridge setup instructions.'
echo 'Open Continue Homebridge update, authorize, then choose Cancel PIN change and restore service when offered.'
echo 'After it finishes without applying the change, you can start Homebridge PIN setup again.'
echo 'END Garage Door Admin Controller update'
