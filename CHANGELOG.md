# Changelog

User-facing changes for `homebridge-gdoor-admin-controller`. GitHub releases use matching `vVERSION` tags. Development history and validation receipts are in [developer documentation](docs/developer/README.md).

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
