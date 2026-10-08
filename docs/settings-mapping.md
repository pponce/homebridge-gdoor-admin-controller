# Controller field-name mapping

This maps the original web administrator's **Controller** page to the coordinator's custom Homebridge settings screen. It compares field names, not values or defaults. Reviewed on 2026-10-06 against the original source at `pponce/garageDoorController@7d4e0f04e4ef3631e721e571adb292cf11988e87` and coordinator 0.4.2/0.4.3. The runtime fix does not rename these fields.

## Old fields with corresponding plugin fields

| Original Controller page | New plugin field | Where to find it |
| --- | --- | --- |
| Open travel estimate | Full opening travel (seconds) | Behavior → Movement timing |
| Opening · bolt retraction wait | Before opening (seconds) | Behavior → Bolt retraction |
| Closing · bolt retraction wait | Before closing (seconds) | Behavior → Bolt retraction |
| Closed confirmation time | Stable closed confirmation (seconds) | Behavior → Movement timing |
| Bolt extension verify | Bolt extension settling (seconds) | Behavior → Movement timing |
| Bolt state timeout | Bolt timeout (seconds) | Behavior → Polling and timeouts |
| Door travel timeout | Movement timeout (seconds) | Behavior → Polling and timeouts |
| Operation poll | Operation poll (seconds) | Behavior → Polling and timeouts |
| Open relay pulse | Opening pulse (seconds) | Inputs → Additional motor path |
| Close relay pulse | Closing pulse (seconds) | Inputs → Additional motor path |
| Input rearm | Rearm delay (seconds) | Inputs → each Physical control |
| Idle poll | Idle poll (seconds) | Behavior → Polling and timeouts |
| Interrupted open margin | Extra travel after reversal (seconds) | Behavior → Polling and timeouts |
| Indoor button interruption | Button interruption support **and** During movement | Inputs → Additional motor path **and** the indoor Physical control |

Two scope changes matter: **Input rearm** is now separate for each input, and **Indoor button interruption** requires both the motor-path capability and the input's movement policy. Pulse settings are now per motor path. A corresponding field is not proof of exact behavior parity.

## Old fields missing from the plugin

| Original Controller page field | New plugin field |
| --- | --- |
| Garage notification repeats | None |
| Garage notification spacing | None |
| Bolt notification repeats | None |
| Bolt notification spacing | None |
| Bolt reconciliation | None |

The plugin publishes HomeKit state directly, but it does not expose corresponding repeat, spacing or reconciliation controls. Idle poll is not an exact replacement for Bolt reconciliation.

## Plugin fields without an old Controller-page counterpart

Some connection details existed elsewhere in the old commissioning configuration. They were not editable fields on its Controller page. This list groups repeated labels once and includes fields shown only for particular connection choices.

| Plugin area | New or newly exposed field names |
| --- | --- |
| Devices → Garage details | Garage name; Show a separate bolt Lock tile |
| Devices / Inputs → connections | Connection; Saved connection key |
| Devices → Tailwind opener | Tailwind address; Door |
| deCONZ connection | deCONZ address; Gateway identity; Resource number; Endpoint identity; Resource type; Model; Manufacturer |
| Homebridge connection | Homebridge accessory port; Bridge identity; Accessory / service ID; Accessory identity fingerprint |
| Device discovery selectors | Choose a bolt / motor / button / keypad; Homebridge device selection (shown after discovery) |
| Devices → Separate bolt / lock | Relay ON means bolt extended |
| Inputs → Additional motor path | Path name; Relay ON activates the opener; I verified OFF always releases this output, including repeated OFF commands |
| Inputs → Physical controls | Control name; Use this control; Input type; Button event; Switch transition; Action; Motor path; Alarm system number |
| Inputs → Timing for this control | Retract before opening (seconds); Retract before closing (seconds); Estimated opening travel (seconds); Estimated closing travel (seconds) — optional per-input overrides |
| Inputs → Virtual keypad | deCONZ address; Gateway identity; Saved connection key; Alarm number — explicit virtual-keypad connection |
| Behavior → Hardware feedback | Closed means…; Open means…; Bolt feedback; Allow bolting after estimated closure |
| Behavior → Movement timing | Full closing travel (seconds) |
| Behavior → Bolt retraction | Automatically bolt a newly closed door |
| Connection keys | Connection name; API key or local control key |

**During movement** is included in the mapped interruption row above. Its generalized use for multiple controls is new; it is not a second missing old setting. **Button event** is a new editable field: the old page retained release-only activation internally rather than offering a supported press/release selector.

The plugin also has installation/management items outside that settings mapping: **Name** and **Local management API port** in the platform schema; a generated read-only **Controller ID**; read-only **Coordinator API address** and **Private identity file**; commissioning/recovery confirmations; and add/remove/review/save actions. These are setup controls or displayed metadata, not old movement-timing fields.

Historical configuration names `pre_bolt_closed_check_seconds` and `bolt_retract_wait_seconds` were already normalized/retired by the reviewed original controller; they were not additional fields on this version of its Controller page.

## Source of the mapping

Original: `scripts/controller_settings.py` and `private_extensions/controller/static/{app.js,index.html}`. Plugin: `homebridge-ui/public/{editor.js,index.html}`, `src/config.js`, and `config.schema.json`. Runtime differences and validation limits are tracked separately in [behavior-parity.md](behavior-parity.md) and [status.md](status.md).
