# Xfinity keypad: entry light, PIN requests and lockouts

These notes record observations from an Xfinity/Comcast URC4450BC0-X-R keypad using the enhanced deCONZ alarm-user implementation and this Homebridge plugin. They are not a guarantee for every keypad or firmware. Last updated: 2026-10-08.

**A digit press, a submitted keypad request, a deCONZ access decision and a garage movement are different events.** The green light alone does not establish which of those happened.

## The green entry light

Observed in physical testing:

- The light comes on with the first digit. Further presses can extend the illuminated period.
- It is an entry indicator, not confirmation that a PIN was accepted, that the controller is ready, or that lockout protection is clear.
- An exact four-digit correct code can be accepted before the light goes out.
- In earlier tests, a correct first four digits followed by extra digits still opened the door. A correct code preceded by extra digits did not. Opening proves an accepted request occurred; it does not establish what any later digits transmitted.
- Waiting for the light to go out separated entries reliably in the earlier wrong-code tests. The light remaining on after success does not prove the keypad will continue submitting requests.

No exact physical light timeout or universal input-buffer behavior is established here.

## Extra digits after a wrong code

**Observed on 2026-09-23:** separate wrong four-digit entries, with the light going off between them, each produced one rejection event. Entering another four-digit burst before the light went out after a wrong entry produced four events.

A continuous 40-press test produced 37 requests: two ordinary rejections, a third request that triggered the then-configured three-request lockout, and 34 blocked requests.

**Inference:** the first three presses accumulated digits, the fourth submitted a request, and each additional press in that continuous entry produced another request. The counts and cadence support this interpretation, but the capture did not contain individual button timestamps, submitted PIN lengths or Zigbee sequence numbers. It did not prove whether later requests contained an extended buffer, repeated contents or another representation.

The supported conclusion is that **extra digits after a rejected entry have produced additional requests**. Do not generalize this to every press while the light is on, or divide request counts by four to infer deliberate code entries.

## Extra digit after a correct code: latest observation

**Observed on 2026-10-08 with plugin 0.4.27:** a correct four-digit PIN started opening the door. One additional digit was pressed while the green light was still on. The door did not stop.

After the light went out, a full incorrect code stopped the door. The tester reported a likely second incorrect entry, then a correct entry that opened the door, followed by an incorrect entry after full opening that closed it. The exact physical transition at the second incorrect entry was uncertain in the report.

The sanitized debug capture contained these five access outcomes, in this order:

| Seconds after capture started | deCONZ outcome | Correspondence with the reported entries |
| --- | --- | --- |
| 4.561 | Accepted | Initial correct code |
| 14.350 | Rejected, not locked out | First later full incorrect code |
| 23.127 | Rejected, not locked out | Second reported incorrect entry |
| 37.558 | Accepted | Later correct code |
| 58.772 | Rejected, not locked out | Final incorrect code |

All five event IDs were distinct. The capture reported no buffer-limit drops and no lockout on the rejection events. No separate accepted/rejected event was attributable to the single extra digit between the first acceptance and the later full-code rejection. The correspondence above uses the reported sequence; there were no operator markers tying each physical press to an event.

**Working hypothesis — not proven:** successful acceptance may finish or reset the keypad's entry handling while the green light remains on briefly. A rejected entry may leave it accepting additional digits that generate more requests.

This could reconcile the earlier wrong-code test with the latest correct-code test. However, absence of an access event does not prove that no radio packet was sent. A request could have been suppressed before becoming an access event, including by duplicate handling. Timing and internal keypad behavior remain unmeasured.

**Do not treat a single extra digit after a successful PIN as a reliable stop command.** The latest test did not establish that behavior, and the earlier broad claim that another digit would stop the door was too strong.

## What the lockout counter counts

The reviewed enhanced deCONZ implementation counts distinct wrong-code requests for an alarm, physical keypad and endpoint. It does not count deliberate four-digit entry sessions or distinct wrong PIN values.

Source-backed behavior:

- A recognized correct PIN clears the failure counter for that keypad when it is not locked out. It does not necessarily reset the retained escalation level.
- Recognized retries with the same Zigbee sequence within the ten-second duplicate window do not add another count or access event.
- During an active lockout, deCONZ skips PIN verification. Correct and incorrect codes can both be blocked, without extending the deadline.
- Configured new-policy defaults are six failed requests within 60 seconds, followed by lockouts of 60, 600 and 1800 seconds, with escalation reset after 3600 seconds of quiet time. Protection is off by default; saved policies take precedence.
- The wrong-code request that reaches the threshold is presented as **Lockout detected**. With a six-request threshold, five ordinary rejection rows followed by that detection can represent six failures.
- **Requests blocked during lockout** counts later requests, not deliberate PIN entries. It cannot identify those requests as correct or incorrect PINs.

The earlier 2026-10-08 incident did show a lockout: five ordinary rejection records, a lockout detection and two blocked requests, despite the tester reporting only two deliberate incorrect entries between accepted opening and the failed reopening attempts. **Exactly how that sequence produced the extra counted requests remains unresolved.** The later successful capture above did not reproduce the lockout. Do not attribute the earlier surplus to entry-light behavior or radio retries without correlated evidence.

## How the garage controller uses outcomes

deCONZ validates the physical keypad credential. The Homebridge controller uses native accepted-disarm/rejected outcomes and fresh device state; it does not receive the entered PIN.

With the optional compatible-relay stop/reverse policy enabled, either eligible outcome from the same keypad can stop its opening operation or reverse its closing operation. A confirmed-closed door still requires an accepted, disarmed-confirmed outcome to open. Freshness, rearming, ownership and device checks also apply; a digit press or access-history entry is not a promise that movement will occur. See [input assignments and keypad stop/reverse](input-routing.md#optional-physical-keypad-stopreverse--0419).

A keypad lockout and the garage's saved Enabled setting are separate. The garage can remain enabled and healthy while deCONZ blocks keypad access. The virtual keypad uses a separate REST authorization path and is not a test of physical-keypad lockout behavior.

## Reading the evidence

The web administrator's **Show debug → Debug** capture records sanitized access outcomes, relative arrival times, event-ID aliases, repeated-event flags and lockout metadata. Optional wrong/valid attempt markers can correlate deliberate entries with outcomes. It does not record PIN contents, individual key presses, Zigbee sequence numbers or controller admission decisions. A zero dropped count means the capture buffer did not overflow; it does not prove every radio transmission was observed.

Activity places each timestamp **above** its entry. A grouped blocked-request row retains its first timestamp and includes its last request time in the detail. An earlier apparent expiry-before-deadline discrepancy came from associating copied timestamps with the preceding rows; no expiry-timing defect was established from that paste.

Remaining questions are whether the accepted-versus-rejected entry difference is repeatable, what happens to an extra digit after acceptance, and which requests produced the original six-failure lockout. No keypad, lockout or movement behavior was changed to write these notes.

## Evidence and implementation references

- [Earlier physical entry-window and lockout observations](https://github.com/pponce/garageDoorController/blob/main/notes/xfinity-keypad-entry.md), recorded 2026-09-23 and updated with the approved defaults on 2026-09-24.
- The 2026-10-08 supervised physical test and sanitized capture summarized above; private identities, PINs and raw household records are not included.
- Reviewed deCONZ [authorization and counting](https://github.com/pponce/deconz-rest-plugin/blob/2b1c75f1de1b4f3fe2085d70364605bd8916f177/alarm_user_store.cpp), [IAS ACE duplicate handling](https://github.com/pponce/deconz-rest-plugin/blob/2b1c75f1de1b4f3fe2085d70364605bd8916f177/ias_ace.cpp) and [access-event projection](https://github.com/pponce/deconz-rest-plugin/blob/2b1c75f1de1b4f3fe2085d70364605bd8916f177/alarm_user_event.h). A source review does not independently verify the binary installed on a particular gateway.
- This plugin's [physical input listener](../src/deconz-input.js), [input routing](../src/input-routing.js), [sanitized debug capture](../src/web-admin-events.js) and [activity grouping](../src/web-admin-history.js).
