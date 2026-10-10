# Garage recovery, lockout and displayed state

## 0.4.43 permission controls

The physical button/keypad exception below now requires **both**
`motorPaths[].allowDuringOpenerLockout=true` on its relay device and
`inputs[].allowDuringOpenerLockout=true` on the initiating control. Both settings
are available in Homebridge configuration and on the web Controller page.
New installations and new rows default off, including omitted fields.
Persisted pre-permission installations migrate once to preserve the 0.4.42
physical pulse behavior: existing relays and button/keypad relay bindings receive
true only where the new field was absent. Explicit true/false choices, other
settings, enablement and matching commissioning approvals are preserved.
This compatibility migration also applies when skipping earlier releases;
review the displayed permissions after updating. It never enables an input or
controller that was disabled. Newly added rows after migration remain off.

Saving these permissions is idle-only, sends no movement command, and retains
faults and manual-unlock state. It applies to the next fresh physical event.
HomeKit, virtual keypad, generic switches and primary opener routes do not gain
an exception. Both gates are necessary, not sufficient: all existing safety
checks described below still apply. Settings cannot override firmware lockout.

Non-Tailwind adapters do not manufacture a cleared lockout flag. Unsupported
lockout reporting stays null and is identified in troubleshooting. Known blocks,
obstruction, missing feedback and movement failures retain their normal holds.
See [experimental ratgdo](ratgdo.md) for its separate remote-lock semantics.

Behavior introduced in 0.4.41–0.4.42. This is the detailed operating reference, not a claim of installed-host or Apple Home UI acceptance. See also [behavior parity](behavior-parity.md) and [controller timings](controller-timings.md).

## What each signal proves

- Tailwind's closed magnet confirms **closed**. Its other result means **not closed**; it does not establish fully open, movement direction, or stationary position.
- Configured timed opening is an explicit estimate after sensor departure. It is not full-open sensor confirmation.
- Bolt relay feedback establishes relay state, not independent physical bolt position. Position feedback is used only when configured and supplied by a compatible adapter.
- Tailwind lockout and disabled are separate flags. `blocked` combines them. A closed door can still have a locked-out controller.
- No reliable infrared beam signal is available in this installation. Neither lockout nor not-closed identifies a crossed beam.
- The Chamberlain's original beam/force protection operates in the opener independently. This plugin does not disable it or issue a special beam override.
- A command acknowledgement, pulse completion, elapsed timer, HomeKit target or UI label does not prove physical position or lockout clearance.

## Input routes and lockout admission

| Request source | Motor route | Tailwind lockout alone |
| --- | --- | --- |
| HomeKit garage tile | Primary Tailwind directional API | Held |
| Virtual keypad | Primary Tailwind directional API | Held |
| Configured physical button | Its configured route; pulse route qualifies for exception | Allowed only after existing admission and physical-feedback checks |
| Configured physical keypad | Its configured route; pulse route qualifies for exception | Same exception; normal accepted-disarm/PIN/outcome rules remain |
| Configured generic switch input | Its configured route | No new exception |
| Automatic observed-close bolting | Existing coordinated path | No new exception; blocked closure does not enqueue new automatic bolt work |
| Volvo OEM remote / independent OEM control | Outside this coordinator | Not governed by our admission; resulting position is observed |

The exception requires `lockout=true`, `disabled=false`, and a configured pulse motor route. It is scoped to the accepted physical button/keypad operation and its existing same-input interruption sequence. It does not reroute HomeKit to the relay, make a direct relay tile part of the coordinator, or treat an arbitrary request as a physical event.

Fresh one-use input receipts, listener rearming, configured timing, keypad disarm verification, worker ownership, motor identity/idle verification, known start/direction and bolt retraction/settling checks remain. A disabled opener, adapter obstruction, generic undifferentiated block, maintenance/restart hold, storage failure, identity mismatch or unresolved bolt contradiction is not bypassed. There is no queued press or automatic retry.

