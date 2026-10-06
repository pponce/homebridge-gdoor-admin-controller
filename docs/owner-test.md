# Owner installation and supervised test

Use the revisions marked as passed in status.md. This is an initial owner test, not physical acceptance or an npm release. No changes have been made to your existing installation by this repository.

## Install the coordinator first

Requirements: Homebridge 2, Node 22/24, same-host access for the separate administrator's authenticated loopback API, and the Tailwind local control key plus a deCONZ API key with access to the selected devices. Keep the coordinator in its **own child bridge**, separate from homebridge-deconz: administration maintenance may restart the deCONZ child bridge while the coordinator must remain reachable.

After version 0.4.1 is published to npm, install it using Homebridge's managed plugin command:

```sh
sudo hb-service add homebridge-gdoorandbolt-coordinator@0.4.1
```

On installations without hb-service plugin management, use the Homebridge UI's npm plugin installer. Source/tarball installation remains available for development: clone the repository, run `npm pack --ignore-scripts`, then install `homebridge-gdoorandbolt-coordinator-0.4.1.tgz` into the same npm prefix used by Homebridge.

For Docker/custom prefixes use that installation's package workflow. Do not create a plugin systemd service: Homebridge owns its process. Add a GDoorAndBoltCoordinator platform, enable its child bridge, and restart that child bridge. A newly installed profile makes no hardware requests until an explicit check; no profile can actuate until enabled.

Open **Settings** for the coordinator. The custom screen provides:

1. **Connection keys:** save the Tailwind six-digit local key and deCONZ API key under private names such as garage-tailwind and garage-deconz. The actual values never enter config.json, Git or the browser after submission. [Tailwind key instructions](https://gotailwind.zendesk.com/hc/en-us/articles/42573968819725-How-do-I-get-my-local-control-key-for-my-Tailwind-garage-door-controller).
2. **Devices:** add your garage. Select Tailwind, its local URL and zero-based door index. Discover/select the bolt's deCONZ output and verify its ON/locked mapping. Keep the optional Lock tile enabled if wanted.
3. **Inputs:** add the existing Aqara opener relay as a separate motor path. It must be a different output from the bolt. Set its actual open/close pulse lengths. Add the indoor button and physical keypad by discovery; assign both to the opener relay. For the keypad, select its enrolled alarm. Link the virtual keypad to that same alarm. HomeKit and virtual keypad remain on Tailwind.
4. **Behavior:** for Tailwind use sensor-confirmed closed and estimated fully open. For your deCONZ bolt use relay feedback, not physical-position feedback. Transfer your existing travel, retraction, settling, pulse and per-input timing values; do not assume the example defaults match your door. Enable indoor stop/reverse only after verifying the opener's pulse sequence.
5. **Review changes**, save, then **Check connections**. No check moves the door. Do not enable the garage yet if the old controller or its physical-input services are still active.

After first start, private profiles.json is the shared configuration authority. The Homebridge screen and standalone admin both edit it with revision checks. Credentials, journals and identity live under the Homebridge storage directory in `gdoorandbolt-coordinator`. Back up that directory privately with the normal Homebridge backup; do not commit it. Replacing a connection key pauses commissioning and requires checks/enabling again.

## Existing Homebridge devices (optional)

For another installation, choose the bridge or child bridge's **HAP accessory port**, not the web administration port. Save its pairing PIN privately, enable that Homebridge's unpaired accessory control / insecure mode, then discover and select the garage, bolt or input service. The adapter pins bridge identity, accessory fingerprint and service ID. Re-pairing/replacement or changed IDs require rediscovery and review. It does not pair with native HomeKit hardware or intercept existing accessories. A motor relay must implement true level ON/OFF with idempotent release; a toggle command is unsuitable. Direct controls/automations supplied by the original plugin can still bypass the coordinator, so review their use.

## Transfer ownership and test

Install/switch the separate administrator using its owner-test.md. Stop the old movement controller, physical-keypad listener and indoor-button listener before enabling this garage. Also stop any independent rule/automation that drives the same outputs; only one coordinator may own an assembly. Keep the original installation available for rollback.

With the physical door closed, bolt wiring checked and opener relay released, acknowledge the two checks and choose **Enable this garage**. Enabling performs identity/current-state checks and clears an acknowledged old operation hold; it sends no actuator command. Pair the coordinator child bridge in Apple Home using Homebridge's QR code. The new combined Garage Door and optional Lock tiles have new identities, so scenes/automations may need remapping.

Perform these tests while observing the mechanism:

- Combined tile open: bolt retracts, configured delay elapses, then Tailwind opens. Full-open is an estimate.
- Combined tile close: bolt stays retracted during travel, closed sensor is stable, then bolt extends.
- Bolt tile: unlock leaves the closed door unlocked; automatic idle polling must not immediately relock it. Explicit lock requires suitable closed evidence.
- Virtual keypad accepted disarm opens through Tailwind; a rejected code requests close. Busy/expired results are ignored.
- Physical keypad and indoor button use the Aqara opener relay, with OFF/released after every pulse. Confirm their individual delays. If configured, verify indoor stop-opening and reverse-closing; a partial stop is estimated and only that control may continue its close.
- Restart while stationary: no movement. An interrupted movement, ambiguous device write or partial-stop restart must hold for physical review, with no replay.
- New admin: preserved accounts/roles, virtual keypad, editable settings, activity and a normal deCONZ setting change. For Homebridge/PIN maintenance follow the existing preparation, bolt-test and stillness prompts; while paused, use the direct deCONZ output control for the physical bolt test (the coordinator’s Lock tile also stays paused); confirm the coordinator remains paused until completion.

On a hold, inspect the mechanism first. Recovery is an explicit re-enable with a physically closed door and released relay; do not repeatedly press commands or assume relay state proves bolt position. A timer-only closer cannot prove physical closure even when estimated bolting is enabled.

After both HomeKit and physical operation pass, retire only the two obsolete HTTP Webhooks accessory definitions and remap their automations. Keep HTTP Webhooks if unrelated accessories still need it.

## Rollback

Stop the coordinator child bridge and the new admin services first. Confirm the mechanism is stationary and review any deCONZ/settings changes made during testing. Restart the old admin and its movement/input services only after the coordinator is stopped. Do not automatically restore stale gateway data or replay transactions. Remove the new accessories only when no longer needed; preserve their private state for diagnosis. Final cleanup of the original installation is a separate owner decision.
