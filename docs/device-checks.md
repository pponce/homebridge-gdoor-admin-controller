# Device checks and feedback

The operational test build keeps checks separate from enabling a garage. An uncommissioned profile makes no startup hardware requests. Discovery and explicit probes read identities/current values without actuator writes. A commissioned profile also observes devices during operation. Use [owner-test.md](owner-test.md) and the validated revisions in [status.md](status.md) for installation.

Homebridge settings provides device discovery, private connection-key entry and **Check connections**. The separate administrator also provides explicit connection checks. A successful check establishes the reported evidence and identity at that time; it does not prove wiring, physical bolt position or permission to take over from the old controller. Enabling is a separate, explicit step after ownership and physical review.

## Private credentials

Save keys by name in Homebridge settings. Normal configuration stores only references. The plugin stores the actual values in:

`<Homebridge storage>/gdoorandbolt-coordinator/credentials.json`

```json
{
  "example-tailwind-key": "123456",
  "example-deconz-key": "synthetic-deconz-key",
  "example-homebridge-pin": "031-45-154"
}
```

These values are synthetic. The file belongs to the Homebridge process user, uses mode 0600 and must be a regular file without additional hard links. Its parent directory uses mode 0700. Saved credentials are never returned to the browser. Changing a key pauses commissioning for review. The plugin does not create or enroll device API keys.

## Backend evidence

Tailwind uses its six-digit **local control key**, an origin URL without `/json`, and a zero-based door index. Obtain the key through [Tailwind's instructions](https://gotailwind.zendesk.com/hc/en-us/articles/42573968819725-How-do-I-get-my-local-control-key-for-my-Tailwind-garage-door-controller). Use closing=sensor, opening=timed for this direct connection: Tailwind's open state means its closed sensor is inactive, not that travel is complete.

deCONZ mappings pin the gateway ID and selected resource identity, model and manufacturer. Discovery supplies the mapping for review. Verify which relay state means locked and use relay feedback for the owner's bolt. Two relays operating a mechanical bolt do not supply physical bolt-position sensing. The Aqara opener output is a separate named motor path; check its pulse lengths and released state independently.

Homebridge mappings use the source bridge's HAP accessory port and privately stored PIN, with unpaired accessory control/insecure mode enabled. Discovery pins the bridge identity, accessory fingerprint and service. Supported services include GarageDoorOpener, LockMechanism, Switch/Lightbulb and supported button inputs. Choose feedback according to what the upstream plugin actually reports. A fresh read of a cached upstream value does not prove a fresh physical observation. Motor relays require real level ON/OFF and idempotent OFF release; toggle-only endpoints are unsuitable.

Position, relay and timed evidence remain distinct. Independent open/close travel times mitigate command-only garage feedback by producing an estimate. Bolting after estimated closing needs an explicit policy; elapsed time cannot prove closure. Timer-only bolt feedback is not supported in this build. A missing identity, mismatch, unreachable device or unsuitable feedback mode fails the check with setup guidance.

The administrator uses a private backend copy of the management token and pins the instance UUID. Installation preparation provisions it; do not loosen Homebridge storage permissions to share the token.

## Validation without household devices

Run `npm test` here, then `python3 tests/cross_repo.py ../homebridge-gDoorAndBolt-coordinator` in the admin repository. The cross-repository suite starts the actual management API and drivers against loopback emulators. CI also runs Homebridge 2.0.0 in a real child bridge, exercises HAP open/close with the expected bolt sequence, tests the actual custom settings server and runs desktop/mobile browser checks. None of these checks use household endpoints or credentials.
