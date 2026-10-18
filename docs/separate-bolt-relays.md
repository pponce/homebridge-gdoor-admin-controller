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

## Relay mode

- **Relays are momentary — checked:** the hardware handles auto-OFF. No software
  pulse field is shown. The plugin sends ON and retains estimated Locked/Unlocked
  after release, even if the hardware releases before the acknowledgement arrives.
- **Unchecked, Pulse duration · seconds greater than 0:** the plugin sends ON,
  waits the configured 0.1–2 seconds, sends OFF and checks release. New separate
  setups default to 0.2 seconds. Network latency can lengthen a software pulse.
- **Unchecked, pulse duration 0:** no timed OFF. The selected output stays ON until
  released for the opposite command. Relay direction supplies state; both OFF is
  Unknown. Neither relay reports nor command estimates prove physical position.

In every mode the opposite output is released and checked before energizing the
selected output. Both ON is a fault. Hardware momentary mode remembers a single
observed active direction, but external pulses between polls can be missed.
Shared settling determines when garage coordination proceeds independently of
pulse length. Read failures and uncertain commands clear estimates; no uncertain
ON is retried. After restart, momentary position starts Unknown with both OFF.

Existing configurations retain their old behavior: software pulses become an
unchecked box with their saved duration; maintained outputs become unchecked
with duration 0. Select the checkbox explicitly for a hardware-inching board.
The existing JSON `momentary` key still means software pulses; the new optional
`hardwareMomentary: true` selects hardware inching. The editor manages both and
rejects conflicting settings. No automatic mode change occurs during upgrade.

## Software pulse ownership

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
the connection, single/separate setup, software pulse enablement or bolt
control enablement still require setup review. Pulse edits cannot restore a
missing approval or clear an outstanding fault. See the synthetic
[configuration example](../examples/separate-bolt-config.json).
