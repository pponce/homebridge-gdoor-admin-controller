# Maintainer npm publication

Release 0.4.9 prepares three independent HomeKit reporting experiments: event recording only, subscriber inspection only, and deferred garage publication with diagnostics off. The owner wants to advance from 0.4.6 failures and 0.4.7 successes without requiring another initial ON/OFF/ON comparison. The cause remains unconfirmed. Startup and post-trial defaults remain full diagnostics/inline publication. The guided script requests one owner-operated cycle, checks process/mode/subscriber continuity at the boundaries, waits without polling and restores the baseline. Deferred reporting guards against obsolete updates; bolt publication, faster closing, saved profiles and commissioning remain unchanged. CI covers Homebridge 2.0.0 and the owner-reported 2.4.0 runtime. The separate administrator needs no installation update.

Use a clean clone at `~/devProjects/homebridge-gDoorAndBolt-coordinator`. Fetch/pull the reviewed main revision, then run:

```sh
bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA
```

The script requires that exact commit and a clean working tree, runs the unit suite, packs the package, checks its tracked-file allowlist and verifies its SHA-512 archive integrity. Only runtime source, custom settings UI, schema, README, reviewed documentation and synthetic examples are shipped. Tests, developer scripts, Git history, credentials and runtime state are excluded. No npm install lifecycle hook or separate service installer is added.

The script uses your normal npm account. If needed, npm prints a browser authentication URL to copy into a browser; it does not launch a browser. Publication may also request browser authentication. Run it as your normal user, not with sudo. Keep tokens out of commands and source files.

The exact archive and a publication receipt are retained in `.release/0.4.9/`, excluded from Git and the npm package. Publication is attempted once; registry reads wait up to ten minutes for metadata availability and confirm that the published integrity matches the saved artifact. A verification timeout does not establish publication failure. Metadata success does not guarantee that npm's archive download has propagated; an installation failure must leave Homebridge stopped for a later retry. If the connection drops, rerun the same command: an identical existing release is verified without publishing again. A different artifact at that version stops the script. An incomplete local pack also stops for inspection rather than replacing an existing release archive.

The publication script does not install a plugin, restart a service or move hardware. After it prints `RESULT: npm publication verified`, install on the Homebridge host:

```sh
sudo hb-service stop
sudo hb-service add homebridge-gdoorandbolt-coordinator@0.4.9
sudo hb-service start
```

Keep that stop → install → start order. The combined owner script stops on an install failure and leaves Homebridge stopped; it only restarts after a successful install. Git update and npm publication/verification complete before stopping Homebridge.

For an already enabled coordinator, update only while the garage is stationary, closed and locked, with controls unused. Keep the old movement/input services stopped. The update retains the enabled profile; it does not require adding the garage again. After installation keep Home visible and run `sudo python3 -B scripts/compare-homekit-reporting.py --experiment events` from the checkout. Follow its one-cycle prompt and share the output. The subscribers and deferred experiments are also prepared; select them explicitly as described in [homekit-reporting.md](homekit-reporting.md#next-experiments--049). Keep the independent capture script stopped during these trials. For a new installation follow [owner-test.md](owner-test.md), keeping the garage disabled until the old services are stopped. Source validation, npm publication, host installation and physical acceptance are separate milestones.
