# Changelog

User-facing changes for `homebridge-gdoor-admin-controller`. GitHub releases use matching `vVERSION` tags. Development history and validation receipts are in [developer documentation](docs/developer/README.md).

## 0.4.52 — 2026-10-15

- Make **Override shared settling before opening** and **Override shared settling before closing** opt-in checkboxes in both settings interfaces. Unchecked uses **Bolt extension/retraction settling (seconds)**; checked enables the corresponding individual wait. New garages leave both unchecked.
- Explain that each override replaces the shared wait for bolt retraction before garage movement. Waits are never added together; bolt extension after closure still uses the shared setting.
- Preserve existing saved timing choices, including explicit zero overrides, and keep inherited fields disabled while displaying the shared value. Pulse duration and relay release handling are unchanged.

## 0.4.51 — 2026-10-15

- Use **Bolt extension/retraction settling** for both directions with every bolt setup: one relay, separate maintained/momentary relays, and Homebridge lock/switch devices. Measure the wait from successful command acknowledgement; required feedback and settling run together.
- Let garage movement begin after retraction settling while a separate momentary pulse continues. Keep the worker and unfinished-operation journal owned until OFF is checked. Opposite bolt commands wait for release; release failures hold control and invalidate the estimate.
- Add **Use shared settling** for the opening and closing retraction waits. New garages inherit it; existing numeric waits, including zero, remain explicit overrides. Per-control overrides replace the selected default. No waits are added twice.
- Continue labeling momentary position as estimated, now from the last acknowledged command. Restart clears it. Timing saves preserve approved setup and do not operate devices.

## 0.4.50 — 2026-10-15

- Keep an approved controller enabled and its HomeKit tiles available when changing only the separate bolt's pulse length, including 0.2 → 0.1 → 0.2 seconds. Save while idle; no setup recheck or Homebridge restart is needed.
- Continue requiring setup review for changed relay selections, connections, single/two-relay setup, momentary/maintained operation or bolt-control mode. Preserve disabled controllers, missing approvals and fault holds.
- Keep the stored approval format unchanged. If an earlier save already removed approval, complete the existing setup review once; pulse tuning then preserves it. Restart still leaves momentary bolt position Unknown until the next completed command.

## 0.4.49 — 2026-10-15

- Add **Bolt relay setup** after the deCONZ connection: keep the existing single relay, or select separate lock and unlock relays.
- Separate outputs support maintained ON or **Momentary relay outputs**, with a configurable pulse length defaulting to **0.2 seconds**. Release the opposite output before changing direction; verify pulse release and never retry an uncertain ON.
- Automatically check and require **Show a separate bolt Lock tile** for two-relay setups. One coordinated HomeKit Lock tile controls both outputs; the garage door keeps its own tile.
- Label momentary bolt position as an estimate from the last completed pulse. Restart leaves it unknown; a fresh door operation requests retraction before the motor when needed. Interrupted or failed two-output operations require a read-only check after physical review.
- Keep existing single-relay profiles and approval hashes unchanged. Both separate outputs remain reserved when bolt control is temporarily disabled. Changes to relay mode, mapping or pulse length require setup review.

## 0.4.48 — 2026-10-15

- Add **Bolt control enabled** per garage, on by default. Turn it off for door-only operation while retaining the saved bolt mapping, timings and tile preference.
- Skip all disabled-bolt reads, writes, retraction/extension delays and automatic bolting. Keep door feedback, obstruction checks, motor routing, button/keypad behavior and restart protections active.
- Show **Bolt disabled** and hide the separate Lock tile without changing the garage tile’s identity. Disable unused bolt timing fields in both settings interfaces while preserving their values.
- Require setup review after switching modes. Secure the physical bolt retracted before enabling door-only operation; check the relay mapping and identity when turning bolt control back on.

## 0.4.47 — 2026-10-11

- Move Controller troubleshooting below the lockout settings, controller defaults, device timing overrides and motor relay pulses. It starts collapsed and can be expanded or collapsed; live status refreshes keep the chosen state.

## 0.4.46 — 2026-10-11

- Make the virtual keypad part of enabled web administration; remove its separate garage Controls setup. One garage is selected automatically, and multiple garages can be selected on the web keypad.
- Allow web administration without a garage. The Controller page shows where to add one in Homebridge, with no garage actions available until a garage is configured.
- Preserve existing garage setup approval and the primary opener route, PIN verification, request freshness and duplicate suppression.
- Verify the installed version from Homebridge’s managed package so the owner updater accepts normal APT installation output and restarts after a confirmed install.