Idle initialization and observation retain a lockout-only condition independently instead of making it a global fault. If a prior movement or lockout fault already holds the engine, a new physical pulse operation may recover only after fresh stable **closed-sensor** feedback and only for these faults: `door_blocked`, `door_open_timeout`, `door_close_timeout`, `closed_confirmation_timeout`, `interrupted_travel_timeout`, `open_reversed`, `close_reversed`. Other faults never qualify. The command rereads the devices before clearing the eligible fault or operating an output. Not-closed with uncertain direction does not qualify for a recovery toggle.

The fresh physical request is a new operation, not a replay of the failed one. Opening still retracts and verifies the bolt first. The existing configured zero-wait closing policy is retained; this release does not change its checks.

## Inferred obstruction and HomeKit position

`ObstructionDetected` means a detected or inferred movement problem, not a generic unknown state. The raw adapter obstruction and the plugin's inferred obstruction remain separate in troubleshooting.

Inference is set for movement timeouts, failure to confirm stable closure by its deadline, unexpected reported reversal, or Tailwind lockout encountered while the engine is in Opening/Closing. Specifically, the movement fault codes are `door_open_timeout`, `door_close_timeout`, `closed_confirmation_timeout`, `interrupted_travel_timeout`, `open_reversed` and `close_reversed`. A `door_blocked` fault additionally qualifies when lockout is true and the controller was in Opening/Closing.

Idle lockout, startup uncertainty, communication loss, ambiguous command acknowledgement and a deliberate supported same-input stop/reverse do not by themselves create inferred obstruction. We cannot identify whether a failed close was caused by the beam, force protection, an OEM reversal or another cause.

| Evidence after failed movement | HomeKit values from this plugin | Internal meaning |
| --- | --- | --- |
| Fresh not-closed/open feedback and inferred obstruction | Current Open; Target Open; Obstruction true | Display-only not-closed fallback. Internal phase/fault and original target remain; full opening is not newly confirmed. |
| Fresh stable closed-sensor feedback with consistency checks passed | Current Closed; Target Closed; inferred obstruction cleared | Door is closed, even if lockout or an independent fault still holds control. Raw adapter obstruction remains separate. |
| Closed feedback not yet stable | No new confirmed-closed fault recovery report | Continue observation until the configured stability interval passes. |
| Missing/stale feedback or unresolved non-position fault | Unavailable / communication failure as applicable | Do not turn loss of evidence into a new Open/Closed confirmation. |

The fallback does not set `openEstimated`, feed back into route selection, authorize a toggle, extend the bolt, or clear a fault. HomeKit Target Open in this projection is a reporting value; publication never sends an open command.

HomeKit defines CurrentDoorState Stopped (4) as stationary and neither fully open nor fully closed. A single closed magnet cannot establish that after an unexplained reversal. Moreover, Apple Home's rendering is not guaranteed to show the literal word “Stopped”; an older first-hand implementation report shows Open on a badge and Closing in details for Current Stopped / Target Closed. We therefore do not promise that Stopped ends a misleading movement display. Existing deliberate partial-stop reporting remains unchanged. Exact wording/graphics on the owner's iOS version require observation.

## Scenario reference

| Scenario | Coordinator response |
| --- | --- |
| Keypad opens, then Volvo/OEM closes | Idle closed feedback supersedes the old Open target. Publish Closed; existing auto-bolt policy applies only through its normal guards and manual-unlock rules. |
| Beam trips while closing | Opener handles its own reversal. If Tailwind still says only not-closed, direction cannot be reconstructed. On timeout (or lockout during movement), end the active operation and publish the inferred-failure fallback when fresh feedback permits. Do not send another motor command. |
| User reverses using an unobserved OEM control | Indistinguishable from other unexpected movement using closed-only feedback; no invented direction. Same timeout/observation rules apply. |
| Original configured input interrupts its own active pulse operation | Existing same-input stop/reverse logic applies. Other inputs do not gain interruption ownership. A supported intentional interruption alone is not obstruction. |
| Tailwind is locked out; door is confirmed closed | Show Closed and lockout independently. A qualifying new physical button/keypad request may retract the bolt and pulse under the normal checks. Primary Tailwind requests remain held. |
| Tailwind is locked out; prior failure left position uncertain | Continue read-only observation. Do not assume a recovery pulse's direction. The lockout exception does not override the uncertain-position hold. |
| Bolt prevented opening and door stayed in closed-sensor range | Stable closure can correct the display to Closed. An opening fault is not automatically erased merely by closure. A qualifying explicit physical recovery during lockout can begin a fresh checked opening; unrelated bolt faults stay held. |
| A physical pulse appears to fix the door | Read Tailwind again. Do not clear lockout from the pulse or acknowledgement alone. |
| Door eventually closes after timeout | Require fresh stable closed feedback and consistency checks; publish Closed/Closed. Do not automatically bolt during fault recovery. |
| Door is closed but Tailwind remains locked out | Keep Closed and the lockout contact active simultaneously. Lockout is not synonymous with door position or beam obstruction. |
| Tailwind restarts or communication is lost | Invalidate feedback/observe again under existing restart and freshness holds. No movement replay and no fabricated lockout-clear status. |

