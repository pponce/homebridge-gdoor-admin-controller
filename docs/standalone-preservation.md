# Preserved standalone controller and web administrator

The owner explicitly wants a working alternative for installations without Homebridge. Keep the original Python web administrator and standalone controller available alongside development of the integrated Node.js Homebridge plugin.

## Source snapshot
- Repository: pponce/garageDoorController.
- Preservation branch: standalone-preserved-2026-10-07.
- Exact commit: a47fa4db3a12e5239d447ee4c5213c59eeb81542.
- The snapshot retains the original web UI, backend, controller, deployment scripts, dependency declarations, integrity checks and tests. No private runtime files were copied into this repository.
- Its controller and web application source match tested revision ec1198eaae4b932eebfd01641c3cc244c1a2efd9. GitHub comparison shows only notes and a read-only deCONZ startup analyzer/tests changed afterward.
- Passing reference checks: Garage administration 37564504183 and HTTP Webhooks Plus migration checks 37564504348. These are source/fixture results, not a new installation or guarantee of physical behavior.

## Maintenance boundaries
Develop the Node.js port in homebridge-gdoor-admin-controller. Retain the standalone Python server and deployment tooling in garageDoorController, with its current UI/UX and separate operating model.
Do not remove the original repository, rewrite its public interfaces to depend on the Homebridge plugin, or retire its installers as part of the Node.js port.
When a shared UI/domain bug is fixed, evaluate and document applicability to both implementations. Run the standalone regression checks for standalone changes.
The companion extracted administrator at pponce/homebridge-deconzKeypadAlarm-admin remains preserved as source/reference too.

## Future standalone cutover
Returning to standalone operation is a separate, explicit deployment task: inspect saved host configuration and the pinned deployment instructions, verify dependencies, and ensure the Homebridge coordinator and old standalone coordinator do not act concurrently on the same door.
No installed files, accounts, gateway PINs, system services or hardware were changed by creating this snapshot.
This preserves source and its known validation history. It does not claim to be a complete machine image, secret backup, or new live acceptance test.
