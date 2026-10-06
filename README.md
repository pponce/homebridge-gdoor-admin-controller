# Garage Door and Bolt Coordinator

A Homebridge platform for coordinating **one garage door and a separate bolt/lock per configured controller**. Multiple doors are supported by separate controller definitions. Multiple input profiles for the same physical door must share its coordinator.

**Status: observation and engine development. Not ready for physical operation or migration.** Authenticated inventory and explicit Tailwind/deCONZ connection checks are implemented. The movement engine and durable journal are tested with simulated hardware but are not connected to the running plugin. The platform publishes no HomeKit accessories and accepts no movement commands.

## Agreed product scope

- Opener: a garage accessory supplied by another Homebridge plugin, or Tailwind's local API.
- Bolt: a Lock, Switch, or Light accessory supplied by another Homebridge plugin, or direct deCONZ relay access.
- Always publish a combined Garage Door accessory once the operational runtime is implemented.
- Optionally publish a separate Lock accessory for either bolt backend.
- Configure sensor-based or explicitly estimated travel feedback, independent opening/closing times, settling delays, and per-input behavior.
- No door-only, bolt-only, native HomeKit pairing, or Apple Home automation backend.
- No dependency on HTTP Webhooks for the coordinator's accessories or state publication.

The separately installed [administration application](https://github.com/pponce/homebridge-deconzKeypadAlarm-admin) retains its own URL and accounts. The existing standalone installation remains a separate project. The owner will switch to the new standalone administrator and stop the existing one when both projects are ready.

## Development

Node.js 22 or 24; no development dependencies are needed for this milestone:

```sh
npm test
npm pack --dry-run --ignore-scripts
```

The package is private to prevent accidental npm publication during development. Do not copy example settings into a live installation yet. Device reads happen only through an explicit authenticated connection check. Startup and inventory never touch hardware. See [device checks](docs/device-checks.md) and the [behavior parity inventory](docs/behavior-parity.md).

Read the [implementation plan](docs/implementation-plan.md), [migration plan](docs/migration.md), [API contract](docs/api-v1.md), and [current status](docs/status.md).
