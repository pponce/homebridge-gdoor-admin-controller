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

At completion of the pre-release validation above, npm publication, live host installation, household state transfer and physical acceptance had not occurred. The later owner-reported publication/installation is recorded below. Remaining acceptance is on the owner's host: identities/wiring, travel and pulse timings, real HomeKit/keypad/button behavior, maintenance and rollback. Timers estimate travel; relay state is not physical bolt-position sensing. Native HomeKit pairing, unsupported generic devices and timer-only bolt feedback are outside this build. The original installation/source remains unchanged. Source reference: pponce/garageDoorController@7d4e0f04e4ef3631e721e571adb292cf11988e87.

## npm publication preparation

Version 0.4.0 removes the development-only publication block, declares public npm publication and includes a maintainer release script. Coordination, drivers and UI behavior are unchanged from the validated source above; the API now reads its version label from package metadata. The script packs reviewed tracked files, publishes once and verifies registry integrity; it can verify an already-published identical artifact after an interrupted connection. Local release validation passed 90 tests and the 16 cross-repository checks. The owner subsequently completed publication and reported installation; see the setup feedback entry below. See [npm-release.md](npm-release.md).

## Initial owner setup feedback — 2026-10-06

The owner's npm output reported acceptance of 0.4.0; the short registry verification window expired while npm was processing it. The owner then reported successful installation with `sudo hb-service add homebridge-gdoorandbolt-coordinator`. Configuration is in progress; physical acceptance is not established.

Recorded [owner setup feedback](owner-setup-feedback.md): make **Add a garage door** prominent within the introductory panel, distinguish saved key names from accessory names, explain the Tailwind/deCONZ credentials, and clarify key saving versus configuration review. This is a documentation-only update; the installed UI is unchanged. No runtime tests are needed for these notes.

## Aqara T2 discovery fix — 0.4.1 preparation

During owner setup, the Aqara motor output was missing from discovery. The upstream deCONZ T2 DDF declares its relay outputs as **On/Off switch**, while 0.4.0 allowed only **On/Off light** and **On/Off output**. Version 0.4.1 adds the missing type consistently in discovery, configuration validation, the schema and the output driver. Identity, reachability, explicit enablement and bounded pulse cleanup checks remain in place. The shared administrator editor/API need no change for this additional output type. Household identities and keys are excluded from this change.

Regression coverage includes configuration and a single ON/OFF pulse for a synthetic T2, read-only protection and identity mismatch rejection; actual UI server discovery; and selecting the motor in desktop/mobile browser checks. Local validation passed all 91 Node tests and 16 Node/Python integration checks; the delayed npm availability regression also passes. [CI run 37538281557](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37538281557) passed on implementation revision `e05edbf3241fab3f9a3c07c5f25f08d012531c88`: Node 22/24, actual Homebridge child bridge, actual custom UI server discovery, and desktop/mobile selection. Subsequent notes-only changes do not alter that implementation. This is a prepared source update, not a published/installed npm update or physical acceptance. The release script now waits up to ten minutes for npm availability and prints authentication URLs without launching a browser. The remaining setup UX feedback is still a separate backlog.

References: [upstream T2 DDF](https://github.com/dresden-elektronik/deconz-rest-plugin/blob/master/devices/xiaomi/xiaomi_dcm-k01_t2_dual_relay.json) and [type constants](https://github.com/dresden-elektronik/deconz-rest-plugin/blob/master/devices/generic/constants.json).
