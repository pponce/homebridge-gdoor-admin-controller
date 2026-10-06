# Device checks in the observation build

This developer build adds real read-only checks. It is **not a cutover release**: movement, HomeKit tiles, keypad input, settings management, maintenance and the new admin installer are not ready. Do not remove HTTP Webhooks tiles or stop the current controller for this build.

The production platform never reads devices at startup. An authenticated explicit probe reads Tailwind and deCONZ once. The new admin's Controller page has a Check connections button per assembly; refresh only reloads plugin inventory. Each device check shows its timestamp and clears old results on failure. It neither commissions nor enables the engine.

## Private setup format for later isolated installation testing

The normal Homebridge configuration contains only credential references. After the plugin has created its own private storage directory, its device credential file is:

`<Homebridge storage>/gdoorandbolt-coordinator/credentials.json`

```json
{
  "example-tailwind-key": "123456",
  "example-deconz-key": "synthetic-deconz-key"
}
```

These values are synthetic. The file must belong to the Homebridge process user, use mode 0600 and be a regular file without additional hard links. Its parent directory uses mode 0700. Neither plugin config nor browser pages receive the credential values. The plugin does not create, enroll, replace or test device keys by writing to devices.

Tailwind uses the six-digit **local control key**, an origin URL without /json, and a zero-based door index. Obtain the key through [Tailwind's instructions](https://gotailwind.zendesk.com/hc/en-us/articles/42573968819725-How-do-I-get-my-local-control-key-for-my-Tailwind-garage-door-controller). Use closing=sensor, opening=timed for this direct connection: the Tailwind open state only means its closed sensor is inactive.

deCONZ configuration must supply the expected gateway ID and bolt endpoint unique ID, resource number, resourceType, modelId and manufacturer. A missing identity field, mismatch or unreachable relay gives a failed check without a hardware write. lockedValue specifies whether relay ON means locked. Use bolt=relay: two relays operating a mechanical bolt still do not provide physical bolt-position sensing.

Homebridge accessory mappings can still be declared but their checks return backend_not_implemented. Timed/position choices that the direct adapters cannot establish produce specific setup guidance, never silently upgrade relay or command evidence to physical position.

The admin uses a separate backend-only copy of the management token and pins the instance UUID, as described in its coordinator-integration.md. Do not loosen Homebridge storage permissions to share that token. No host installer or migration command is provided yet.

## Developer validation without household devices

Run `npm test` in this repository, then `python3 tests/cross_repo.py ../homebridge-gDoorAndBolt-coordinator` in the admin repository. The latter starts the actual management API and device drivers against loopback emulators; no household endpoint or credential is involved. CI also runs Homebridge 2.0.0 with a real child bridge, temporary storage, and those emulators. Browser checks exercise explicit probes through the actual authenticated admin application.
