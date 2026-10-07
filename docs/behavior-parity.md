# Runtime behavior inventory

Reviewed source: `pponce/garageDoorController` at `7d4e0f04e4ef3631e721e571adb292cf11988e87`. Reference files: controller/garage_controller.py, controller/deconz_bolt.py, scripts/garage_service.py, scripts/aqara_button_service.py, scripts/keypad_service.py, and private_extensions/controller/{extension,keypad,runtime,settings}.py. No household configuration, runtime credentials or original Git history was imported. The JavaScript engine is a new implementation tested against the reviewed behavior.

The inventory below describes intended behaviors and implemented test boundaries, not complete equivalence to the original. The first physical tests exposed defects in HomeKit reporting and input admission. The [field-name mapping](settings-mapping.md) records corresponding, missing and new controls. Settings from the old controller are not imported automatically.

Known gaps from the source audit: five configurable notification/reconciliation controls are absent; the original service required two healthy observations after an idle outage while this implementation recovers after one; the original commissioned Aqara input used a polling release gate while this implementation uses a generalized WebSocket listener; timing defaults, accepted ranges and related-field validation are not identical. The 0.4.3 status/input correction does not resolve those additional gaps. Version 0.4.4 adds a fixed bounded garage terminal-notification policy (immediate plus two repeats, two seconds apart), but does not restore the five configurable fields or bolt reconciliation. The old example file is stale for the retired second pre-bolt wait; use the original settings validator and current page when comparing behavior.

| Behavior | Implemented boundary |
| --- | --- |
| HomeKit / virtual keypad use Tailwind; physical controls use the assigned relay | Shared worker, native adapters and real loopback HTTP/WebSocket tests |
| Stop opening / reverse closing through an optional pulse path | Bounded pulse cleanup, partial-travel estimate, same-input continuation, sensor-closure race tests |
| Retract before motion; close refreshes OFF; separate settle delays | Ordered driver tests; never an automatic motor retry or route fallback |
| Closed-sensor departure starts estimated full opening | Tailwind not-closed stays distinct from physical fully-open |
| Stable closed confirmation then one bolt extension and settle | Fresh reads and unexpected-extension correction; timed closing requires explicit estimated-bolting policy |
| Manual external unlock override | Preserved until next operation/restart; no startup auto-bolt |
| Idle outage vs active failure | Fresh idle reads can recover; active failure latches a durable hold |
| Restart during motion or partial stop | No replay; explicit physical review/recommissioning |
| Physical keypad | Enrolled source/alarm checks, live freshness/epoch gate, native deCONZ disarm, no legacy alarm-disarm writes |
| Virtual keypad | Pre-PIN eligibility receipt, two-second expiry, fresh alarm verification, primary motor route, no PIN forwarding |
| Settings / maintenance | Revision-checked shared profiles, durable pause, original transaction hooks, physical confirmations when Homebridge restarts |
| Combined Garage Door / optional Lock | Stable cached UUIDs; SET enters worker; state updates never become commands |

The runtime is connected but starts with every new assembly uncommissioned. Drivers remain read-only by default. Discovery and probes never actuate; automatic bolting is separately admitted only after an observed closure while commissioned. Current release checks and remaining physical acceptance are recorded in status.md. Supported behavior is tested with synthetic devices; this does not establish timings or wiring on the owner's hardware.

## Hardware protocol references

- [Tailwind local API](https://github.com/Scott--R/Tailwind_Local_Control_API): local TOKEN header, dev_st reads, door_op open/close. No stop/reverse command is assumed.
- [Tailwind local control key setup](https://gotailwind.zendesk.com/hc/en-us/articles/42573968819725-How-do-I-get-my-local-control-key-for-my-Tailwind-garage-door-controller).
- Direct deCONZ adapter behavior is taken from the reviewed existing controller: pin bridge/endpoint/type/model/manufacturer, require reachable boolean relay feedback, validate exact write acknowledgement, never retry an uncertain write.
