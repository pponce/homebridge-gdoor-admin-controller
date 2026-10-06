# Runtime behavior inventory

Reviewed source: `pponce/garageDoorController` at `7d4e0f04e4ef3631e721e571adb292cf11988e87`. Reference files: controller/garage_controller.py, controller/deconz_bolt.py, scripts/garage_service.py, scripts/aqara_button_service.py, scripts/keypad_service.py, and private_extensions/controller/{extension,keypad,runtime,settings}.py. No household configuration, runtime credentials or original Git history was imported. The JavaScript engine is a new implementation tested against the reviewed behavior.

| Existing behavior | New implementation / remaining work |
| --- | --- |
| HomeKit and virtual-keypad garage requests use Tailwind; indoor button and physical keypad use the verified Aqara motor relay | Tailwind driver implemented. Aqara pulse route and input profiles are not implemented. Confirm whether to retain this separate motor route or deliberately use Tailwind for all new-plugin inputs before connecting them. |
| Optional indoor-button stop/reverse is a bounded relay pulse, with verified OFF cleanup and durable receipts | Not implemented. Tailwind open/close support must not be advertised as equivalent to this behavior. |
| One worker, no delayed command queue, no motor retry after an uncertain write | Engine owns an assembly synchronously before any await; competing commands reject; ambiguous writes latch a fault. Not yet exposed by HomeKit/API. |
| Opening retracts if needed; closing refreshes OFF even when already retracted; separate settle delays | Implemented and simulated. Delay applies even when opening starts with an already-OFF bolt. |
| Closed-sensor departure starts estimated opening travel | Implemented. Tailwind open is represented as not-closed, not physical full-open. |
| Stable closed interval, immediate fresh read, one extension, extension-settle interval | Implemented. The old unused second pre-bolt delay is not reintroduced. |
| Unexpected bolt extension while closing gets a bounded corrective OFF, never another motor command | Implemented and simulated, including stuck relay timeout. Original travel deadline remains in force. |
| Idle external unlock lasts until next operation/restart | Engine observes the transition and blocks its automatic-lock entry point. Explicit lock or a door operation resets the override. Scheduling the automatic close-completion operation remains unimplemented. |
| Restart during operation or after fault holds for review, no command replay | Durable journal and engine hold implemented and tested; owner-facing recovery/commissioning not yet connected. |
| Idle device outage can recover after fresh healthy reads; active operation failures remain latched | Automatic idle recovery is not ported yet. Prototype engine currently holds on read failures. Do not claim runtime parity. |
| Physical keypad events are fresh, source/epoch-scoped and baselined on reconnect; native deCONZ owns disarm | Not yet ported. New code must not send legacy controller alarm-disarm writes. |
| Virtual keypad captures eligibility before PIN submission, consumes a one-use receipt, drops busy/stale results | Original admin workflow retained; coordinator protocol delivery is not yet implemented. No PIN may cross that API. |
| Maintenance and settings changes participate in durable holds, with review/recovery | Original admin guards retained; coordinator operations are not implemented and must continue to reject. |

## Production boundary

The Homebridge platform imports only inventory, storage and diagnostics. It does **not** instantiate MovementEngine or StateJournal, publish accessories, or expose motion/configuration-write/maintenance/keypad methods. Drivers default to read-only. The writable paths and engine are exercised only with synthetic hardware in tests. This is an intermediate implementation, not permission to operate the garage.

The new engine also prototypes explicit estimated-closing policy and a bolt-only lock request within an assembly. This does not add standalone bolt/garage modes. Timed bolt feedback, Homebridge accessory transport, durable request deduplication, fault recovery, full input routing and automatic idle recovery remain integration work.

Startup, configuration tests, inventory and state publication must never actuate. Any eventual automatic locking runs as a separately admitted worker operation after commissioning, with manual-unlock and maintenance holds checked. No startup automatic bolting is introduced by this build.

## Hardware protocol references

- [Tailwind local API](https://github.com/Scott--R/Tailwind_Local_Control_API): local TOKEN header, dev_st reads, door_op open/close. No stop/reverse command is assumed.
- [Tailwind local control key setup](https://gotailwind.zendesk.com/hc/en-us/articles/42573968819725-How-do-I-get-my-local-control-key-for-my-Tailwind-garage-door-controller).
- Direct deCONZ adapter behavior is taken from the reviewed existing controller: pin bridge/endpoint/type/model/manufacturer, require reachable boolean relay feedback, validate exact write acknowledgement, never retry an uncertain write.
