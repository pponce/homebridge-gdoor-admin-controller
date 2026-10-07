# Maintainer npm publication

Release 0.4.12 corrects garage-card draft status and removal, and simplifies connection-key management. Checks and enable/disable controls live inside each garage card; Devices, Inputs and Behavior are the only setup tabs. Adding an unsaved garage keeps other unchanged enabled garages green. Remove this garage door removes the selected draft immediately without browser dialogs. Removing a saved garage is staged for review/save, and Discard changes restores it.

General shows clearly labeled new-key fields above the saved names and hidden values. Replace and Delete are explicit actions. Keys referenced by saved settings cannot be deleted; unused-key creation/deletion does not pause existing garages. Replacement retains the re-enablement policy. Native Save configuration, success toasts and bottom Save behavior remain.

The virtual keypad is optional and belongs to the standalone web admin. A dropdown replaces the old buttons: Not used hides the alarm fields; a configured physical keypad supplies an alarm scope, or details can be entered manually. Existing scopes are preserved. The plugin does not claim to detect whether the web admin is installed. Native Save configuration, success toast and bottom Homebridge Save behavior remain. See [the save flow and validation limits](config-ui-experience.md).

The release retains 0.4.9's independent HomeKit reporting experiments: event recording only, subscriber inspection only, and deferred garage publication with diagnostics off. The Home display issue remains unresolved; startup and post-trial defaults remain full diagnostics/inline publication. Movement behavior, bolt publication, faster closing, saved profiles and existing commissioning records are retained on upgrade. Reviewed name-only changes now preserve commissioning; explicit Disable removes it only for the selected garage. CI covers Homebridge 2.0.0 and the owner-reported 2.4.0 runtime. The separate administrator needs no installation update.

Use a clean clone at `~/devProjects/homebridge-gDoorAndBolt-coordinator`. Fetch/pull the reviewed main revision, then run:

```sh
bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA
```

The script requires that exact commit and a clean working tree, runs the unit suite, packs the package, checks its tracked-file allowlist and verifies its SHA-512 archive integrity. Only runtime source, custom settings UI, schema, README, reviewed documentation and synthetic examples are shipped. Tests, developer scripts, Git history, credentials and runtime state are excluded. No npm install lifecycle hook or separate service installer is added.

The script uses your normal npm account. If needed, npm prints a browser authentication URL to copy into a browser; it does not launch a browser. Publication may also request browser authentication. Run it as your normal user, not with sudo. Keep tokens out of commands and source files.

The exact archive and a publication receipt are retained in `.release/0.4.12/`, excluded from Git and the npm package. Publication is attempted once; registry reads wait up to ten minutes for metadata availability and confirm that the published integrity matches the saved artifact. A verification timeout does not establish publication failure. Metadata success does not guarantee that npm's archive download has propagated; an installation failure must leave Homebridge stopped for a later retry. If the connection drops, rerun the same command: an identical existing release is verified without publishing again. A different artifact at that version stops the script. An incomplete local pack also stops for inspection rather than replacing an existing release archive.

The publication script does not install a plugin, restart a service or move hardware. After it prints `RESULT: npm publication verified`, install on the Homebridge host:

```sh
sudo hb-service stop
sudo hb-service add homebridge-gdoorandbolt-coordinator@0.4.12
sudo hb-service start
```

Keep that stop → install → start order. The combined owner script stops on an install failure and leaves Homebridge stopped; it only restarts after a successful install. Git update and npm publication/verification complete before stopping Homebridge.

For an already enabled coordinator, update only while the garage is stationary, closed and locked, with controls unused. Keep the old movement/input services stopped. The update retains the enabled profile; it does not require adding the garage again. After installation, reopen the plugin settings to load General. Create-key fields appear above saved names and hidden values. Replace starts with an empty field; Delete checks that saved settings no longer use the key. Select Garage doors to view each garage’s status and three setup tabs. Existing saved settings should offer the native bottom Save immediately. After editing, use Review changes and Save configuration; wait for the success toast, then use the bottom Save to finish. Changed control settings can still require the existing explicit connection checks and re-enablement; the validity indicator does not replace those checks.

To continue the separate Home display investigation, keep Home visible and run `sudo python3 -B scripts/compare-homekit-reporting.py --experiment events` from the checkout. Follow its one-cycle prompt and share the output. The subscribers and deferred experiments are also prepared; select them explicitly as described in [homekit-reporting.md](homekit-reporting.md#next-experiments--049). Keep the independent capture script stopped during these trials. For a new installation follow [owner-test.md](owner-test.md), keeping the garage disabled until the old services are stopped. Source validation, npm publication, host installation and physical acceptance are separate milestones.