## 0.4.45 — 2026-10-11

- Add an optional Tailwind fully-open sensor on a different door input. Its Door control may remain disabled. The original input still controls the opener and confirms closed.
- Add named Homebridge contact sensors under Devices. Show Tailwind and ratgdo endpoint feedback automatically in the device list.
- Select closed and open confirmation sources independently in Behavior. A configured Tailwind open sensor becomes the default; choose another configured contact sensor or timed opening instead, while keeping the extra input configured.
- Normal opening, relay reversals, bolting, idle observation and restart recovery use the selected endpoint readings. Opening estimates and per-control opening times are unused during sensor confirmation.
- Reject duplicate sensor/opener inputs, missing or invalid selected readings, and simultaneous selected endpoint engagement. Unused sensors are not required for movement. Keep existing single-sensor timed behavior unchanged.

## 0.4.44 — 2026-10-10

- Fix Homebridge configuration saves incorrectly removing setup approval when the new opener-lockout permission fields are first added. Permission-only changes now retain approved setup through save and restart, keeping device monitoring and HomeKit status available.
- Preserve disabled controllers and setup review for changed device mappings or other unapproved behavior. The existing stored approval format is unchanged; this update does not automatically approve a setup whose approval was already removed.
- If affected by 0.4.43, use **Garage doors → Review setup → Check connections → Approve updated setup** in the Homebridge plugin settings after reviewing the physical setup. Approval requires the door closed and the opener unblocked. See [recovery instructions](docs/garage-recovery.md).

## 0.4.43 — 2026-10-10

- Add two-level “Allow operation during opener lockout” permissions for relay devices and physical buttons/keypads, in plugin configuration and the web Controller page. Both must allow the operation; existing safety holds remain. Missing settings default off on upgrade too; explicit choices and unrelated settings are preserved. The implicit 0.4.42 bypass now requires enabling both permissions.
- Add experimental, hardware-untested **homekit-ratgdo firmware** support using its local HTTP API, explicit endpoint/direction/obstruction feedback, pinned MAC identity and optional Digest authentication. ESPHome/MQTT firmware are not covered. Unknown/stopped position, remote lock and obstruction remain held; no command retry, automatic fallback or remote-unlock command.
- Distinguish unsupported lockout reporting from a confirmed clear flag. Tailwind restart and lockout HomeKit tiles remain Tailwind-only. See [ratgdo limitations](docs/ratgdo.md) and [permission/recovery rules](docs/garage-recovery.md).

## 0.4.42 — 2026-10-10

- Expand Controller troubleshooting with live door/bolt feedback, independent Tailwind flags, actual committed HomeKit values, freshness, input eligibility, motor routes, active holds and recovery state.
- Allow configured physical button/keypad pulse routes through Tailwind lockout alone. Keep disabled, obstruction, stale-input, uncertain-direction, bolt, identity, storage and restart safeguards; HomeKit/virtual keypad stay on Tailwind. Stable closed feedback permits an explicit physical recovery from a movement/lockout fault only.
- Report inferred obstruction after a movement timeout or unexpected reversal (or lockout during movement). With fresh not-closed feedback, publish Open/Open plus obstruction as a display-only fallback; internal position remains uncertain and control holds remain. Stable closed feedback clears the inference and publishes Closed even if a separate fault or lockout remains.
- Never infer an infrared beam signal or clear Tailwind lockout from a pulse acknowledgement. Status observation remains read-only. Actual Apple Home rendering and physical acceptance require owner testing.

## 0.4.41 — 2026-10-10

- Add Controller troubleshooting with live Tailwind lockout status, Restart Tailwind and a read-only Check state now button.
- Offer optional Tailwind Lockout contact and momentary Restart Tailwind accessories in HomeKit.
- Continue read-only observation after faults and restore confirmed Closed status independently of command permission. Resolve failed-close timeouts only when stable closed feedback supports recovery, preserving unrelated faults and manual unlock preferences.
- Never replay a failed movement or automatically reset Tailwind lockout. Uncertain position after timeout retains its existing HomeKit presentation.

## 0.4.40 — 2026-10-10

