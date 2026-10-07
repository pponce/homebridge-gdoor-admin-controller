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
