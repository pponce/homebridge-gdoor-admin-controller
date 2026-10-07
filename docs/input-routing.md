# Input assignments and motor paths

Owner decision, 2026-10-06: retain the Aqara motor-control path for the physical keypad and indoor button. HomeKit and the virtual keypad continue using Tailwind. Generalize the model so another supported button, switch or relay can be assigned without writing Aqara-specific coordination logic.

## Three separate responsibilities

1. **Input:** a button press, switch edge, enrolled keypad outcome, HomeKit request or virtual-keypad outcome.
2. **Assembly coordinator:** the single worker that owns the garage and bolt, timing, state evidence, manual-unlock policy and fault holds.
3. **Motor path:** either the primary opener connection (Tailwind or an existing Homebridge garage service), or a named opener pulse-relay connection.

Changing the motor path does not change the door-state source or bolt driver. In the owner's installation Tailwind continues supplying the closed-sensor evidence even when the Aqara relay operates the motor. The motor relay and bolt relay are separate configured outputs.

| Owner input | Selected motor path |
| --- | --- |
| Combined HomeKit garage tile | Primary opener: Tailwind |
| Virtual keypad | Primary opener: Tailwind |
| Physical keypad | Opener pulse relay: existing Aqara |
| Indoor button | Opener pulse relay: existing Aqara |
| Additional supported button or switch | Its configured primary-opener or pulse-relay path |

## General configuration

Each assembly optionally declares `motorPaths` and `inputs`. `primary` is the reserved motor path supplied by the assembly's existing `door` connection. HomeKit and virtual-keypad routes remain primary; physical profiles select `primary` or a named additional path. Several profiles share the same worker; they never create competing movement engines for the same garage.

An input profile names the source, the triggering event/edge, the action, the motor path, busy behavior, quiet rearming time and optional opening/closing travel/retraction timing overrides. A deCONZ button uses its explicitly selected numeric button event. A Homebridge button uses the selected programmable-switch event; a Homebridge switch uses an on/off edge. A native deCONZ keypad uses accepted-disarm/rejected outcomes, with its gateway/sensor/alarm mapping. Neither a keypad PIN nor an arbitrary motor path from an event payload is accepted.

See [the fully synthetic configuration example](../examples/input-routing-config.json). It includes a deCONZ button, a physical keypad and a button supplied by another Homebridge plugin. No brand name is a routing condition. The custom Homebridge configuration screen provides device discovery and guided profiles; the separate administrator edits the same authoritative profiles.

### Closing wait in 0.4.4

`Behavior → Bolt retraction → Before closing` sets the garage default. A physical input can override it with `Timing for this control → Retract before closing`; a blank override inherits the default. The effective value applies to that operation on either motor path.

- At zero, one recent assembly check precedes the motor command. An already-OFF bolt is not commanded OFF again. An ON bolt receives one unlock request; after its acknowledgement, closing can start before OFF feedback arrives. The same worker monitors retraction during travel without repeating an outstanding unlock request.
- Above zero, any required unlock must report OFF, followed by the configured settling interval before movement. The interval is also honored when the initial read is already OFF.
- Slow adapter preparation that makes the initial check older than 1.5 seconds triggers a fresh check. Driver identity/reachability checks still run, so zero does not mean zero network latency.
- Closing still monitors each subsequent extension, requires retraction before completing closed confirmation, and extends the bolt only after the configured closed/stability checks. An ambiguous unlock prevents the motor command. Retraction timeout or an ambiguous movement latches a fault; it does not replay motor commands.

Zero-wait closing intentionally permits retraction and door travel to overlap. No fixed amount of clearance is inferred from Tailwind's not-closed feedback. A command acknowledgement is not physical retraction evidence. This is the owner's requested change from the original controller's unconditional pre-close OFF refresh and confirmation. Opening behavior is unchanged.

Initial connector scope is deCONZ and existing Homebridge services. This does not add native HomeKit pairing, an arbitrary webhook or universal support for every device brand. An input must provide supported events; a relay must provide verified active/inactive level control and an idempotent inactive write. A command-only toggle is not interchangeable with that relay contract. Existing automations/local actions that independently move the door need review during commissioning: observing a button cannot intercept a separate direct motor action.

## Event handling and output ownership

- Startup, reconnect and GET snapshots establish baselines only; they never become button presses.
- Distinct live button messages may repeat the same event value. Switches require a real edge, not a repeated ON report.
- Source sessions, increasing event sequence/timestamps, bounded receipt age and operation epochs reject duplicates, stale events and busy-time history. deCONZ timestamps can bound source event age. A Homebridge live stream without source timestamps establishes receipt freshness only.
- Input receipts are local, one-use objects. Starting/completing another operation or rearming the source invalidates an older receipt. No waiting command queue exists.
- Configured motor selection is immutable for an accepted operation. An ambiguous relay command never falls back to Tailwind, or vice versa.
- Reusing an output service as a switch input is rejected. Overlapping event bindings, a shared bolt/motor relay, and declared output ownership across assemblies are rejected. Discovery/commissioning must still resolve cross-backend aliases for the same physical device.
- A pulse checks fresh door/bolt conditions under durable operation intent, attempts ON once, and always attempts bounded OFF cleanup. Identity mismatch prevents targeting a replacement resource. Cleanup cannot guarantee hardware release after host power loss.

## Stop/reverse

Keep the existing indoor-button behavior as an optional, separate policy for the verified pulse path: stop while opening, reverse while closing, and treat partial/open positions as estimates. Do not infer that behavior from a brand name, a switch service or the existence of a relay. Ordinary buttons may simply toggle while idle, and keypads retain their own policy.

The optional policy is implemented for a toggle input on a declared compatible pulse path. Opening can stop at an estimated partial position; only the same control can initiate its follow-up close. Closing can reverse to an estimated open position. Sensor-confirmed closure wins a simultaneous interrupt, and the old close cannot later extend the bolt after a reversal. Uncertain writes and restart at a partial stop require physical review.

## Current implementation boundary

The running plugin connects deCONZ WebSocket inputs and selected Homebridge HAP event sources after commissioning. Startup and reconnect consume snapshots only. Homebridge connections select an explicit accessory port and pairing PIN, require insecure mode, and pin bridge/service/accessory identities. Native HomeKit pairing is excluded. Timed bolt-only feedback is unsupported: a configured bolt must provide a current relay or position report. Physical behavior on each particular opener/relay still needs supervised testing.

## Protocol references

- [deCONZ button events](https://dresden-elektronik.github.io/deconz-rest-doc/endpoints/sensors/button_events/) and [WebSocket notifications](https://dresden-elektronik.github.io/deconz-rest-doc/endpoints/websocket/).
- [Homebridge programmable-switch events](https://developers.homebridge.io/HAP-NodeJS/classes/_definitions.Characteristics.ProgrammableSwitchEvent.html). Repeated equal-valued press events must not be treated like a boolean switch state.
- Existing owner behavior is traced in [behavior-parity.md](behavior-parity.md) to the pinned source commit.