- Fix the combined garage tile retaining an Open target after the door is closed using an OEM remote or another independent control. External closure now reports the matching Closed target and completes normal HomeKit notifications.
- Preserve automatic bolting, manual unlock overrides and existing keypad, indoor button and HomeKit control routes without sending an extra motor command.

## 0.4.39 — 2026-10-09

- Remove the extra PIN confirmation checkbox. Clicking Update PIN confirms the requested change.

## 0.4.38 — 2026-10-09

- Authorize PIN changes with the existing web-admin administrator session; request Homebridge login only when clearing logs, with an explicit explanation.
- Verify availability through official discovery and live PIN API reads without requiring Homebridge UI process status.
- Show safe preflight failure details and make clear when no PIN change started.
- Hide the Homebridge selection checkbox for the assigned user while preserving PIN synchronization and blank-field behavior.

## 0.4.37 — 2026-10-09

- Update Homebridge alarm PINs through the official Configuration API without restarting Homebridge or editing its accessory files. Let the plugin save on its normal schedule.
- Offer optional current-log clearing after a successful update; report cleanup failures without reopening PIN recovery.
- Preserve recovery for previously pending offline updates.


## 0.4.36 — 2026-10-09

### Improved

- Homebridge PIN synchronization accepts different package versions when the reviewed source fingerprints still match. Package identity, saved-data validation, private backup and restart verification remain required.
- Clarify that the private Homebridge backup does not automatically roll back a deCONZ PIN change.

## 0.4.35 — 2026-10-09

### Fixed

- After a Homebridge restart, allow up to 30 seconds for the deCONZ device API to become reachable using read-only inventory checks. Never repeat the PIN write or restart command.
- Report device API unavailability, invalid responses and readiness timeouts explicitly instead of a generic internal error. Identity, mapping and PIN verification remain required.
- Includes the 0.4.34 user editor layout and conditional PIN guidance.

## 0.4.34 — 2026-10-09

### Improved

- Move “Use for homebridge” below the gateway enabled checkbox.
- Show PIN guidance between the user name and PIN fields, updating immediately with the Homebridge checkbox. Show the current Homebridge user only in the selected guidance.

## 0.4.33 — 2026-10-08

### Improved

- Interrupted updates now identify the component and phase that failed: pause, backup, gateway write/readback, verification, service restoration or completion.
- Report additional fixed device/maintenance error codes and distinguish internal type errors from file-access and storage failures.
- Include a restricted source filename and line when available. Raw exceptions, stack traces, host paths, PINs and credentials are not exposed.

This is a diagnostic update. PIN synchronization, recovery, restart and authentication behavior are unchanged. It does not reconstruct details missing from older failure records.

## 0.4.32 — 2026-10-08

### Fixed

- Homebridge start/stop requests now send a valid empty JSON object. An empty body with a JSON content type can be rejected by Homebridge UI before the service command runs.
- An interrupted PIN update that stopped before writing can now be cancelled with **Cancel PIN change and restore service**. The existing PIN stores and user association stay untouched; a stopped deCONZ child bridge is started and checked before the controller is released.
- Recovery no longer requires a nonexistent PIN backup when the durable record proves no PIN write was attempted. Uncertain or attempted writes still require outcome verification and are never replayed.
- Keep the pending-update banner until integration completion succeeds. A failed completion remains recoverable.
- Check private storage before stopping the child bridge and retain a fixed, non-secret failure reason for future interruptions.

### Upgrading

Keep any pending update intact. After installing, refresh Users, open **Continue Homebridge update**, authorize with your Homebridge administrator account, then choose **Cancel PIN change and restore service** when offered. When it finishes without applying the change, you can begin setup again. If a check still fails, keep the saved operation and use the displayed diagnostic; do not delete its files.

## 0.4.31 — 2026-10-08

### Fixed

- Show the failed recovery check after successful Homebridge sign-in instead of leaving users in a repeated login loop. Diagnostic reasons omit credentials and host paths.
- Open the pending Homebridge update directly when another Save encounters it.
- Simplify Continue and Refresh status buttons, remove internal backup narration, and clarify the closed-door/locked-bolt confirmation.

Existing pending updates are preserved. This release diagnoses blocked recovery; it does not cancel transactions or bypass verification.

## 0.4.30 — 2026-10-08

### Fixed

