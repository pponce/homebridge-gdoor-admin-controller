# 0.4.25 owner update

Includes automatic LAN web setup, live controller-default and physical-input timing edits, clearer Homebridge readiness failures, and the documented requirement for two separate child bridges. Runtime implementation `fef22deac7cc758455af5c1b9ad647c87d2a8799` passed all five jobs in [CI run 37796837930](https://github.com/pponce/homebridge-gdoor-admin-controller/actions/runs/37796837930). Release 0.4.25 also adds a visually separated Change your password section that names the currently signed-in web account. Existing controller profiles, web accounts, proxy settings and HomeKit pairing are retained.


The final 0.4.25 package source `fafcb622c51219648ae7d36ab2e7576d3d7f0e8b`, including the signed-in account password section, passed all five jobs in [CI run 37804859346](https://github.com/pponce/homebridge-gdoor-admin-controller/actions/runs/37804859346). The owner update script pins that source, verifies the actual registry download, and only then runs Homebridge stop → pinned install → start. Simulated command checks confirm successful ordering, no service stop after a download failure, no restart after an install failure, and preservation of local edits. The subsequent updater/documentation commit does not change the pinned npm artifact.

This owner-test release is on `web-admin-lan-controller-timings` (draft PR #1). Use the exact reviewed 0.4.25 release commit; pulling main alone does not include these changes. Fetch over SSH into the existing clean checkout and check out that pinned revision. Do not overwrite local edits.

Run the publisher from an interactive terminal as the normal user with stdin and stdout attached to `/dev/tty`. It prints npm's browser-approval URL without opening a browser and allows up to ten minutes for registry verification. It retains the exact archive, source revision and publication receipt in `.release/0.4.25/` and checks an existing publication before trying to publish. Retry with the same source revision and saved artifact after an interrupted publication.

After publication verification, download the exact package through npm into `.release/0.4.25/download/` and compare its SHA-512 integrity to the saved release archive before stopping Homebridge. Install only in this order: `sudo hb-service stop`, `sudo hb-service add homebridge-gdoor-admin-controller@0.4.25`, `sudo hb-service start`. Stop on install failure and leave Homebridge stopped. No uninstall, removal from Apple Home, re-pairing or controller reconfiguration is needed for this package update. Keep the old standalone services stopped.

The owner update script performs publication and installation only when run on the Homebridge host. No installed service or npm package was changed while preparing this source release.

# 0.4.24 optional web admin publication

All five acceptance jobs pass in CI run 37731476101 at af338c806b389e6824f89e6d9a7d0733d88b849a. Use the current status.md release checkpoint; the older commands below are historical. This release retains controller configuration/private data and HomeKit pairing. It adds the optional web administrator, disabled until explicitly configured in General. See web-admin-setup.md before enabling it.

Use a clean SSH checkout at ~/devProjects/homebridge-gdoor-admin-controller on the reviewed main commit. Install runtime dependencies with `npm install --ignore-scripts --no-audit --no-fund --package-lock=false`, then run the existing publisher as your normal user:

```sh
bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA </dev/tty >/dev/tty
```

Both npm input and output must remain attached to the terminal. npm's web-OTP handler rejects a non-terminal invocation before entering its browser approval flow. The publisher passes `--browser=false`, so the approval URL is printed for manual copying and npm waits for the result; no browser is launched. Do not pipe/capture its output or put the publisher inside a shell heredoc without the explicit terminal redirection. If there is no terminal, run this owner publication step from an interactive terminal rather than attempting token extraction from the error's done URL.

After the exact npm archive is verified, install in this order: `sudo hb-service stop`, `sudo hb-service add homebridge-gdoor-admin-controller@0.4.24`, `sudo hb-service start`. The combined shell block must stop on an installation failure and leave Homebridge stopped. Do not run the old standalone movement service alongside the active coordinator. Publication is an owner-run action, separate from source validation.

# 0.4.22 ready for maintainer publication

All five jobs passed in [CI run 37715458224](https://github.com/pponce/homebridge-gdoor-admin-controller/actions/runs/37715458224) on implementation `0ca0463c5900d19d959415eb04bef117b35df216`: 172 tests on Node 22/24, actual Homebridge 2.0/2.4, custom UI IPC and desktop Chromium/mobile WebKit. Browser coverage includes direct local bridge/accessory selection without crypto.randomUUID, connection-owned key replacement staged until save, automatic unused-key deletion, Undo/Discard/native-save failure protection, compact refresh, device selection/addition/removal/draft retention and overflow. The earlier save/color/order improvements remain included. Screenshots are CI artifacts; this is not a claim of live owner-host acceptance.

Update the existing `homebridge-gdoor-admin-controller` package to 0.4.22. Preserve configuration, private data and HomeKit pairing: no uninstall, bridge removal or storage archive is required. Publish the exact reviewed checkout with `bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA`, verify the downloadable npm artifact, then `sudo hb-service stop`, `sudo hb-service add homebridge-gdoor-admin-controller@0.4.22`, `sudo hb-service start`. Leave Homebridge stopped on install failure. Publication and owner installation remain unconfirmed until performed.

The separate Node.js web-admin effort has begun on `web-admin-node-port` with pinned references and a route/module inventory. It is not included in this UI release.

# Release 0.4.21: configuration UI refinements

Includes Manage connections beside the saved connection dropdown, Control source → saved connection → control type → device selection, Save configuration within Controls without closing the UI, Add another control wording, and red Not configured / amber Disabled / green Enabled garage cards and General overview. No controller movement or protocol changes. Existing configuration and pairing are retained on update from 0.4.20; do not archive/reset plugin data or remove its bridge.

All five CI jobs passed on implementation `1844809381e2b0a87e5c186120dadafbceb063a1` in [run 37712640939](https://github.com/pponce/homebridge-gdoor-admin-controller/actions/runs/37712640939): Node 22/24, Homebridge 2.0/2.4, custom UI IPC and desktop/mobile browser checks. This release preparation changes the version and documentation only. npm publication, installation and owner-host acceptance are separate and unconfirmed.

Publish with `bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA` from the clean reviewed checkout. After verifying the npm archive, use stop → add `homebridge-gdoor-admin-controller@0.4.21` → start. Leave Homebridge stopped on install failure. Keep saved configuration and plugin data intact.

# Current release: 0.4.20 package rename

Package: `homebridge-gdoor-admin-controller@0.4.20`. Checkout: `~/devProjects/homebridge-gdoor-admin-controller`. This is a name-only release; see [transition instructions](package-rename.md). Older release notes and commands below are historical and must not be used to install the renamed package. Publication still uses `bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA` from an interactive terminal.

# Release 0.4.19

Devices now contains opener connections, bolt and opener relays. Controls replaces Inputs, with explanatory text and per-control selection. Device movement behavior applies to linked toggle controls, while keypad PIN behavior remains separate. Saved divergent control behavior is preserved until explicitly reconciled.

Optional physical keypad stop/reverse on a compatible pulse relay. Either PIN outcome may interrupt movement started by that keypad; only a correct PIN opens a closed door. From open or its partial stop, either outcome closes. Default behavior remains Ignore new presses. Unavailable on the garage opener connection, including Tailwind, and on the virtual keypad. All five coordinator CI jobs passed in run 37703569747 (172 unit tests, Homebridge 2.0/2.4, UI IPC and desktop/mobile browser flows). Administrator compatibility is on main at 45e26c1d586bdcfa22b3b3b486485ba78ee4db6e with all three CI jobs passing; update an installed administrator before editing opted-in keypad profiles there. Source is ready for publication; physical acceptance remains outstanding.

# Release 0.4.18

Compact input selection with one detail panel, preserving draft edits and selecting newly added controls. Motor route labels now identify Garage opener (Tailwind/Homebridge) or Relay: name. Runtime behavior is unchanged. All five CI jobs passed in run 37698946893, including desktop/mobile input selection, draft preservation and add/remove checks. Source is ready for publication; installation remains an owner step.

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
