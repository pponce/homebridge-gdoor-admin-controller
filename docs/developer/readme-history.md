# Developer archive: earlier README

Historical development and owner-test notes, preserved on 2026-10-08. Commands and release-status statements below describe earlier work; use the current repository README for installation.

---

# Garage Door Admin Controller

A Homebridge platform for coordinating **one garage door and a separate bolt/lock per configured controller**. Multiple doors are supported by separate controller definitions. Multiple input profiles for the same physical door must share its coordinator.

**Status: correcting issues found in initial owner testing.** The runtime, combined Garage Door and optional Lock accessories, generalized physical inputs, standalone-admin API and custom Homebridge settings UI are connected. Physical testing has exposed status and input failures; full original-controller parity is not established. New garages stay disabled until explicitly checked and enabled. See the [installation and test guide](../owner-test.md), [validated revisions and limits](../status.md), and [old-to-new field-name mapping](../settings-mapping.md).

## Agreed product scope

- Opener: a garage accessory supplied by another Homebridge plugin, or Tailwind's local API.
- Bolt: a Lock, Switch, or Light accessory supplied by another Homebridge plugin, or direct deCONZ relay access.
- Always publish a combined Garage Door accessory.
- Optionally publish a separate Lock accessory for either bolt backend.
- Configure sensor-based or explicitly estimated travel feedback, independent opening/closing times, settling delays, and per-input behavior.
- Assign supported deCONZ or Homebridge buttons/switches to the primary opener or a named motor relay through the same coordinator. HomeKit and virtual keypad retain the primary opener route. See [input assignments](../input-routing.md) for implementation boundaries.
- No door-only, bolt-only, native HomeKit pairing, or Apple Home automation backend.
- No dependency on HTTP Webhooks for the coordinator's accessories or state publication.

## Owner test release: 0.4.27

Separates the saved **Enabled** setting from current device health. A fault, outage or reboot leaves setup and enablement intact. Startup checks fresh physical state, archives previous faults, and never replays movement. Both interfaces show Enabled alongside Ready, Checking devices, Device unavailable or Fault, with a separate **Check again** recovery action. Names and timing edits retain setup approval. See [restart recovery, saved-state migration and Tailwind feedback limits](../restart-recovery.md).

Retains automatic LAN setup, live controller-default/device timing edits and Homebridge setup diagnostics. Both this plugin and homebridge-deconz require separate child bridges.

Includes the optional Node.js web administrator using the existing interface for deCONZ users, PINs, access grants, schedules, keypad protection, alarms, activity and web accounts. Enable it in General → Web admin interface and create the first administrator there. Additional accounts are managed in web Settings. The server is **off by default** and uses the saved deCONZ connections; existing controller configuration and HomeKit pairing are retained.

The existing Homebridge coordinator remains responsible for movement. This release does not include the old Python controller or HTTP Webhooks integration. The Controller page supports live timing edits; see docs/controller-timings.md. The [standalone application](https://github.com/pponce/garageDoorController) remains preserved for use without Homebridge.

See [web setup and the first functional test](../web-admin-setup.md) and [alarm-PIN restart requirements and recovery limits](../web-admin-alarm-pin.md). Existing Homebridge deCONZ alarm PIN synchronization requires explicit confirmation, a separate local deCONZ child bridge, and the reviewed compatible sources. This initial release has automated coverage; physical acceptance is still required.

The configuration UI retains connection cards, direct local Homebridge selection, device/control selectors and in-place reviewed saves from 0.4.23. The [older package-name transition](../package-rename.md) applies only when moving from homebridge-gDoorAndBolt-coordinator.

## Installation

After npm publication, install on a Homebridge 2 / Node 22 or 24 host:

```sh
sudo hb-service add homebridge-gdoor-admin-controller@0.4.25
```

**Required bridge setup:** run Garage Door Admin Controller in its own child bridge. Run `homebridge-deconz` in a separate child bridge. Do not place either on the main bridge or combine them in the same child bridge. This separation lets alarm PIN updates restart deCONZ while the controller and web administrator remain running. New garages remain disabled until checked and enabled. Follow the [owner installation guide](../owner-test.md) for taking over from an existing controller. This package does not install a separate system service.

Maintainer publication instructions are in [npm-release.md](../npm-release.md). The GitHub repository can remain private while the npm package is public. No new open-source license is granted in this release (`UNLICENSED`).

## Development

Node.js 22 or 24 and Homebridge 2. The optional web administrator requires Node 22.13+ or 24 and OpenSSL. Install runtime dependencies before testing; the schedule adapter uses @js-temporal/polyfill.

```sh
npm install --ignore-scripts --no-audit --no-fund
npm test
npm pack --dry-run --ignore-scripts
```

Version 0.4.14 lets edited garage cards open Review changes and Save configuration in place; the bottom Review changes route remains available. Name-only edits keep the current enabled/disabled card color and show an unsaved-changes label. Both routes use one reviewed save.

Version 0.4.13 adds reusable device connections in General for deCONZ, Tailwind and existing Homebridge accessories. Save a name, address and private-key reference once, then select that connection during garage setup. Existing connections import automatically; valid garage enablement is preserved. Tailwind door count is optional, and garage selections show Door 1/2/3. Shared address/key-reference edits update affected profiles through Review/Save and their existing check policy. Keys can be created inline and remain private. See [the configuration flow](../config-ui-experience.md). Update the separate administrator client before editing 0.4.13+ coordinator settings there. It includes the selectable [HomeKit reporting experiments](../homekit-reporting.md#next-experiments--049) from 0.4.9 with diagnostics starting OFF in 0.4.14 and available for on-demand re-enablement. Movement behavior is unchanged. Registry publication is performed by the maintainer after release checks pass. Examples contain synthetic devices and require real discovery/configuration. Uncommissioned startup and inventory make no hardware requests; commissioned operation reads devices. No startup, probe or discovery sends actuator commands. See [device checks](../device-checks.md) and the [behavior parity inventory](../behavior-parity.md).

Read the [implementation plan](../implementation-plan.md), [migration plan](../migration.md), [API contract](../api-v1.md), and [current status](../status.md).

## Xfinity keypad reference

See [what we have learned about the Xfinity keypad](../xfinity-keypad.md): the green entry light, extra digits after rejected and accepted codes, lockout request counting, and the limits of the latest physical test. Observations and unproven explanations are labeled separately.

## A friendly disclaimer

I use this plugin on my own garage, but it's still software, and software can have bugs. Please test **all functions of your setup** before relying on it, and test again after updates or configuration changes. Check PIN access, opening, stopping or reversing where configured, closing, locking, and behavior after a restart. My garage gives it a regular workout, but yours may discover a new party trick.

This plugin is provided **as is, without warranties**. You're responsible for making sure your setup works safely and as intended. I'm not responsible for bugs, failures, damage, or other issues resulting from its use.
