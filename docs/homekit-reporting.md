# Capture live HomeKit reporting

Use this diagnostic when the controller has completed a movement but Apple Home keeps showing an earlier state. It runs against the installed plugin; no npm publication, plugin update or Homebridge restart is needed.

On the Homebridge host, from a clean checkout on main:

```bash
{
  cd "$HOME/devProjects/homebridge-gDoorAndBolt-coordinator" &&
  git pull --ff-only git@github.com:pponce/homebridge-gDoorAndBolt-coordinator.git main &&
  sudo python3 -B scripts/watch-homekit-events.py
}
```

Wait for **READY**, keep Apple Home open, then perform one open/close cycle with the indoor button. Leave it running for about ten seconds after physical closure. It stops after three minutes; Ctrl+C stops sooner. Share its output and whether the Home tiles updated. Add `--seconds 300` for a longer capture, or `--storage /path/to/homebridge` if storage cannot be detected.

The script reads existing local Homebridge access credentials without printing them. It discovers only this coordinator's tiles and subscribes to garage current/target and bolt current/target on one HAP connection. Its subscription requests contain `ev: true`, never a characteristic `value`. It sends no movement commands, writes no files and does not change configuration. It requires the existing local HAP access used by the administrator/diagnostics; if access is rejected it stops without changing Homebridge's authentication settings.

`ENGINE` lines show changes from the management API. `PUSH` lines show unsolicited HAP event notifications received by the diagnostic. The script reads HAP accessory values only once for discovery, then does not poll them during capture, so a repeated read cannot mask a missing event. `TOTAL` lines count received events. Labels such as Garage 1 replace household names/IDs; PINs, tokens and device addresses are excluded.

Receiving Closed/Locked on this connection establishes delivery to this subscriber, not delivery to the separately paired Apple Home or home hub connection. Missing pushes despite correct ENGINE states identifies a problem before that boundary. Either result helps narrow the issue without treating a successful GET as proof of push delivery.

## Reporting APIs

Homebridge's `updateCharacteristic()` calls the characteristic's `updateValue()`: it reports changed values without running the SET handler. `setValue()` additionally invokes the SET handler and must not be used to report an observed door/bolt state. `sendEventNotification()` explicitly sends the reported value even when the HAP cache already has it. These are state reports, not UI commands.

Version 0.4.4 already uses ordinary updates for both accessories and bounded explicit terminal notifications for the garage. The former HTTP Webhooks Plus path supported explicit notifications for both garage and bolt; the original controller also had separate bolt notification and reconciliation settings. The new plugin has not carried over all those reporting controls. Correct reads plus a stale Home display do not yet identify which reporting difference caused the regression.

