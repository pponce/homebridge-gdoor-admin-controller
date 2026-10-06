#!/usr/bin/env bash
# Run from a clean, reviewed checkout. Never installs or operates Homebridge.
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."

release_expected_commit="${1:?Usage: bash scripts/publish-npm.sh EXPECTED_COMMIT}"
release_commit="$(git rev-parse HEAD)"
[[ "$release_commit" == "$release_expected_commit" ]] || { echo 'Checkout does not match the reviewed release revision.' >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo 'Keep local changes intact: release requires a clean checkout.' >&2; exit 1; }
node -e 'if (![22,24].includes(Number(process.versions.node.split(".")[0]))) throw Error("Use Node 22 or 24 for this release")'

release_registry='https://registry.npmjs.org/'
release_name="$(node -p 'JSON.parse(require("fs").readFileSync("package.json")).name')"
release_version="$(node -p 'JSON.parse(require("fs").readFileSync("package.json")).version')"
release_spec="$release_name@$release_version"
release_directory="$PWD/.release/$release_version"
echo "START npm release: $release_spec"
npm test

if [[ -d "$release_directory" ]]; then
  [[ "$(cat "$release_directory/source-commit.txt")" == "$release_commit" ]] || { echo 'Saved release artifact belongs to a different revision; keep it for review.' >&2; exit 1; }
else
  mkdir -p "$release_directory"
  printf '%s\n' "$release_commit" > "$release_directory/source-commit.txt"
  npm pack --ignore-scripts --json --pack-destination "$release_directory" > "$release_directory/pack.json"
fi
node scripts/check-package.mjs "$release_directory/pack.json"
release_archive="$release_directory/$release_name-$release_version.tgz"

# Exit codes: 0 = identical published artifact, 2 = explicitly not published,
# 3 = unavailable lookup, 4 = a different artifact already owns this version.
release_lookup() {
  local release_view_status=0
  npm view "$release_spec" dist --json --registry "$release_registry" --fetch-timeout=15000 --fetch-retries=0 > "$release_directory/registry.json" 2> "$release_directory/registry-error.txt" || release_view_status=$?
  node --input-type=module - "$release_directory" "$release_view_status" <<'NODE'
import { readFileSync } from 'node:fs';
const [directory, status] = process.argv.slice(2);
let value;
try { value = JSON.parse(readFileSync(directory + '/registry.json', 'utf8')); } catch { process.exit(3); }
if (status !== '0') process.exit(value?.error?.code === 'E404' ? 2 : 3);
const [pack] = JSON.parse(readFileSync(directory + '/pack.json', 'utf8'));
process.exit(value?.integrity === pack.integrity ? 0 : 4);
NODE
}

release_state=0
release_lookup || release_state=$?
case "$release_state" in
  0) echo 'This exact artifact is already published; no publish repeated.' ;;
  2)
    if ! npm whoami --registry "$release_registry" --fetch-timeout=15000 --fetch-retries=0; then
      npm login --auth-type=web --registry "$release_registry"
    fi
    echo "Publishing $release_spec to the public npm registry. Complete npm authentication if prompted."
    # One publication attempt only. A lost response is resolved by reading npm.
    if ! npm publish "$release_archive" --ignore-scripts --access public --tag latest --registry "$release_registry" --fetch-timeout=60000 --fetch-retries=0; then
      echo 'Publication did not return success; checking the registry before drawing a conclusion.' >&2
    fi
    ;;
  3) echo 'npm could not be checked. No publication attempted; rerun when connected.' >&2; exit 1 ;;
  *) echo 'This npm version already contains a different artifact. No publication attempted.' >&2; exit 1 ;;
esac

for release_attempt in 1 2 3 4 5 6; do
  release_state=0
  release_lookup || release_state=$?
  if [[ "$release_state" == 0 ]]; then
    printf 'package=%s\nsource=%s\nverified_at=%s\n' "$release_spec" "$release_commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$release_directory/publication-receipt.txt"
    echo "RESULT: npm publication verified: $release_spec"
    echo "Install on the Homebridge host: sudo hb-service add $release_spec"
    echo "END npm release: $release_spec"
    exit 0
  fi
  [[ "$release_state" != 4 ]] || { echo 'Registry artifact differs from the saved release. Stop and review.' >&2; exit 1; }
  [[ "$release_attempt" == 6 ]] || sleep 5
done
echo 'Publication could not be verified. The exact artifact is saved under .release; rerun this script to check again.' >&2
exit 1
