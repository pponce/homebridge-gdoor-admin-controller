# Restart recovery (0.4.26)

Previously enabled garages retain their saved enablement across coordinator child-bridge and full Homebridge restarts. Explicitly disabled garages stay disabled; maintenance stays paused.

Startup and idle reads canceled by shutdown do not create durable faults. If Tailwind, deCONZ or an upstream Homebridge child bridge is temporarily unavailable, startup read checks retry every five seconds, without an overall expiry. The page shows Waiting for devices. Each retry checks the saved journal, device identity, current feedback and motor relay release. Success resumes ordinary monitoring and fresh input subscriptions; old input events are not replayed. No startup or recovery check operates the door or bolt.

## Door state at restart

| Current feedback | Behavior |
| --- | --- |
| Closed | Enabled; no automatic startup bolting |
| Confirmed open | Enabled; no startup movement |
| Opening or closing | Enabled and monitoring; new conflicting commands wait until a confirmed endpoint |
| Tailwind not-closed | Enabled with Position unconfirmed; no invented fully-open position or restored travel estimate |
| Interrupted travel and Tailwind not-closed | Enabled and monitoring. A new explicit Close through HomeKit can use Tailwind's directional API; it runs the ordinary fresh checks and closing sequence. Relay toggles wait for a confirmed endpoint |

A reboot cannot recover physical position that a device does not measure. Tailwind supplies a closed contact, so after interrupted opening it cannot distinguish fully open, partly open or still moving. Time alone is not treated as proof. No old command, motor pulse or interrupted operation is replayed. Observing an endpoint after interrupted travel clears the interruption record without automatically bolting; a new explicit Close uses the normal bolt sequence.

## Faults that still need review

Ambiguous actuator writes, changed hardware identity, obstruction, an active motor relay, invalid feedback, or a locked bolt with a non-closed door retain review holds. They are distinct from an unavailable connection. New durable faults store a fixed, allowlisted reason and timestamp, which survive subsequent restarts and appear in the settings UI and diagnostic export. Arbitrary errors and private device data are excluded.

The pre-0.4.26 record contains only fault/inProgress booleans. An existing fault cannot be safely classified retroactively. With the door physically closed, use Check connections and Enable this garage door once to recover that old hold. Future normal restarts do not require repeating setup. Older plugin versions cannot read the extended fault record and will conservatively hold rather than clear it.

## Verification

Regression checks exercise actual durable storage, five-minute simulated dependency outages, repeated restarts, shutdown during startup/idle reads and commanded travel, all reported door states, interrupted requests, read-only recovery, stale-command rejection, explicit disable/maintenance, fixed fault retention and privacy. Homebridge integration checks restart the actual child process and entire Homebridge with loopback emulators. Desktop/mobile browser checks verify the waiting and fault explanations. These are software tests, not physical acceptance on an installed garage.

## Optional status details

Starting in 0.4.26, clients may send `X-Coordinator-Status: detailed` to request extended status. Without that header, the exact legacy v1 response shapes remain unchanged. The Homebridge UI opts in automatically. In extended responses, optional status.health contains title, detail and a fixed code (or null). State may add faultAt, reconciling and restartCloseAvailable. A transient startup read failure retains commissioning, reports held=waiting-for-devices and state.unavailable, and retries read checks every five seconds without moving hardware. Restart retains commissioning for interrupted requests; their outcome becomes unknown and the controller resumes observation without replay. Fresh, safe state restores enablement even when open, opening or closing. While reconciling, new requests return controller_observing_movement until an endpoint is confirmed, except a new explicit primary Tailwind Close when restartCloseAvailable is true. Relay pulses and old commands are never replayed. Legacy fault records require one explicit recovery; new faults retain their original reason and time. Older servers ignore this header and retain their existing response shape.
