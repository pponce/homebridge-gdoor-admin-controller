# Migration and coexistence

Not an executable migration procedure. The operational plugin and compatibility adapter are not complete.

## Owner's chosen target

Install the coordinator through Homebridge. Use Tailwind's local API for the opener and direct deCONZ for the bolt. Use the new combined Garage Door accessory and the optional new Lock accessory. Keep the current administration URL and interface available. A move to the new standalone admin is optional and separate.

## Does the current administrator continue working unchanged?

Not in full. The current generic deCONZ functions belong to the standalone administrator, but its registered controller extension still reads legacy settings, operates the old systemd service, participates in maintenance and routes virtual-keypad outcomes. Some gateway writes invoke that participant. Leaving the old extension attached after disabling the old controller is not a supported cutover.

Supply a compatible extension adapter before activation. It keeps the old interface and replaces those controller operations with calls to the plugin. Keep the original source repository untouched; deployment of the new adapter is an explicit host change with a rollback record. Verify the complete registered contract, not only a status page.

## Can both administrators run in parallel?

They can be staged with separate ports, state stores, sessions and credentials. Initially retain one management writer and make the other read-only. The current app contains writer ownership, protected identities, local transaction recovery and extension obligations. Two installations must not independently stop services, rotate credentials, restore databases, consume/replay keypad events or overwrite settings.

Full concurrent management requires shared authority/revision handling, coordinated gateway maintenance and single delivery of keypad outcomes; it is a later acceptance gate, not a claim made by showing two working pages. Both interfaces can eventually manage the same plugin through its single configuration API, but that alone does not coordinate their deCONZ maintenance.

## Ordered cutover

1. Inventory current configuration, device identities, inputs, HomeKit dependencies and original tiles; create one verified rollback baseline.
2. Install the completed plugin in non-actuating commissioning mode. Read-only validation must not pulse, unlock, arm or move anything.
3. Stage the compatible current-admin extension and verify identity, settings, keypad and maintenance behavior without delivering movement twice.
4. Pause the old controller and automatic input paths. Transfer exclusive movement ownership, then activate the new coordinator.
5. Commission the new combined garage and lock accessories. New plugin/bridge identities can create new HomeKit accessories; do not promise automatic preservation of the old tile IDs, scenes or automations.
6. Verify physical operation and state, supported interruptions, manual bolt policy, restart recovery and current-admin operation.
7. Redirect remaining HomeKit references, then remove the two obsolete HTTP Webhooks accessory definitions. Do not uninstall Webhooks if other accessories still need it.
8. Move to the new administrator later if desired. Keep the other interface read-only until concurrency is specifically supported.

Do not leave two active movement engines commanding the same assembly. Retain the old package/configuration for a deliberate rollback without allowing it to issue parallel commands. Installing the new package alone does not authorize removing working accessories.
