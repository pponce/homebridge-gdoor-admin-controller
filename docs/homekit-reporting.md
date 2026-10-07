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

## Version 0.4.5 correction

The comparison above describes 0.4.4. Version 0.4.5 implements committed reporting snapshots and synchronous callback GET handlers, following the old publisher. HAP's onGet path awaits the handler and then stores its result; a read started before a newer report can therefore store the earlier value after that report. The callback path stores a synchronous read before returning, so a later report remains authoritative. The actual-HAP test explicitly reproduces the old overwrite and tests the corrected garage and lock paths. This is a reproducible race, but owner testing is still needed to determine whether it resolves the reported Apple Home display regression.

Both tiles now use current-then-target reports with bounded explicit reaffirmation (three total, two seconds apart). Ordinary fresh observations continue reconciliation. GET answers use the same committed snapshot as publication; initialization seeds restored accessories, preparation reports coherent current/target values, and delayed SET callbacks cannot replace newer opposite targets. No HTTP Webhooks dependency or hardware behavior changes are involved. Five configurable reporting controls from the original controller are still not exposed; fixed reporting defaults are used in this correction.

## Recorded working legacy path and 0.4.6

The previous audit compared the current generic Plus implementation, but the original controller repository also contains the owner-tested legacy patch and its installation record. Its September 20 entry, “Live notification update verified; two tile cycles successful,” records installation, restart verification, and successful opening/closing trials with three terminal notifications. The updater sets `homekit_notify_repeats=3`; its seed/validation path preserves that value in the later Controller settings overlay. A fallback default of zero is not evidence that notifications were disabled in that recorded installation.

The exact legacy explicit path stores both values, calls `TargetDoorState.sendEventNotification(target)`, then calls `CurrentDoorState.sendEventNotification(current)`. At completion and on the next two idle observations, both values are repeated. Ordinary reports resume afterward. This does not invoke the SET handlers or move hardware.

The newer generic Plus publisher processes the controller's payload in insertion order: current then target. Our earlier phrase “the old order” failed to distinguish that generic implementation from the historical working patch. Both notify both supplied fields when explicit notification is requested; neither implements current-only forced repetition.

Version 0.4.6 therefore restores the legacy **explicit garage** target-then-current sequence, retaining the fixed three-report/two-second schedule, coherent snapshots and synchronous GET protection. Ordinary garage reports and all bolt reports remain as in 0.4.5. The initially proposed current-only change was not released. This is a narrow parity correction against a recorded working source, not proof that event order causes or resolves Apple's lingering Closing display. HAP transport may batch/reorder event payloads; local delivery tests do not establish Apple Home rendering.

Sources in the original repository at `7d4e0f04e4ef3631e721e571adb292cf11988e87`:

- [Legacy explicit notification implementation and enabling updater](https://github.com/pponce/garageDoorController/blob/7d4e0f04e4ef3631e721e571adb292cf11988e87/scripts/update_garage_feedback.py)
- [Original notification design and schedule](https://github.com/pponce/garageDoorController/blob/7d4e0f04e4ef3631e721e571adb292cf11988e87/notes/feedback-notifications.md)
- [Recorded successful installation and trials](https://github.com/pponce/garageDoorController/blob/7d4e0f04e4ef3631e721e571adb292cf11988e87/notes/current-status.md#live-notification-update-verified-two-tile-cycles-successful-2026-09-20-utc)

The owner's working original stack is the behavior reference for future regressions. Trace its applicable implementation and deployment record before proposing changes, preserve working semantics, and test deliberate differences. Do not ask the owner to reconstruct recorded setup decisions.

## Existing HomeKit connections — diagnostic 0.4.7

The owner tested 0.4.6 and the garage still stayed Closing. That release did not resolve the display issue. The following diagnostic observes the existing connections rather than adding another HAP subscriber:

```bash
{
  cd "$HOME/devProjects/homebridge-gDoorAndBolt-coordinator" &&
  sudo python3 -B scripts/watch-homekit-events.py --reporting --seconds 180
}
```

This requires 0.4.7 installed and running. Keep Home open, use the indoor button for one open/close cycle, and wait ten seconds if the display stays Closing. Then leave Home and re-enter it once while the capture continues. Ctrl+C ends the capture. Share the printed output. No extra garage/bolt action is needed after that cycle.

`TRACE` identifies publication, successful reads and read errors. Each publication records anonymous subscribers present at that moment; `paired:true` distinguishes paired HomeKit connections from local unpaired diagnostics. It does not identify which device or application owns the connection. `REPORT` compares reported values to the HAP cache and shows event permissions, subscriptions, queued coordinator events, pending-request flags and socket byte counters. No pairing identity, address, PIN, token or unrelated accessory data is printed. Values retain HAP numbers: garage 0=Open, 1=Closed, 2=Opening, 3=Closing, 4=Stopped; lock 0=Unlocked, 1=Locked.

A missing paired subscription, a cached/reported mismatch, a read returning Closing after a Closed report, and a persistent queue are different failure boundaries. The trace is intended to distinguish them. An empty queue or growing byte counter is not proof of delivery/rendering at Home. Existing HAP internals are inspected behind compatibility guards; no transport methods or subscriptions are overridden. This release changes observation only, preserving 0.4.6's reporting and movement behavior.


## Controlled comparison after successful 0.4.7 trials

The owner reported one successful close with the reporting capture and one with the script stopped, keeping Home visible. Internal recording was still enabled in both. The first capture reports Homebridge 2.4.0 / HAP 2.2.2, one paired subscriber to both garage fields, Closed publications around capture seconds 41/43/45, and a queued Closed pair cleared by the following snapshot with increased socket bytes. There were no recorded characteristic GETs during that cycle. This is owner-reported display success, not a proven cause or a transport acknowledgement from Apple.

The old controller used sequential HTTP feedback requests and observation-driven repeats. Plus 0.5.0 synchronously persisted state before publishing; the legacy patch stored both values before its target/current pair. Controller changed-status logging followed the HTTP response. Homebridge's ordinary batching delay is 250 ms in inspected HAP 0.12.3, 0.14.1 and 2.2.2; neither plugin changes it. These scheduling differences are candidates, not evidence that the diagnostic inserted a needed delay or split a target/current pair. The old exact runtime version was not recovered. Web administration is not an intermediary in the notification path.

Version 0.4.8 preserves reporting behavior and adds a process-local recording switch. With recording off, accessory publication bypasses the additional cached-value read, event creation, timestamps and subscriber inspection; GETs use the original synchronous callback path. Recording on still adds observer work, including new monotonic timestamps. The off path retains a boolean branch and binding references, so it is a controlled removal of tracing, not byte-for-byte 0.4.6. Neither mode injects delays, reconnects clients, clears caches or invents states.

Keep the external capture script stopped, leave Home visible and run:

```bash
{
  cd "$HOME/devProjects/homebridge-gDoorAndBolt-coordinator" &&
  sudo python3 -B scripts/compare-homekit-reporting.py
}
```

The script sends only local management reads and the recording flag change. It never operates hardware. It verifies an enabled, idle Closed/Locked controller, then asks for a manual indoor-button cycle with recording ON (A). Report c if Home showed Closed or s if it remained Closing ten seconds after physical closure/locking. A failed baseline stops. A successful baseline proceeds to recording OFF (B). Two successes stop. Only an OFF failure asks for a final ON (A2) cycle. Recording is restored ON in cleanup; if an operation is still busy, the script prints a standalone restoration command for use once idle. A restart also restores ON.

No polling occurs while the script waits for an answer. Boundary snapshots inspect existing connections without HAP reads. Changed process, paired subscribers or recording revision invalidate the comparison. Matching boundary subscribers do not prove which Apple device rendered the tile or reveal transient subscription changes between snapshots. A success/failure/success pattern strengthens a recording-dependence hypothesis but does not identify a particular race or prove a durable fix. A failure trace with recording ON provides publication/read timing; OFF intentionally records no new events. Re-enabling recording does not replay or force-refresh the tile. Share the full output and keep Home visible throughout.
