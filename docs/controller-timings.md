# Controller timing settings

Open **Controller** in the web administrator and select a garage. Administrator accounts can view it; changes require Manage access. Demo mode cannot call the live controller. Creating controllers, changing hardware, input actions, feedback modes and enabling a controller remain in the Homebridge configuration UI.

**Controller defaults** contains opening/closing travel times, pre-movement bolt retraction waits, closed stability and bolt extension settling, active/idle polling, timeouts and the interrupted-opening margin. These defaults apply to HomeKit, the virtual keypad and physical inputs without overrides. Travel times remain estimates when the selected feedback mode is timed.

**Device timing overrides** lists the configured physical buttons, switches and keypads. Each of the four supported overrides has an explicit **Use default** checkbox. Clearing an override removes it from the stored input profile; an explicit zero-second retraction wait remains zero. Each input also exposes its rearm wait. **Motor relay pulses** edits the separate opening and closing pulse duration for configured motor paths.

Review timing changes, then Apply timings. The coordinator rejects stale revisions, active movement, active input jobs, unfinished interrupted movement and maintenance. It validates the entire resulting configuration but accepts only the timing fields and existing device IDs. The save cannot alter a hardware connection, feedback mode, input action or enabled/commissioned state.

The timing-only operation persists through the same private profile store used by Homebridge and updates the existing engine, input router and pulse drivers without rebuilding them. Existing HomeKit pairing, manual unlock overrides and fault state remain intact. Changes apply on the next operation; no device command is issued by saving. The ordinary full-profile review/apply API retains its existing commissioning requirements.

The browser reports success only after a successful save response. A lost or uncertain response requires Reload saved timings before another save; it never automatically resubmits. Reload also resolves stale revisions from another browser or the Homebridge configuration UI. After a storage error the coordinator's existing storage-fault hold remains in effect.

Browser routes are GET /api/controller and POST /api/controller/timings. They use the existing authenticated session, strict Host/Origin and CSRF checks, administrator authorization and Manage-access requirement. The read response contains timing values, device labels and status only, without connection addresses or credential references. The local management API's full-profile contract is unchanged.

From 0.4.27, saving the same validated timing fields through the Homebridge configuration editor also retains setup approval and the saved Enabled choice. Hardware mappings, input actions, feedback modes and other control-policy changes still require separate setup review; the saved Enabled choice is retained while commands wait for that review.

## Troubleshooting

The Controller page shows Tailwind safety lockout separately from the door position and disabled flag. Status refreshes while the page is visible. **Check state now** performs fresh read-only checks; it keeps manual unlock preferences and unresolved faults. **Check again** retains the existing explicit fault-review/reinitialization behavior.

**Restart Tailwind** sends one local reboot request. It affects all doors on that Tailwind device, temporarily holds control and waits for fresh feedback. It neither moves the door nor retries the previous operation. Restart acknowledgement is not proof that lockout cleared; the subsequent read supplies that evidence. An uncertain restart is never automatically repeated.

In Homebridge plugin settings, Tailwind controllers offer optional **Tailwind Lockout** contact and **Restart Tailwind** switch accessories. Both default off. Contact open/triggered means the actual Tailwind lockout flag is active; contact closed means it is inactive. A disabled door is not treated as a lockout. Unavailable feedback is not reported as clear. The restart switch returns off after an explicit request; switching it off does nothing.

After a movement fault, observation continues. Stable confirmed closed feedback restores the position display even while a separate fault holds control. Failed-close timeout and cleared opener-blocked faults may resolve automatically at confirmed closed. This recovery never operates the bolt or motor. Uncertain position after a timeout still uses the existing unavailable HomeKit presentation; Open/Stopped/inferred-obstruction alternatives remain under discussion.
