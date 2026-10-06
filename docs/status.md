# Development status

2026-10-06: ready for initial supervised owner installation/testing. Physical acceptance remains outstanding. Follow [owner-test.md](owner-test.md), starting with the coordinator disabled while the old controller remains active.

## Validated source

- Coordinator: `295f995f8484095b9534054e0fc7f124467ef7f9`, package `0.4.0-dev.1`. [Passing release checks](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37528567117).
- Companion administrator: `c43a269646fd79b919cf5c99b0871efbfbe6550e`, package `0.5.0.dev1`. [Passing release checks](https://github.com/pponce/homebridge-deconzKeypadAlarm-admin/actions/runs/37527386237).
- Later documentation-only commits retain this tested implementation. Requirements: Homebridge 2 and Node 22/24; the standalone administrator additionally needs Python 3.10+ and same-host access to the loopback API.

## Implemented and checked

The commissioned runtime publishes a combined Garage Door and optional Lock, with Tailwind/deCONZ and supported Homebridge service adapters, generalized live inputs, relay stop/reverse and partial-travel estimates, durable journals, request deduplication, idle recovery/auto-bolting, profile review/apply/cancel, private credentials, virtual-keypad outcomes and durable maintenance. For the owner, HomeKit and virtual keypad use Tailwind; physical keypad/button use the separately configured Aqara opener relay. Startup, discovery and probes never actuate.

The modern custom settings screen has garage cards, guided Devices/Inputs/Behavior sections, device discovery, private connection keys, feedback questions, review-before-save and explicit checks/enablement. The companion administrator keeps its own URL and full generic interface and shares the profile editor and API.

Validation passed:

- 89 Node tests on Node 22 and 24, including live loopback WebSocket inputs, driver protocols, faults, restart holds and relay interruption.
- Actual Homebridge 2.0.0 child bridge: no startup writes, commissioning, both accessories and HAP open/close with the expected bolt sequence against synthetic hardware.
- Actual custom settings server IPC/API integration, plus Chromium desktop and WebKit mobile configuration flows, including plain-HTTP-compatible profile creation.
- Package contents check and 16 actual Node/Python cross-repository tests, including profile changes, commissioning, keypad delivery, coordinated movement, deduplication and maintenance.
- Companion administrator: 28 client/installation checks on Python 3.10/3.12, 162 retained application checks on Linux, and existing desktop/mobile plus Controller-page browser checks.

No npm publication, live host installation, household state transfer or physical acceptance has occurred. Remaining acceptance is on the owner's host: identities/wiring, travel and pulse timings, real HomeKit/keypad/button behavior, maintenance and rollback. Timers estimate travel; relay state is not physical bolt-position sensing. Native HomeKit pairing, unsupported generic devices and timer-only bolt feedback are outside this build. The original installation/source remains unchanged. Source reference: pponce/garageDoorController@7d4e0f04e4ef3631e721e571adb292cf11988e87.

## npm publication preparation

Version 0.4.0 removes the development-only publication block, declares public npm publication and includes a maintainer release script. Runtime, drivers, UI and API behavior are unchanged from the validated source above. The script packs reviewed tracked files, publishes once and verifies registry integrity; it can verify an already-published identical artifact after an interrupted connection. Publication itself remains pending the maintainer's authenticated terminal run. See [npm-release.md](npm-release.md).
