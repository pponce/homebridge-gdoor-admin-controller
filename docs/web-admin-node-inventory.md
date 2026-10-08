# Node.js web admin: initial port inventory

Approved product: homebridge-gdoor-admin-controller. One plugin, existing coordinator, optional Node.js web server, original full desktop/mobile interface.

## Pinned references
- Extracted administrator: pponce/homebridge-deconzKeypadAlarm-admin at 45e26c1d586bdcfa22b3b3b486485ba78ee4db6e.
- Original functional/UI reference: pponce/garageDoorController at a47fa4db3a12e5239d447ee4c5213c59eeb81542.
- Existing administrator docs/ux-parity.md is the acceptance inventory. Original notes/current-status.md confirms the old services stay stopped.
- This is an initial source inventory, not a claim that the port or full behavioral comparison is complete.

## Reuse and port boundaries
Reuse reviewed frontend assets from configurator/static: index.html, app.js, style.css, settings.js, keypad.js, homebridge-flow.js, branding icons and manifest. Inventory setup/welcome/install assets individually: standalone system installers are not suitable Homebridge lifecycle code.
Port configurator/server.py session/account/authorization and route dispatch to Node.js. Keep frontend route and response contracts where possible.
Port domain, schedules, keypad authorization, activity/history and durable transactions in modules, preserving behavior with fixtures. Do not import a second garage movement engine.
Adapt coordinator_admin/client.py and integration.py contracts to the existing authenticated coordinator API. Household endpoints and keys must never be embedded in browser assets or source.

## Route groups located in server.py
| Area | Existing routes / operations | Required behavior |
| --- | --- | --- |
| Sessions/accounts | login, session, logout, account/password, accounts | Admin/Regular roles, session invalidation, current-password rules; Regular cannot create accounts |
| Setup/gateways | setup, setup/probe, setup/connect, setup/local-gateways, setup/gateway, setup/application, setup/finish, gateways | Explicit configuration; supported discovery only |
| Inventory/editor | inventory, overview, editor, discover, alarm | Read versus discovery distinction; stale-result handling |
| Users/PINs | users/save, users/delete, users/rotate-pin | Stable identities, grants, enrollment ownership, credential privacy |
| Alarm/lockout | alarm/save, lockout, lockout/save, lockout/reset | Per-alarm policy, schedules, scope, shared uses and lockout |
| Virtual keypad | keypad, keypad/send | Sequential entry, fresh gateway authorization, no replay; coordinator owns garage action |
| History/activity | history, history/query, history/clear, history/retention, activity-options | Persistent collection while browser closed and scoped retention |
| Administration | administration, settings, debug, debug/control | Roles, branding, sanitized diagnostics |
| Recovery | transaction, recovery/credential, recovery/review, recovery/confirm | Durable transactions, revision conflicts, safe interrupted-operation recovery |
| Extensions | extension_request dispatch | Port Controller page via coordinator adapter; no old daemon lifecycle |

## Initial implementation sequence
1. Build a reviewed frontend file manifest and capture existing browser/API fixtures. Inventory all broker operations behind these routes, not only HTTP handlers.
2. Implement isolated Node.js server lifecycle plus sessions/accounts and exact static routing. Start only when explicitly configured, use Homebridge storage, close cleanly on shutdown. No external listener enabled by this inventory.
3. Port read-only views and contracts, then explicit mutations and persistence module by module.
4. Port virtual keypad and controller adapter without bypassing existing coordinator authorization or duplicating movement ownership.
5. Validate history, schedules, recovery and automatic backup retention (newest 20 eligible automatic snapshots, protected/held backups retained).
6. Run full desktop/mobile workflows, authorization failures and restart/recovery fixtures before claiming parity or offering live cutover.

## Open implementation decisions to resolve from source
Existing frontend is HTTPS and talks to a separate Python broker. Preserve its trust boundaries while mapping them to the plugin's Node.js modules; do not blindly copy systemd/sudo installers.
Explicitly determine TLS/reverse-proxy/session-cookie configuration and credential ownership before any LAN-accessible listener.
Port costly backup/history operations without blocking the movement event loop.
Fresh plugin setup is accepted; deletion of deCONZ gateway users/PINs or other Homebridge configuration is not part of this work.

## Status
Inventory begun after the 0.4.22 release work. No web server, account migration, listener, gateway mutation or device operation has been enabled.