References: [Homebridge characteristic APIs](https://developers.homebridge.io/HAP-NodeJS/classes/Characteristic.html) and [previous StateAccessory publisher](https://github.com/pponce/homebridge-http-webhooks-plus/blob/master/src/homekit/StateAccessory.js).

## Comparison with HTTP Webhooks Plus

Source audit, 2026-10-07 UTC. Compared HTTP Webhooks Plus 0.5.0 at `ff658949c4a017209ac58906d54598fea8ea2f2a`, coordinator runtime 0.4.4, and the original controller at `7d4e0f04e4ef3631e721e571adb292cf11988e87`. The owner reports using the same Apple device and OS as the previously working setup. Investigate the changed implementation before treating the client environment as the explanation.

### Shared mechanism

Both plugins construct the standard GarageDoorOpener and LockMechanism services using Homebridge's own `api.hap` constructors. They use the same current/target characteristics and enum values. HTTP Webhooks Plus calls `updateValue()` for ordinary reports and `sendEventNotification()` for allowed explicit reports. The coordinator's `updateCharacteristic()` is the service-level entry to `updateValue()`; its garage reaffirmation also calls `sendEventNotification()`. Neither reporting path uses SET to operate the hardware.

The old `fromHTTPWebhooks` context is a string used to distinguish reports from commands inside that plugin. It is not an extra Home refresh instruction. HTTP is the transport into the old state publisher, not an additional HomeKit notification mechanism. The old plugin's devDependencies do not supply a separate runtime HAP implementation for these accessories: it uses the constructors supplied by Homebridge.

### Confirmed differences

| Area | Previous controller + HTTP Webhooks Plus | Coordinator 0.4.4 | Relevance |
| --- | --- | --- | --- |
| Explicit repeated reports | Plus supports explicit notifications for every supplied current/target field on both garage and lock. The controller schedules repeats; Plus applies a per-field minimum interval. | Fixed explicit garage terminal report followed by two repeats, two seconds apart. Bolt receives ordinary updates only. | Missing bolt reporting parity. More garage repeats alone are not supported as a solution by the owner's capture, which already received three Closed reports. |
| Configurable schedule | Original Controller page exposed garage repeats/spacing and bolt repeats/spacing/reconciliation. | All five corresponding controls are absent. Idle observations refresh characteristics but do not recreate that scheduling policy. | A direct code/configuration gap. Original bolt reconciliation after its repeat budget is ordinary publication, not an endless forced notification. |
| Beginning a physical-control movement | Original engine reports unbolting/preparation with CurrentDoorState Opening/Closing and the corresponding target in one report. | Engine first publishes the new target while retaining the preceding phase, then reads hardware and publishes unbolting. | The owner trace contains Target Closed at 28.54 seconds while phase is Open, followed by Current Closing at 29.25 seconds. This is a real sequence difference; it is not proof that Home rejected the later Closed event. |
| Applying a report | Plus validates and commits all supplied values before updating HAP characteristics, choosing either ordinary or explicit notification for each field. The original controller supplies current then target. | The engine assigns changes before calling its publisher. Garage publication updates target then current, then may explicitly notify target/current again. | Both have synchronous state assignment; do not claim that the new engine has no coherent snapshot. Their publication boundaries and sequences differ. HAP may coalesce notifications, so call order is not a promise about client processing order. |
| Answering Home reads | Callback getters return the same committed per-accessory values that Plus published, subject to its availability policy. | onGet handlers independently derive values from the live runtime state. | Different read/report architecture. Both getter APIs are supported; changing callback syntax alone is not a demonstrated fix. |
| A delayed HomeKit SET completes after newer feedback | Plus uses a report generation check and rejects a superseded SET when its target no longer agrees, preventing HAP's SET completion from overwriting the newer target. | The handler acknowledges runtime acceptance without an equivalent accessory-level supersession check. | Missing defensive parity for overlapping SET/report completion. It does not by itself explain a physical-button cycle with no HomeKit SET. |
| Availability and recovery | Configurable per-accessory current-state expiry, separate optional garage obstruction expiry, and persisted reported values with an explicit startup policy. | Runtime enablement/fault/availability checks and an observation-age limit derived from idle polling govern reads. | Different policy. No read failure was established in the successful final-state capture, so expiry is not a confirmed cause. |
| Accessory lifecycle | Static platform returns services and initializes their characteristic values during construction. | Dynamic platform registers/restores cached accessories and updates them through runtime publication. | A structural difference to cover in startup/reconfiguration tests; not evidence that dynamic platforms cannot deliver live updates. |

### Important limits of this comparison

Coordinator 0.4.3 published garage current before target, matching the original report's field order, and the owner still observed delayed Closed display. Therefore merely reversing 0.4.4's two update calls is not a complete explanation of the regression.

The owner capture proves final Closed current/target values reached the local diagnostic connection three times, with no later contradictory garage report before the capture ended. It does not identify the exact point where the Home display failed to follow them. Both garage and bolt remain intermittently affected. Do not describe the missing bolt repeats, transient target/current pair, getter architecture or SET guard as the proven cause without further evidence.

The implementation baseline for correction is the original reporting contract: report state separately from commands, keep reads consistent with published state, preserve current/target semantics through operation transitions, restore the missing notification controls and bolt policy, and reject obsolete SET completions. This can be implemented inside the coordinator without reinstating the HTTP Webhooks dependency. This audit does not change runtime behavior or prepare a new release.

Sources:

- [Plus README at the audited revision](https://github.com/pponce/homebridge-http-webhooks-plus/blob/ff658949c4a017209ac58906d54598fea8ea2f2a/README.md)
- [Plus StateAccessory: getters, commit, apply and command](https://github.com/pponce/homebridge-http-webhooks-plus/blob/ff658949c4a017209ac58906d54598fea8ea2f2a/src/homekit/StateAccessory.js)
- [Plus State API contract](https://github.com/pponce/homebridge-http-webhooks-plus/blob/ff658949c4a017209ac58906d54598fea8ea2f2a/docs/STATE_API.md)
- [Original controller: run, publish and publish_bolt](https://github.com/pponce/garageDoorController/blob/7d4e0f04e4ef3631e721e571adb292cf11988e87/controller/garage_controller.py)
- [Coordinator 0.4.4 accessories](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/blob/f2af2ed9d236e9041359b2404c1ab432ab978dea/src/accessories.js)
- [Coordinator 0.4.4 movement engine](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/blob/f2af2ed9d236e9041359b2404c1ab432ab978dea/src/engine.js)
- [Coordinator 0.4.3 accessories](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/blob/8cc520a1e53c8487e57a893d02a970f452441a4a/src/accessories.js)
