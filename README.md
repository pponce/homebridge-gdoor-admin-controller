# Garage Door Admin Controller

A Homebridge platform for coordinating **one garage door and a separate bolt/lock per configured controller**. Multiple doors are supported by separate controller definitions. Multiple input profiles for the same physical door must share its coordinator.

**Status: correcting issues found in initial owner testing.** The runtime, combined Garage Door and optional Lock accessories, generalized physical inputs, standalone-admin API and custom Homebridge settings UI are connected. Physical testing has exposed status and input failures; full original-controller parity is not established. New garages stay disabled until explicitly checked and enabled. See the [installation and test guide](docs/owner-test.md), [validated revisions and limits](docs/status.md), and [old-to-new field-name mapping](docs/settings-mapping.md).

## Agreed product scope

- Opener: a garage accessory supplied by another Homebridge plugin, or Tailwind's local API.
- Bolt: a Lock, Switch, or Light accessory supplied by another Homebridge plugin, or direct deCONZ relay access.
- Always publish a combined Garage Door accessory.
- Optionally publish a separate Lock accessory for either bolt backend.
- Configure sensor-based or explicitly estimated travel feedback, independent opening/closing times, settling delays, and per-input behavior.
- Assign supported deCONZ or Homebridge buttons/switches to the primary opener or a named motor relay through the same coordinator. HomeKit and virtual keypad retain the primary opener route. See [input assignments](docs/input-routing.md) for implementation boundaries.
- No door-only, bolt-only, native HomeKit pairing, or Apple Home automation backend.
- No dependency on HTTP Webhooks for the coordinator's accessories or state publication.

**Release 0.4.20 changes the npm package name and branding only.** Controller behavior is unchanged from 0.4.19. The integrated Node.js web admin is planned, not included. See [the package transition](docs/package-rename.md) before installing alongside an older release.

The separately installed [administration application](https://github.com/pponce/homebridge-deconzKeypadAlarm-admin) retains its own URL and accounts. The existing standalone installation remains a separate project. The planned direction is to include that interface in this plugin with a Node.js backend; the current release does not implement that integration.

## Installation

After npm publication, install on a Homebridge 2 / Node 22 or 24 host:

```sh
sudo hb-service add homebridge-gdoor-admin-controller@0.4.20
```

Use Homebridge settings to configure the plugin in its own child bridge. New garages remain disabled until checked and enabled. Follow the [owner installation guide](docs/owner-test.md) for taking over from an existing controller. This package does not install a separate system service.

Maintainer publication instructions are in [npm-release.md](docs/npm-release.md). The GitHub repository can remain private while the npm package is public. No new open-source license is granted in this release (`UNLICENSED`).

## Development

Node.js 22 or 24 and Homebridge 2. Unit tests use Node built-ins; the custom UI server depends on @homebridge/plugin-ui-utils.

```sh
npm test
npm pack --dry-run --ignore-scripts
```

Version 0.4.14 lets edited garage cards open Review changes and Save configuration in place; the bottom Review changes route remains available. Name-only edits keep the current enabled/disabled card color and show an unsaved-changes label. Both routes use one reviewed save.

Version 0.4.13 adds reusable device connections in General for deCONZ, Tailwind and existing Homebridge accessories. Save a name, address and private-key reference once, then select that connection during garage setup. Existing connections import automatically; valid garage enablement is preserved. Tailwind door count is optional, and garage selections show Door 1/2/3. Shared address/key-reference edits update affected profiles through Review/Save and their existing check policy. Keys can be created inline and remain private. See [the configuration flow](docs/config-ui-experience.md). Update the separate administrator client before editing 0.4.13+ coordinator settings there. It includes the selectable [HomeKit reporting experiments](docs/homekit-reporting.md#next-experiments--049) from 0.4.9 with diagnostics starting OFF in 0.4.14 and available for on-demand re-enablement. Movement behavior is unchanged. Registry publication is performed by the maintainer after release checks pass. Examples contain synthetic devices and require real discovery/configuration. Uncommissioned startup and inventory make no hardware requests; commissioned operation reads devices. No startup, probe or discovery sends actuator commands. See [device checks](docs/device-checks.md) and the [behavior parity inventory](docs/behavior-parity.md).

Read the [implementation plan](docs/implementation-plan.md), [migration plan](docs/migration.md), [API contract](docs/api-v1.md), and [current status](docs/status.md).