## Observation, clearing and explicit recovery

Fault observation continues reading door, bolt and motor-relay identity/idle feedback without actuator writes. It preserves manual external unlock and does not enqueue automatic bolting after recovery.

Stable closure can automatically resolve `door_close_timeout`, `closed_confirmation_timeout`, `door_blocked`, and `interrupted_travel_timeout` from a closing operation, provided blocked/adapter-obstruction conditions have cleared. Opening failures, ambiguous writes and identity/bolt/storage holds are not automatically cleared. Stable closure may still correct the displayed position and clear the inferred obstruction without clearing those independent holds.

- **Check state now:** in-place read-only observation. Retains unresolved faults and manual-unlock state; does not rebuild the engine or move hardware.
- **Check again:** existing explicit reinitialization/review flow. Reassesses device state under startup rules; it is not a motor command and differs from in-place observation.
- **Restart Tailwind:** explicit documented local reboot request, one attempt. Idle admission, shared-device feedback invalidation, a ten-second settling hold and thirty-second repeat cooldown apply. An uncertain acknowledgement is not retried. It restarts the whole Tailwind device, including its other doors; it does not move the door or bolt.
- **Tailwind Lockout contact:** optional; contact active/open means the actual lockout flag is true. Disabled alone does not activate it. Unavailable feedback is not a confirmed cleared contact.
- **Restart Tailwind switch:** optional momentary HomeKit control. On invokes the guarded reboot; Off is inert. It is not a persistent device-power state.

Tailwind documents clearing lockout by cycling with another control or restarting. Our independent relay can be that other control when it actually moves the door as required, but neither one pulse nor door movement is treated as proof of clearance. Fresh Tailwind feedback is authoritative for its flag.

## Troubleshooting evidence

Controller → Troubleshooting refreshes the displayed snapshot every three seconds while visible. It includes raw door/bolt feedback and evidence type; controller phase and original target; estimated-position flags; raw/inferred obstruction; Tailwind lockout/disabled/blocked; active and historical faults; manual unlock; auto-bolt pending/configuration; restart holds; input listener state and present eligibility; active motor route and worker state; observation/operation activity; sample age; and committed HomeKit values with availability/publication status.

Reading this admin snapshot does not itself read devices, send hardware commands or enable diagnostic recording. It does not read the native Tailwind HomeKit tile or prove delivery/rendering in Apple Home. “Eligible now” is preliminary admission, not a guarantee that the subsequent fresh physical checks pass.

References:

- [Apple door states](https://developer.apple.com/documentation/homekit/hmcharacteristicvaluedoorstate)
- [Apple obstruction characteristic](https://developer.apple.com/documentation/homekit/hmcharacteristictypeobstructiondetected)
- [First-hand Stopped rendering report](https://github.com/mongoose-os-apps/shelly-homekit/issues/1334)
- [Tailwind lockout guidance](https://gotailwind.zendesk.com/hc/en-us/articles/360020903011-The-door-says-LOCKED-OUT-Tailwind-doesn-t-open-or-close-the-door-How-do-I-fix-it)
- [Tailwind local API](https://github.com/Scott--R/Tailwind_Local_Control_API)
