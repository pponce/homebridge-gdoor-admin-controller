# Development status

2026-10-06: initial plan and milestone 1 foundation.

Implemented: combined-profile validation, strict read-only API with persistent local identity/token, a Homebridge platform lifecycle scaffold, and the companion admin's Python client. No hardware connections, accessory publication, engine port, configuration wizard, maintenance adapter, installer, npm publication or live changes.

Source reference for behavior and current-admin coupling: `pponce/garageDoorController` at `7d4e0f04e4ef3631e721e571adb292cf11988e87`. Reviewed current controller/deCONZ bolt documentation and existing extension, settings, registry and writer-fence code. This is a reference, not a claim that historical operational notes all describe today's deployment. No source history or household configuration was copied.

Local validation: 21 Node tests pass on Node 24.19.0; the companion's 11 Python client tests and 5 cross-repository tests pass on Python 3.12.14. The latter launch this repository's real API with synthetic fixtures. `npm pack --dry-run --ignore-scripts` succeeds and includes only the documented package files. GitHub Actions is configured for Node 22/24; its results are separate from these local checks.

Actual Homebridge runtime and physical behavior remain unverified. Next milestone: inventory complete runtime parity and implement Tailwind/direct-deCONZ drivers and the coordinator engine; validate the new standalone administrator with the plugin before owner testing. The owner will stop the existing administrator at cutover; simultaneous-admin management and an adapter for the old interface are no longer migration prerequisites.
