# Changelog

## 0.4.37

- Update Homebridge alarm PINs through the official Configuration API without restarting Homebridge or editing its accessory files. Let the plugin save on its normal schedule.
- Offer optional current-log clearing after a successful update; report cleanup failures without reopening PIN recovery.
- Preserve recovery for previously pending offline updates.

User-facing changes for `homebridge-gdoor-admin-controller`. GitHub releases use matching `vVERSION` tags. Development history and validation receipts are in [developer documentation](docs/developer/README.md).

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
