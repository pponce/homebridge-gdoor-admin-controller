# Preserve the Homebridge deCONZ alarm credential

## Owner requirement

The owner clarified on 2026-10-07 that this PIN is the credential used by
homebridge-deconz to operate its HomeKit Security System accessory: Away, Home
(Stay), Night and Disarm. Retain the ability to select the deCONZ user/alarms
and keep that credential aligned when the selected user's PIN changes.

This is separate from HTTP Webhooks and the garage controller. Removing the
HTTP Webhooks controller dependency does not remove this alarm feature. Do not
replace the existing alarm tile or require this plugin to publish a duplicate.
The gateway API key, alarm-user PIN and web-account password are distinct.

Preserve the existing protection of a selected Homebridge user's required alarm
grants, Admin/Regular permissions, review/confirmation and interrupted-change
recovery. Do not report synchronization when only the deCONZ side succeeded.
Never send an arm/disarm command merely to test a credential or configuration.

## Verified reference and candidate replacement

The original adapter in configurator/homebridge.py at extracted-admin commit
45e26c1d586bdcfa22b3b3b486485ba78ee4db6e stops Homebridge, edits the scoped cached
alarm PIN and verifies a restart. It is a separate adapter from the controller
extension. Its source and installed standalone application remain unchanged.

Upstream homebridge-deconz main was verified at
0c7fb9067618353ed6f8402ad1615eaba0e5b0f5, version 1.3.5:

- [AlarmSystem.js](https://github.com/ebaauw/homebridge-deconz/blob/0c7fb9067618353ed6f8402ad1615eaba0e5b0f5/lib/DeconzService/AlarmSystem.js)
  uses the stored pin as code0 for HomeKit-triggered alarm target commands.
- [DeconzAccessory/index.js](https://github.com/ebaauw/homebridge-deconz/blob/0c7fb9067618353ed6f8402ad1615eaba0e5b0f5/lib/DeconzAccessory/index.js)
  exposes the PIN in detailed settings and accepts pin in onUiPut.
- [cli/ui.js](https://github.com/ebaauw/homebridge-deconz/blob/0c7fb9067618353ed6f8402ad1615eaba0e5b0f5/cli/ui.js)
  documents dynamic accessory settings and targets the settings endpoint.
- The upstream README describes dynamic settings as effective immediately and
  persisted across restarts. homebridge-lib 8.1.5 stores delegate values in
  accessory context and periodically flushes cached accessories. A successful
  live readback alone does not prove an immediate durable flush.

The supported configuration API is a candidate for the integrated implementation;
it is not yet connected or accepted as a complete replacement. Validate identity
and alarm mapping, restart persistence, partial-update recovery and privacy first.
In particular, the ordinary characteristic setter can log old/new values; simply
issuing a PIN PUT is insufficient without validating that credentials stay out of
logs. Do not patch Homebridge or another plugin, copy the old private-cache writer,
or claim an unsupported operation succeeded.

## Current port status

The original frontend assets, including the Homebridge credential workflow, are
retained. Their temporary removal was reverted before the history/keypad commit.
The backend has optional integration ports, but an actual alarm-PIN integration
adapter is still outstanding. Restoring frontend source is not implementation or
physical acceptance of this feature.

## Supported API limitation confirmed during lifecycle integration

The supported PUT handler in homebridge-lib Platform logs the JSON request body
at debug level before calling the plugin handler. DeconzAccessory.Gateway logs
the body again at debug level. CharacteristicDelegate's ordinary setter logs
both the new and old values before storing the PIN in context. A supported
accessory logLevel change can suppress the last of these, but does not by itself
establish that the platform request log is suppressed. Delegate's default
platform log level is 2; no platform logging/redaction setting is exposed by
DeconzPlatform.onUiRequest. Merely muting the alarm accessory is insufficient.

The library's default saveInterval is 3600 seconds. Its periodic flush and
shutdown flush are distinct from the successful dynamic-setting response. No
supported immediate flush/verified restart route was found in this UI API.
Do not restart deCONZ hardware, remove/re-expose an accessory, edit another
plugin's cache, or infer durable success from a timer to work around this.

These findings block automatic PIN synchronization in the current supported
adapter design. The next product choice is a clearly limited observe-only
preview, or holding the owner release until this integration can meet the
requirements. This does not authorize dropping the feature from the full build.
