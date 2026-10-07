# Maintainer npm publication

Release 0.4.5 corrects HomeKit reporting: synchronous committed-snapshot GET handlers prevent an earlier read from overwriting a later report; both garage and bolt receive bounded current/target reaffirmation; preparation pairs and superseded SET completion are handled consistently. The actual-HAP regression checks the read/report race separately from live Apple Home acceptance. The faster-closing behavior introduced in 0.4.4 is unchanged. Saved settings, credentials, device assignments and commissioning are retained; the profile format and management API are unchanged. The five original configurable reporting controls remain unimplemented. Public npm publication does not make the GitHub repository public. The existing licensing position remains `UNLICENSED`. Homebridge 2 and Node 22/24 are required; the admin remains a separate project.

Use a clean clone at `~/devProjects/homebridge-gDoorAndBolt-coordinator`. Fetch/pull the reviewed main revision, then run:

```sh
bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA
```

The script requires that exact commit and a clean working tree, runs the unit suite, packs the package, checks its tracked-file allowlist and verifies its SHA-512 archive integrity. Only runtime source, custom settings UI, schema, README, reviewed documentation and synthetic examples are shipped. Tests, developer scripts, Git history, credentials and runtime state are excluded. No npm install lifecycle hook or separate service installer is added.

The script uses your normal npm account. If needed, npm prints a browser authentication URL to copy into a browser; it does not launch a browser. Publication may also request browser authentication. Run it as your normal user, not with sudo. Keep tokens out of commands and source files.

The exact archive and a publication receipt are retained in `.release/0.4.5/`, excluded from Git and the npm package. Publication is attempted once; registry reads wait up to ten minutes for availability and confirm that the published integrity matches the saved artifact. A verification timeout does not establish publication failure. If the connection drops, rerun the same command: an identical existing release is verified without publishing again. A different artifact at that version stops the script. An incomplete local pack also stops for inspection rather than replacing an existing release archive.

The publication script does not install a plugin, restart a service or move hardware. After it prints `RESULT: npm publication verified`, install on the Homebridge host:

```sh
sudo hb-service add homebridge-gdoorandbolt-coordinator@0.4.5
```

For an already enabled coordinator, update only while the garage is stationary, closed and locked, with controls unused. Keep the old movement/input services stopped. The update retains the enabled profile; it does not require adding the garage again. Then retest indoor open/close, accepted/rejected physical PIN outcomes and both HomeKit directions, checking final garage and bolt status. For a new installation follow [owner-test.md](owner-test.md), keeping the garage disabled until the old services are stopped. Source validation, npm publication, host installation and physical acceptance are separate milestones.
