# Development status

2026-10-06: operational integration and modern custom Homebridge configuration UI implemented; joint release checks are in progress.

Implemented: commissioned runtime, combined Garage Door and optional Lock accessories, Tailwind/deCONZ and selected Homebridge service adapters, generalized live inputs, relay stop/reverse and partial-travel estimates, durable journals and command deduplication, idle recovery/auto-bolting, shared profile review/apply/cancel, private credentials, virtual-keypad outcomes and durable maintenance. HomeKit and virtual keypad use Tailwind for the owner; physical keypad/button use the separately configured opener relay. No startup/discovery/probe actuation.

The custom configuration screen has garage cards, guided Devices/Inputs/Behavior sections, device discovery, private connection keys, feedback questions, review-before-save and explicit checks/enablement. The companion administrator remains a separate full application and uses the same profile editor and API.

Local validation: 87 Node tests and 16 actual Node/Python cross-repository checks passed. A real loopback WebSocket test verifies physical button/keypad → relay and virtual keypad → Tailwind. The retained admin suite passed 160 with two Unix-socket checks skipped in this workspace; Linux CI covers them. Additional browser and actual Homebridge HAP-operation checks are being run before the owner test handoff.

No npm publication, live host installation, physical movement acceptance or change to the original installation has occurred. Do not treat this in-progress checkpoint as a cutover instruction. Source reference remains pponce/garageDoorController@7d4e0f04e4ef3631e721e571adb292cf11988e87. Remaining work: pass release CI, review installation/rollback instructions, then supervised owner tests. Native HomeKit pairing, unsupported generic devices and timer-only bolt feedback are outside this test build.
