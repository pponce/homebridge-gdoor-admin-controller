# Node.js web admin status

## 0.4.24 ready for owner-test publication

The optional integrated server and the original non-controller pages are implemented. It is disabled by default. Configure the first web administrator in General → Web admin interface; manage subsequent accounts in web Settings. Existing garage settings, commissioning and HomeKit pairing are retained. The original Python controller and HTTP Webhooks adapter are not included; the existing Homebridge coordinator handles movement.

All five jobs in [CI run 37731476101](https://github.com/pponce/homebridge-gdoor-admin-controller/actions/runs/37731476101) pass on implementation af338c806b389e6824f89e6d9a7d0733d88b849a: Node 22/24 regression/exact package checks, actual Homebridge 2.0/2.4, custom-UI IPC, desktop Chromium/mobile WebKit original read and production save/recovery/PIN-restart flows, and existing configuration browser checks. The final release checkpoint changes documentation only. Ready for owner-run npm publication and first installation; source validation is not publication, installation or physical acceptance.

## Implemented

- Optional HTTPS listener, private backend certificate, existing nginx support, strict Host/Origin/CSRF checks, saved deCONZ connections, bounded requests and gateway identity binding. OFF creates no listener, certificate, SQLite history or collector. Port conflicts do not stop another service.
- Named Admin/Regular accounts, scrypt passwords, first-account setup, last-admin protection, account revisions and session invalidation. Web login is distinct from Homebridge UI authentication.
- Gateway inventory, users/PINs, grants/schedules, keypad protection, alarm settings, virtual keypad, activity, settings and diagnostics. Twelve original frontend assets retain pinned provenance; nine remain byte-for-byte and the application, Settings and Homebridge-flow adapters have explicit adapted hashes. A new help page explains integrated setup.
- Durable private transaction journal, policy snapshots/retention, SQLite history, read-only event collection, original permission projections, and direct existing-coordinator keypad/maintenance adapters. An unknown write remains held; recovery does not replay it.
- Confirmed Homebridge deCONZ alarm-PIN maintenance: authenticate to Homebridge UI in memory, stop only the deCONZ child bridge, verify stopped process, snapshot privately, perform the gateway PIN change once, update only mapped saved alarm PINs, start once, and verify before releasing maintenance. The web page/session stays open. Source fingerprints limit the private-cache dependency to the reviewed original alarm-PIN workflow. No installed source, Homebridge config or pairing identity is edited.

## Acceptance evidence

The production browser test creates the first administrator through the actual Homebridge setup panel and signs into the actual Node HTTPS/auth/backend. It covers name/PIN changes, alarm timing save, deliberate response loss and recovery without replay, preferences, web accounts, history, explicit child-bridge restart confirmation, current-page/session retention and hidden integration identities for Regular accounts. Only the gateway and host service boundary are synthetic; no household service or hardware is operated.

Seventeen focused Homebridge client/offline-file/maintenance tests additionally cover source/config changes, exact mapping, private backup modes, competing writes, grant protection, durable service intent and ambiguous stop/start handling. The earlier foundation/read/write milestones and their CI references remain recorded in status.md.

## Remaining limits and owner testing

- Actual host/nginx/gateway behavior and physical acceptance require the owner's first functional test; see web-admin-setup.md.
- The first alarm-PIN host adapter requires Linux, same-user writable cache files, a separate local deCONZ child bridge, local HTTP Homebridge UI, and reviewed homebridge-deconz 1.3.5/homebridge-lib 8.1.5 source fingerprints. Unsupported hosts fail before service or PIN mutation.
- Independent credential evidence for an unknown deCONZ PIN-write response is not ported from the standalone SQLite adapter. Such an outcome remains held and can need manual review. A missing stopped snapshot or a start that never occurred can also need local review. See web-admin-alarm-pin.md.
- The coordinator timers web panel is deferred; those settings remain in the Homebridge configuration UI.
- No automatic standalone retirement, live cutover or npm publication occurs during development.

## Preserved standalone build

All new work is in this repository. The reference admin remains at 45e26c1d586bdcfa22b3b3b486485ba78ee4db6e and garageDoorController at a47fa4db3a12e5239d447ee4c5213c59eeb81542, with standalone-preserved-2026-10-07 retained. Their source files and installed services remain unchanged. See standalone-preservation.md.
