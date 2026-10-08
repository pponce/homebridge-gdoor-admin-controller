# Combined admin and controller: approved direction

Owner decision: 2026-10-07 (America/Los_Angeles).

## Product and implementation
- Target GitHub repository and npm package: homebridge-gdoor-admin-controller.
- One Homebridge plugin containing the existing movement coordinator and an optional authenticated web administration server.
- Implement the web backend in Node.js. No Python runtime dependency or system-level installer.
- Preserve the existing garageDoorController web interface's look, feel and functionality. Reuse reviewed frontend code/assets and the extracted admin project's coordinator integration and parity inventory.
- This direction supersedes the separate standalone-admin delivery plan. The reference installations and repositories remain unchanged during development.

## Responsibilities
- Devices operate or report one physical component.
- Controls request coordinated garage/bolt activity.
- The existing coordinator remains the sole movement authority; web operations use its authenticated management interface.
- Homebridge configuration handles plugin setup. The separate web URL retains Admin and Regular user experiences and its own authentication.
- Homebridge restart also interrupts the bundled web service; shutdown must release listeners and ongoing work cleanly.

## Required parity
Inventory every original page and backend operation before porting: application accounts and roles, users/PINs, alarm grants, enrollment ownership, keypad scopes, schedules and lockouts, virtual keypad, activity/history, discovery, settings/branding, backups and maintenance.
Preserve the existing newest-20 eligible automatic-backup policy and protected backups.
Port backend operations incrementally against synthetic contract/integration tests; reuse desktop/mobile UI parity coverage. Preserve refresh navigation and accessibility.
Keep credentials, household configuration, logs and private history out of source.
The web service must enforce authentication, authorization, request-origin/CSRF protections, sanitized errors and revision conflict handling.
Slow administration operations must not block movement coordination. Unsupported operations fail explicitly.

## Rename and migration gates
1. Rename the existing GitHub repository through repository Settings (the current connector has no rename operation); do not create a replacement repository.
2. Check npm name availability and publish under the new package name using the owner's manual browser-approval workflow. Availability is not yet established.
3. Update package metadata, runtime plugin registration, accessory registration, UI/release tooling and current documentation together.
4. Retain GDoorAndBoltCoordinator platform alias, gdoorandbolt-coordinator storage directory, persistent instance ID, profile IDs and accessory UUID derivation. Audit plugin association and child-bridge configuration explicitly; unchanged UUIDs alone do not establish a safe migration.
5. Verify an actual Homebridge upgrade fixture with existing cached accessories/configuration and child-bridge identity. No unpairing, duplicate coordinator or loss of saved credentials/data.
6. Supply a pinned stop/migrate/install/start procedure after verification. Do not install old and new packages as concurrent coordinators.
7. Keep old npm releases intact; deprecation guidance can follow successful migration. Do not claim an npm package was renamed in place.

## Current state
The chosen name and Node.js approach are approved. This branch records that decision only.
Main remains the reviewed 0.4.19 release. No repository rename, npm publication, installed configuration change, web backend port or live migration has occurred.
