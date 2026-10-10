# Developer release workflow

The current release candidate is **0.4.42**. User-facing changes belong in the root [CHANGELOG.md](../CHANGELOG.md), not the README. Earlier publication notes are preserved in [the developer archive](developer/npm-release-history.md).

## Before publishing

1. Update package.json and add a dated changelog section. The API version reads package.json automatically.
2. Run `node scripts/build-demo.mjs` after web UI changes and commit the generated static demo.
3. Run the relevant tests. Require all five Coordinator checks jobs on the release revision: Node 22/24, Homebridge 2.0/2.4, and desktop/mobile UI checks. The CI package check verifies only tracked, allowlisted files; CHANGELOG.md must be included.
4. Advance main to the reviewed revision without overwriting other work or bypassing repository protections.

## GitHub release

After the Coordinator checks workflow succeeds for a push to main, Publish GitHub release creates **vVERSION**, using the exact tested commit and the matching changelog section. It attaches the checked npm tarball, source commit receipt, and static-demo ZIP. Existing releases are left untouched; an existing tag pointing elsewhere is rejected. No npm credentials are used by this workflow.

Homebridge UI looks for a GitHub release whose tag matches the npm version (v-prefixed first), and can read CHANGELOG.md from the installed package. Keep the npm version, tag, and notes aligned. The GitHub repository is currently private: ordinary Homebridge installations cannot fetch its GitHub release notes anonymously. The packaged changelog still travels with the npm installation. Repository visibility is a separate owner decision; do not expose the preserved private history by changing visibility as a side effect of a release.

Sources: [Homebridge release/changelog lookup](https://github.com/homebridge/homebridge-config-ui-x/blob/latest/src/modules/plugins/plugins.service.ts), [hb-service plugin management](https://github.com/homebridge/homebridge-config-ui-x/blob/latest/src/bin/hb-service.ts).

## npm publication

From a clean SSH checkout on the maintainer's authenticated host, install runtime dependencies without lifecycle hooks, then run:

```sh
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA
```

Use the full reviewed commit SHA, not a moving branch name. The script runs tests, retains one exact package under .release/0.4.42, verifies its tracked-file allowlist and integrity, and publishes it once with the latest tag. npm login and publish use browser authentication with browser=false: open the printed URL manually. A delayed or lost publish response is resolved by checking the registry for up to ten minutes, not by repeatedly publishing. An existing different artifact or an unavailable registry check stops publication.

Source validation, GitHub release publication, npm publication, and installing on a Homebridge host are separate outcomes. The publisher does not stop, install into, or restart Homebridge. After npm publication is verified, installation on a host uses stop → pinned add → start, leaving Homebridge stopped on install failure. Keep the old movement/controller services stopped.

The package retains its existing UNLICENSED metadata. This release does not grant a new open-source license or claim Homebridge verification.