- Preserve the original Homebridge PIN setup error when the saved operation still belongs to an earlier change. Repeated status checks retain that error and never resend the PIN or restart request.
- Do not report an older completed Homebridge operation as success for a new request.

Includes the clearer existing-PIN instructions from 0.4.29. This fixes error reporting; the cause of the owner’s setup failure is not yet established.

## 0.4.29 — 2026-10-08

### Improved

- Clarified Homebridge user setup: reuse the existing PIN by entering it in the PIN and Repeat PIN fields above, select the alarms, and click Save changes.
- Explained that separate access saves are needed only when name or access settings have also changed. Removed advance narration about the guided update.
- Added a direct interactive demo link near the top of the README.

This release changes instructions only; PIN synchronization, restart confirmation, permissions, and controller behavior are unchanged.

## 0.4.28 — 2026-10-08

### Improved

- Renamed the Controller page selector to **Garage Door** and made it compact while retaining its fit on small screens.
- Clarified that Homebridge PIN-user eligibility uses saved permissions: save Owner/access changes with the PIN fields blank before selecting a user for Homebridge.
- Rewrote the README around the plugin's purpose, requirements, installation through the Homebridge UI or `hb-service`, first setup, and web administration. Moved the earlier development narrative into developer documentation.
- Documented the current custom deCONZ requirement and pending upstream PR #8661. The tested physical keypad is Xfinity/Comcast URC4450BC0-X-R; other compatible keypads remain untested.

- Added specific Homebridge setup diagnostics identifying the checked file and why it was rejected, without exposing host paths or file contents. Reviewed plugin/library source files now accept group-write permission when the group is the Homebridge service group, including normal 664 installs. Trusted ownership, source verification, and rejection of world-write permissions remain; configuration and private PIN-cache checks stay strict.

### Added

- A static interactive demo in `web/demo`, suitable for hosting at a site root or subdirectory. It uses fictional data only and includes simulated controller timing edits. It has no hardware connection or live-mode switch.
- Xfinity keypad observations and both supplied manual scans, distinguishing confirmed behavior from the unproven extra-digit-after-success hypothesis.
- A friendly README disclaimer asking users to test every configured function, including after updates.
- This packaged changelog and matching GitHub release notes.

### Upgrading

Update the existing plugin normally; keep its configuration, private data, and HomeKit pairing. This release does not change motor commands, restart recovery, or deCONZ lockout counting. The earlier report of extra counted keypad failures remains unresolved; it is not claimed fixed here.

Both this plugin and `homebridge-deconz` must run in **separate child bridges**. The web interface requires Node 22.13+ in the 22 series, or Node 24. deCONZ user/PIN/keypad administration currently requires the custom alarm-user build; upstream acceptance is still TBD.

When upgrading from before 0.4.27, the private profile store migrates to schema 2. Older releases cannot read that store. Do not manually remove schema or enablement fields to downgrade; review [restart recovery](docs/restart-recovery.md) first.

## 0.4.27

- Separated the saved **Enabled** choice from current readiness, faults, and device availability.
- Preserved configured enablement through Homebridge and child-bridge restarts. Startup reads fresh device state, archives previous faults, and does not replay movement or old timers.
- Added separate health status and **Check again** recovery to both interfaces.
- Preserved setup approval for names and validated timing edits. Hardware or control-policy changes still require review.
- Migrated the private profile store to schema 2, retaining existing HomeKit pairings.

## 0.4.26

- Improved recovery after child-bridge and Homebridge restarts, including retrying unavailable startup dependencies and retaining useful fault reasons.
- Reconciled interrupted movement with fresh feedback without automatically retrying actuator commands.

## 0.4.25

- Added automatic LAN web setup with a detected IP address and an **Open web admin** link.
- Added live Controller defaults, device timing overrides, and motor relay pulse editing without restarting Homebridge.
- Explained Homebridge readiness failures and the separate-child-bridge requirement.
- Visually separated changing the signed-in account's password from adding web accounts.

## 0.4.24

- Added the optional integrated HTTPS web administrator for deCONZ users, PINs, access grants, schedules, protection, alarms, activity, and web accounts.
- Added confirmed Homebridge alarm-PIN synchronization through a separate deCONZ child bridge on supported hosts.

Earlier development and owner-test notes are preserved in [the developer release archive](docs/developer/npm-release-history.md).
