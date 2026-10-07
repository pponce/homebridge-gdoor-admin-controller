# Release 0.4.18

Compact input selection with one detail panel, preserving draft edits and selecting newly added controls. Motor route labels now identify Garage opener (Tailwind/Homebridge) or Relay: name. Runtime behavior is unchanged. Validation pending.

# Release 0.4.17

Reversal opening estimates now start after the relay interruption command completes, preserving downward travel until that boundary and adding the configured positive allowance afterward. Includes 0.4.16 Debug controls/downloads and 0.4.15 configured connections. Local tests pass; All five CI jobs passed in run 37695822293 on 0df8d0fbe8f98621274500c9b17580fc30a2b60e: 165 unit tests on Node 22/24, actual Homebridge 2.0.0/2.4.0, UI IPC and desktop/mobile browser flows. Physical timing still requires owner acceptance.

# Release 0.4.16

Adds the Debug tab after Garage doors, with temporary recording controls, status snapshots and sanitized downloads. Includes 0.4.15 configured-connection selection. Recording remains OFF at startup; movement and reporting behavior are unchanged. All five browser/runtime CI jobs passed in run 37695140948. Source is ready for maintainer publication; npm publication and owner installation remain separate.

# Release 0.4.15

Adds configured local Homebridge bridge selection with private PIN import, plus deCONZ addresses from documented hosts. No patches, private cache reads, movement/reporting changes or changes to the 0.4.14 diagnostic OFF startup default. All five browser/runtime CI jobs passed in run 37693768601. Source is ready for maintainer publication; owner installation remains separate.

# Maintainer npm publication

Release 0.4.14 fixes the garage-card review route. After editing an existing garage, its Review changes action opens the configuration summary and Save configuration inside that card. The bottom review button accesses the same transaction. Name-only edits preserve the enabled/disabled color with a pending-changes label, while faults and control-setting changes retain attention styling. The review names the old and new garage names and states that all pending configuration changes will be saved. Native success toast and final Homebridge Save are retained. At the owner’s request, diagnostics now start OFF, with on-demand re-enablement retained. Notification methods, order and repeats, movement and saved settings are unchanged.

Version 0.4.13 adds reusable device connections under General: deCONZ URL/API key, Tailwind address/local token/optional door count, and existing Homebridge accessory bridge address/pairing PIN. Context explains how each is used. New connections can reuse saved keys or create a private key inline, and garage setup selects connections by name. Existing addresses/key references import automatically without changing hardware profiles or enablement. Tailwind doors display one-based names. Catalog edits use Review/Save; actual connection changes require checks only for affected garages.

The 0.4.12 card, draft-removal and key-management fixes remain. The standalone administrator's settings client is updated to preserve the optional catalog; pull that administrator update before editing settings there if it is installed. Its UI stays standalone at its own URL. See [configuration UI](config-ui-experience.md).

The virtual keypad is optional and belongs to the standalone web admin. A dropdown replaces the old buttons: Not used hides the alarm fields; a configured physical keypad supplies an alarm scope, or details can be entered manually. Existing scopes are preserved. The plugin does not claim to detect whether the web admin is installed. Native Save configuration, success toast and bottom Homebridge Save behavior remain. See [the save flow and validation limits](config-ui-experience.md).

The release retains 0.4.9's independent HomeKit reporting experiments: event recording only, subscriber inspection only, and deferred garage publication with diagnostics off. The Home display issue remains unresolved; startup defaults are OFF/inline in 0.4.14; comparisons restore their incoming modes. Movement behavior, bolt publication, faster closing, saved profiles and existing commissioning records are retained on upgrade. Reviewed name-only changes now preserve commissioning; explicit Disable removes it only for the selected garage. CI covers Homebridge 2.0.0 and the owner-reported 2.4.0 runtime. An installed administrator needs the matching client compatibility update before editing coordinator settings.

Use a clean clone at `~/devProjects/homebridge-gDoorAndBolt-coordinator`. Fetch/pull the reviewed main revision, then run:

```sh
bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA
```

The script requires that exact commit and a clean working tree, runs the unit suite, packs the package, checks its tracked-file allowlist and verifies its SHA-512 archive integrity. Only runtime source, custom settings UI, schema, README, reviewed documentation and synthetic examples are shipped. Tests, developer scripts, Git history, credentials and runtime state are excluded. No npm install lifecycle hook or separate service installer is added.

The script uses your normal npm account. If needed, npm prints a browser authentication URL to copy into a browser; it does not launch a browser. Publication may also request browser authentication. Run it as your normal user, not with sudo. Keep tokens out of commands and source files.

The exact archive and a publication receipt are retained in `.release/0.4.14/`, excluded from Git and the npm package. Publication is attempted once; registry reads wait up to ten minutes for metadata availability and confirm that the published integrity matches the saved artifact. A verification timeout does not establish publication failure. Metadata success does not guarantee that npm's archive download has propagated; an installation failure must leave Homebridge stopped for a later retry. If the connection drops, rerun the same command: an identical existing release is verified without publishing again. A different artifact at that version stops the script. An incomplete local pack also stops for inspection rather than replacing an existing release archive.

The publication script does not install a plugin, restart a service or move hardware. After it prints `RESULT: npm publication verified`, install on the Homebridge host:

```sh
sudo hb-service stop
sudo hb-service add homebridge-gdoorandbolt-coordinator@0.4.14
sudo hb-service start
```

Keep that stop → install → start order. The combined owner script stops on an install failure and leaves Homebridge stopped; it only restarts after a successful install. Git update and npm publication/verification complete before stopping Homebridge.

For an already enabled coordinator, update only while the garage is stationary, closed and locked, with controls unused. Keep the old movement/input services stopped. The update retains the enabled profile; it does not require adding the garage again. After installation, reopen the plugin settings to load General. Create-key fields appear above saved names and hidden values. Replace starts with an empty field; Delete checks that saved settings no longer use the key. Select Garage doors to view each garage’s status and three setup tabs. Existing saved settings should offer the native bottom Save immediately. After editing, use Review changes and Save configuration; wait for the success toast, then use the bottom Save to finish. Changed control settings can still require the existing explicit connection checks and re-enablement; the validity indicator does not replace those checks.

To continue the separate Home display investigation, keep Home visible and run `sudo python3 -B scripts/compare-homekit-reporting.py --experiment events` from the checkout. Follow its one-cycle prompt and share the output. The subscribers and deferred experiments are also prepared; select them explicitly as described in [homekit-reporting.md](homekit-reporting.md#next-experiments--049). Keep the independent capture script stopped during these trials. For a new installation follow [owner-test.md](owner-test.md), keeping the garage disabled until the old services are stopped. Source validation, npm publication, host installation and physical acceptance are separate milestones.
