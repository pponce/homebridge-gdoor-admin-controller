# Migration to the coordinator and new standalone administrator

Decision updated 2026-10-06: the owner will switch to the new administrator and stop the existing one when ready. Both packages may remain installed, but the owner will use one administrator at a time. Supporting simultaneous administrators or adapting the old web installation is not required for phase 1.

The owner's target uses Tailwind local API for the door and direct deCONZ for the bolt, with this plugin's combined Garage Door and optional Lock accessories. The administrator remains a separate application with its own URL.

## Ordered cutover when both projects are ready

1. Inventory current settings, accounts, device identities, inputs and HomeKit references; preserve one verified rollback baseline.
2. Install the completed plugin in non-actuating commissioning mode and validate its connections without moving hardware.
3. Install the new standalone administrator, stop the existing administrator and its controller extension, and transfer reviewed application state. Verify controller settings, virtual keypad and maintenance through the new integration.
4. Stop the old movement controller and automatic input paths before activating the new coordinator.
5. Commission physical opening, closing, bolting, manual overrides, input behavior and restart recovery with the owner.
6. Confirm the new combined garage and lock tiles, rebind scenes/automations as needed, then remove the obsolete HTTP Webhooks garage/bolt entries. Retain Webhooks if other accessories use it.
7. Retain the stopped original installation for a bounded rollback window, then carry out the agreed final cleanup.

The old movement engine and new coordinator must not command the same assembly concurrently. This requirement is separate from whether both web applications remain installed.

This document is not an executable migration procedure. Hardware drivers, the coordination engine, HomeKit accessories and complete administrator integration must be validated before the owner tests the two projects on the live setup.
