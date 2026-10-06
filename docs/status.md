# Development status

2026-10-06: generalized input assignments and motor paths added.

The owner confirmed retaining the Aqara motor relay for physical-keypad and indoor-button operation. HomeKit and virtual keypad continue through Tailwind. The model separates input events from the assembly worker and motor path, allowing supported deCONZ or Homebridge buttons/switches without brand-specific routing. Tailwind remains the door-state source. See input-routing.md for the exact configuration and implementation boundary.

Implemented with synthetic devices: input/profile validation, overlap and declared output-ownership checks, fresh one-use event admission, shared-engine route selection, per-input timing, generic direct-deCONZ motor relay, one ON attempt with bounded verified OFF cleanup, and sanitized authenticated routing inventory. Stop/reverse is a declared optional policy; the prototype does not execute it yet.

The Homebridge platform still supports only authenticated inventory and explicit read-only Tailwind/deCONZ probes. It does not instantiate the movement engine, subscribe physical inputs, publish accessories or enable actuation. The companion admin displays actual configured input/motor-path assignments alongside explicit connection checks. Neither configuration nor metadata enables hardware commands.

Local validation: 71 Node tests passed on Node 24; 26 companion client/adapter tests and 8 cross-repository tests passed on Python 3.12. The cross-repository checks use the actual API and direct drivers against loopback emulators. Remote CI for this checkpoint is pending publication. The preceding checkpoint passed Node 22/24 and actual Homebridge 2.0.0 child-bridge loading with temporary storage and fake hardware: [previous run](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37508999424). This is not physical movement acceptance.

Source reference: pponce/garageDoorController at `7d4e0f04e4ef3631e721e571adb292cf11988e87`. The current source repository and host installation remain unchanged; no household mappings or credentials were copied.

**Not ready for physical owner testing or migration.** Remaining: live deCONZ/Homebridge input adapters and enrollment, supported Homebridge accessory transport, optional relay interruption/partial-travel behavior, automatic idle recovery/locking, stable combined/Lock accessories, commissioning/recovery, revision-checked settings, request deduplication, keypad/maintenance APIs and the new admin installer. Timed bolt mode is not implemented. No npm publication or host installation occurred. The routing decision is resolved; no owner clarification is outstanding.
