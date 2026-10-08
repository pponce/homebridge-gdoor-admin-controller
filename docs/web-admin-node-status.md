# Node.js web admin development status

## Optional product boundary
The integrated web interface must be optional and disabled by default. Enabling it will require an explicit owner choice after its setup and runtime are ready. No listener is connected to Homebridge startup in this milestone. The validated main-branch 0.4.23 UI release does not include this development work.

## Implemented foundations
- Named Admin/Regular accounts, scrypt password verification, current-password rules, last-admin protection, session expiry, revision checks and session invalidation.
- HTTPS-only server factory with Host/Origin/CSRF checks, private cookies, bounded request bodies and sanitized errors. Unsupported domain operations fail explicitly.
- Homebridge-private durable account storage using the existing PrivateStore. Trusted initialization refuses to replace existing, malformed or shared files. Serialized revision writes reject stale edits. This store is owned by the active coordinator under its existing ownership lock; it is not a cross-process database.
- Twelve original frontend assets copied byte-for-byte from the pinned extracted administrator: main page, application/settings/keypad/Homebridge-flow/demo scripts, stylesheet, manifest and four icons. docs/web-admin-assets.json records source Git blobs and SHA-256 hashes. A finite static-route map excludes account files, installers and arbitrary paths.

## Read-page backend milestone
- A bounded deCONZ adapter verifies gateway identity and enhanced alarm capabilities. Its default is read-only; constructing it makes no request. There are no automatic write retries, redirects or proxy routing.
- Inventory, users, alarm state/timing revisions, lockout status, global user/grant snapshots and the administration overview match outputs captured from the original Python source using synthetic data. Development-only fixture generation verifies all 48 Python source hashes against the pinned reference; the plugin never invokes Python.
- The original browser routes now dispatch through the authenticated backend with explicit gateway/alarm selection. Missing/unknown scope cannot fall back to another gateway. Admin/Regular projections protect owner identities and omit integration identities and private recovery details.
- Account disablement/role changes are serialized with authorized operations. Duplicate JSON keys and invalid UTF-8 are rejected before dispatch.
- Save/PIN/keypad/recovery operations still fail as unavailable. Setup, durable transaction status and history remain injected ports; their production implementations and startup integration are unfinished.
- The existing controller remains responsible for movement. The owner requested the non-controller pages first; a controller timers/settings panel is a later phase using the existing API.

## Validation
The original nine foundation tests passed on Node 22/24 in CI run 37716390646. The expanded sixteen tests passed locally on Node 24.19.0. Added checks cover durable restart login, private file modes, duplicate setup, queued revision conflicts, immutable pending writes, corrupted/shared/symlink storage rejection, exact frontend provenance and initial page resource closure.
All sixteen tests and exact package verification passed on Node 22 and 24 in [CI run 37718040599](https://github.com/pponce/homebridge-gdoor-admin-controller/actions/runs/37718040599), implementation 32c57a86687d8b3d3e797cba6ad542f745a93902. Browser parity and a deployed HTTPS setup were still pending at that foundation milestone.

The current 37 focused tests pass locally on Node 24.19.0, including the captured Python contracts, explicit scope, owner/hidden-user projection, authenticated dispatch, account-disable races, and gateway transport bounds. A new browser check runs the original assets against real Node HTTPS/auth/dispatch with synthetic gateway, setup and transaction ports. It covers read pages and account visibility on desktop Chromium/mobile WebKit. Node 22/24 and browser CI for this milestone are pending; full write parity and deployed setup remain pending.

## Still required before an owner test install
Homebridge enable/disable settings and lifecycle wiring; first-admin setup; certificate configuration; the Homebridge-specific replacement for standalone installation help; full original-frontend browser flows; deCONZ setup and protected user/PIN/alarm/lockout writes; coordinator keypad routing; persistent activity/history; backup and interruption recovery.
Standalone setup/welcome/install screens have not been copied blindly because their host-service lifecycle differs. Core frontend assets remain unchanged while their backend contracts are ported.
No public signup endpoint, device mutation, service operation, npm publication or live cutover is included.

## Standalone remains available
See standalone-preservation.md. The original Python controller/web interface remains the non-Homebridge option, preserved at its verified source baseline. Its source files and installed services were not modified by the Node port.

