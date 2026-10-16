# Separate lock and unlock relays

Under **Garage doors → Devices → Bolt / Lock**, choose **deCONZ directly**,
select the saved deCONZ connection, then choose **Separate lock and unlock relays**.
Select the output whose ON command locks the bolt and the output whose ON command
unlocks it. Both outputs must belong to the selected gateway and have different
resource and endpoint identities. Their names do not establish their function.

**Show a separate bolt Lock tile** is automatically checked and required for this
mode. Both outputs are operated through one coordinated HomeKit Lock tile. The
garage door retains its own tile. Disabling bolt control still removes the bolt
tile and preserves the complete two-output mapping for later use.

Choose **Momentary relay outputs** for ON followed by OFF. The default pulse
length is **0.2 seconds**, adjustable from 0.1 to 2 seconds. This is a configurable
software duration, not a hardware recommendation or a guaranteed electrical
pulse width: network latency can lengthen it. Shared extension/retraction
settling runs independently from pulse length. Verify the
duration and wiring on the actual bolt before relying on it.

With momentary outputs disabled, the selected output remains ON. The opposite
output is turned OFF and its released state checked before the new output can
turn ON. Both ON is a fault; both OFF means unknown position. A relay report
does not prove the bolt's mechanical position.

## Momentary feedback

Both outputs are OFF after a completed pulse. Bolt feedback is therefore
**Last acknowledged bolt command (estimated)**. After a successful ON
acknowledgement, the shared settling timer starts and the garage sequence can
advance when that wait finishes, even while the pulse is still ON. The worker
continues to own OFF cleanup and the release check. These reports and waits
do not establish physical position. HomeKit has no separate estimated-lock
state, so its Lock tile displays the commanded result. The web Controller page
identifies the estimate. Initial/restarted state is Unknown, and the next fresh
door operation requests retraction before operating the motor when needed.

Use the coordinated Lock tile for bolt commands. A pulse from another app or a
physical control can happen between reads and escape detection, leaving the
estimate outdated. Observed external active outputs or read failures invalidate
the estimate. No state estimate is restored from disk after a restart.

Discovery, connection checks, commissioning, startup and read-only observation
never pulse the bolt. A new clean startup with both outputs OFF can accept a
fresh operation. An interrupted or faulted separate-relay operation requires
**Check again** after checking the physical mechanism and relay state. That
check performs no movement; the next operation establishes a new command state.

One worker owns both outputs and the garage opener through the entire operation,
including pulse cleanup that overlaps garage movement. It stays busy, with its
unfinished-operation journal set, until OFF is checked. A subsequent opposite
bolt command waits for release before energizing the other output, and closure
is checked again immediately before extension. An uncertain ON is never
retried. OFF cleanup is attempted and checked even after a lost ON reply
or graceful shutdown during a pulse; only idempotent OFF may be retried, up to
three attempts. Failure to establish release holds control and invalidates the
estimate, including when the garage has already started moving. Sudden process or
power loss can prevent software cleanup; hardware auto-release is not assumed.

The legacy maintenance flow that explicitly requires locked relay/position
feedback cannot use a pulse estimate as that proof. It remains held for
momentary bolt profiles. Ordinary read-only checks and current web-admin PIN
updates retain their existing paths.

## Existing installations

The shared **Bolt extension/retraction settling** also applies to single-output
and Homebridge bolt configurations. Opening/closing retraction waits are explicit
overrides, never extra delays. Leave **Override shared settling before opening**
and **Override shared settling before closing** unchecked to inherit the shared
value. Check either box to use its individual wait instead. Existing numeric
waits remain overrides and appear checked, including zero. See
[timing settings](controller-timings.md) for feedback and inheritance behavior.

**Single relay controls lock / unlock** retains the existing one-output mapping,
polarity, feedback and optional Lock tile. Existing saved profiles and approval
hashes do not change. Selecting another relay setup requires selecting its
outputs, saving, and completing setup checks. Changing only the pulse duration
retains an already approved setup, its enabled/disabled choice and both HomeKit
tiles. Save while idle; no Homebridge restart or setup recheck is needed. A
restart still clears the command estimate to Unknown. Changes to either relay,
the connection, single/separate setup, momentary/maintained operation or bolt
control enablement still require setup review. Pulse edits cannot restore a
missing approval or clear an outstanding fault. See the synthetic
[configuration example](../examples/separate-bolt-config.json).
