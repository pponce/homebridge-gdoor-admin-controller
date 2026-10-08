# Enablement and restart recovery (0.4.27)

Enabled is the saved user choice made after completing setup. Device health and command permission are separate. Reboots, faults, outages, maintenance and timing edits do not disable a garage or erase its setup. Only an explicit Disable changes that choice; deleting a garage removes its records. New garages remain disabled until setup is approved.

Both the Homebridge settings and web Controller page show the saved setting alongside current status, for example Enabled · Device unavailable or Enabled · Fault. Previous fault history is labeled separately. A fault uses **Check again**, not Enable or repeated commissioning. This performs fresh read-only checks for just that controller. It never issues a door/bolt command or changes enablement. A lost check response requires reloading status, not automatic resubmission.

## Startup and current feedback

Startup begins with Checking devices. It reads current device identity, door and bolt feedback, obstruction/blocking flags and motor relay release. Unavailable startup dependencies retry every five seconds without an overall expiry; idle communication loss uses the configured idle poll interval. Commands wait for healthy readings. A previously recorded fault is archived before its journal is cleared. A resolved old fault, including a legacy boolean-only fault record, does not become a current fault just because Homebridge restarted.

| Fresh feedback | Status and behavior |
| --- | --- |
| Closed | Enabled · Ready · Closed; no startup bolting |
| Confirmed open | Enabled · Ready · Open; no startup movement |
| Opening / closing | Enabled · Opening / Closing; observation continues, conflicting commands wait |
| Tailwind not-closed | Enabled · Position unknown; no restored travel estimate |
| Unavailable device | Enabled · Device unavailable; read checks retry |
| Locked bolt while door is not closed, active motor relay, obstruction, invalid feedback or wrong device identity | Enabled · Fault with a specific reason; commands blocked |

The physical problem is checked again on every reboot or explicit Check again. If it is still present, the current fault remains. A fault during an operation stops that operation and requires fresh recovery checks; actuator writes are never automatically retried. A damaged operation record or failed journal write retains a separate hold until repaired and explicitly checked. None of these conditions changes Enabled.

A reboot cannot recover physical position a device does not measure. Tailwind has a closed contact, so not-closed cannot distinguish fully open, partly open or moving. After interrupted travel or a prior ambiguous write, the engine reconciles against fresh feedback; it does not restore timers. A fresh directional Tailwind Close request through HomeKit is allowed when reported available and runs the normal closing safeguards. Relay toggles wait for a confirmed endpoint. No accepted old command, input event or motor pulse is replayed. Reaching an endpoint during this reconciliation does not automatically operate the bolt.

## Configuration and storage

Name and validated timing edits preserve setup approval through both editors. Device mappings, feedback modes, input actions and other control-policy changes require **Setup review**. Replacing credentials retains the user's Enabled choice but requires setup review under the existing credential replacement workflow. These configuration checks are distinct from fault recovery. Disable retains the completed setup, so a later Enable checks fresh state without demanding a physically closed door again. Maintenance remains paused across reboot.

The private profile store migrates schema 1 to schema 2 once. Previously approved garages migrate to Enabled, even if their runtime is currently faulted; garages without saved approval remain disabled. Schema 2 stores the explicit enablement map, configuration approval and last fault independently. Older releases reject schema 2 rather than interpreting retained setup approval as permission to operate an explicitly disabled garage. Do not downgrade by manually removing the schema or enablement fields. This migration does not change HomeKit pairings or other plugins' storage.

Fault history contains only fixed allowlisted reasons and timestamps. Legacy records without reasons are marked as an unidentified previous fault in history. Arbitrary errors, device responses, URLs and credentials are excluded.

## API compatibility

The default v1 response shapes and synchronized `api-v1.md` examples remain unchanged for older administration clients. Send `X-Coordinator-Status: detailed` to request the extended status used by the built-in Homebridge UI. The web Controller page reads the same runtime directly.

Extended fields:

- `enabled`: durable user choice, independent of faults/readiness.
- `configurationValid`: saved setup approval matches the current device mapping and policy. Disable does not remove this approval.
- `actuationEnabled`: current engine availability; it is not the Enabled setting and does not promise every command is valid. Individual commands still enforce movement, feedback, bolt and motor safeguards.
- `health`: current title, explanation and fixed code; `lastFault`: historical reason and timestamp, or null.
- `canRecover`: whether the UI can offer a fresh check now.
- State extensions from 0.4.26 remain: `faultAt`, `reconciling`, `restartCloseAvailable`.

Legacy `commissioned` remains true only when the garage is enabled and its approval is current. New authenticated POST endpoints `/v1/controllers/{id}/recover` and `/v1/controllers/{id}/enable` require exactly `instanceId`, `revision`, `bootId`. They reject stale, busy, stopped or maintenance requests. Recovery cannot enable a disabled or unapproved garage. The web recovery endpoint is `POST /api/controller/recover`, admin-only in manage mode, with `controllerId`, `revision`, `bootId` and the existing session/CSRF requirements.

## Verification

Tests cover durable migration and damaged-state rejection, explicit disable/re-enable, current faults with persistent enablement, history across successive reboots, all reported door states, delayed dependencies, interrupted and ambiguous operations, no replay, storage holds, stale requests, live timing edits and existing physical input/HomeKit behavior. Actual Homebridge child/full restart tests use loopback device emulators. Browser tests exercise the separate status/recovery workflow on desktop and mobile. Automated checks do not establish physical acceptance on the owner's garage; validation receipts are in `status.md`.
