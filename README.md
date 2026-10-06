# Garage Door and Bolt Coordinator

A Homebridge platform for coordinating **one garage door and a separate bolt/lock per configured controller**. Multiple doors are supported by separate controller definitions. Multiple input profiles for the same physical door must share its coordinator.

**Status: ready for initial supervised owner testing.** The runtime, combined Garage Door and optional Lock accessories, generalized physical inputs, standalone-admin API and modern custom Homebridge settings UI are connected. New garages stay disabled until explicitly checked and enabled. Start with the [installation and test guide](docs/owner-test.md); [validated revisions and limits](docs/status.md) are recorded separately.

## Agreed product scope

- Opener: a garage accessory supplied by another Homebridge plugin, or Tailwind's local API.
- Bolt: a Lock, Switch, or Light accessory supplied by another Homebridge plugin, or direct deCONZ relay access.
- Always publish a combined Garage Door accessory.
- Optionally publish a separate Lock accessory for either bolt backend.
- Configure sensor-based or explicitly estimated travel feedback, independent opening/closing times, settling delays, and per-input behavior.
- Assign supported deCONZ or Homebridge buttons/switches to the primary opener or a named motor relay through the same coordinator. HomeKit and virtual keypad retain the primary opener route. See [input assignments](docs/input-routing.md) for implementation boundaries.
- No door-only, bolt-only, native HomeKit pairing, or Apple Home automation backend.
- No dependency on HTTP Webhooks for the coordinator's accessories or state publication.

The separately installed [administration application](https://github.com/pponce/homebridge-deconzKeypadAlarm-admin) retains its own URL and accounts. The existing standalone installation remains a separate project. The owner will switch to the new standalone administrator and stop the existing one when both projects are ready.

## Installation

After npm publication, install on a Homebridge 2 / Node 22 or 24 host:

```sh
sudo hb-service add homebridge-gdoorandbolt-coordinator@0.4.1
```

Use Homebridge settings to configure the plugin in its own child bridge. New garages remain disabled until checked and enabled. Follow the [owner installation guide](docs/owner-test.md) for taking over from an existing controller. This package does not install a separate system service.

Maintainer publication instructions are in [npm-release.md](docs/npm-release.md). The GitHub repository can remain private while the npm package is public. No new open-source license is granted in this release (`UNLICENSED`).

## Development

Node.js 22 or 24 and Homebridge 2. Unit tests use Node built-ins; the custom UI server depends on @homebridge/plugin-ui-utils.

```sh
npm test
npm pack --dry-run --ignore-scripts
```

The next npm release is prepared as version 0.4.1; registry publication is performed by the maintainer. Examples contain synthetic devices and require real discovery/configuration. Uncommissioned startup and inventory make no hardware requests; commissioned operation reads devices. No startup, probe or discovery sends actuator commands. See [device checks](docs/device-checks.md) and the [behavior parity inventory](docs/behavior-parity.md).

Read the [implementation plan](docs/implementation-plan.md), [migration plan](docs/migration.md), [API contract](docs/api-v1.md), and [current status](docs/status.md).
