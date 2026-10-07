# Coordinator management API v1

The coordinator owns this contract; the companion administrator keeps a byte-identical copy. Version 1 supports managed operation as well as the earlier observation-only fixture.

## Transport

Bind only to 127.0.0.1 on the configured management port (default 27773). Every request requires `Authorization: Bearer <token>`. Reject browser Origin headers and nonmatching Host headers. Every successful response repeats `apiVersion: 1` and the persistent `instanceId`; clients pin both. Token/UUID live in Homebridge-owned `gdoorandbolt-coordinator/identity.json` (directory 0700, file 0600). Never expose credentials to a browser, URL or log. No redirects or automatic write retries.

POST bodies are JSON, include the pinned `instanceId`, and contain exactly the fields below. Bodies have a two-second receive deadline and a 256 KiB maximum (probe: 1 KiB). Fixed-code errors use 400/401/403/404/409/500; an error or lost acknowledgement never establishes success. Movement acceptance returns 202; completion is obtained from status. Bounded client deadlines cover the entire response.

## Endpoints

| Method and path | Additional request fields | Envelope result |
| --- | --- | --- |
| GET /v1/identity | — | pluginVersion, mode, capabilities |
| GET /v1/controllers | — | controllers |
| GET /v1/controllers/{id} | — | controller |
| GET /v1/controllers/{id}/state | — | status |
| GET /v1/controllers/{id}/routing | — | routing |
| POST /v1/controllers/{id}/probe | — | probe |
| GET /v1/settings | — | settings |
| POST /v1/settings/review | configuration, revision | review |
| POST /v1/settings/cancel | token | review: {cancelled:true} |
| POST /v1/settings/apply | token | settings |
| POST /v1/commissioning/reset | — | result: {reset:true} |
| POST /v1/controllers/{id}/commission | revision, previousControllerStopped, physicalSetupReviewed, recover | status |
| POST /v1/controllers/{id}/commands | command, requestId, issuedAt, bootId | operation |
| GET /v1/activity | — | events |
| GET /v1/homekit-reporting (optional, 0.4.7+) | — | reporting |
| GET /v1/guard | — | ready |
| GET /v1/maintenance | — | maintenance (null or transaction) |
| POST /v1/maintenance/preflight,pause,verify,resume,complete | transactionId, physicalCheck, gateway | acknowledged |
| POST /v1/maintenance/prepare | gateway, confirmedClosed | result |
| POST /v1/maintenance/confirm | kind (bolt/still), token, confirmed | acknowledged |
| POST /v1/controllers/{id}/keypad-begin | gatewayId, alarmId | receipt: {token} |
| POST /v1/keypad-after | token, outcome, mode, elapsed | result: {note} |

Each comma-separated maintenance action is its own final path component. Capabilities are inventory, routingInventory, diagnostics, settingsWrite, motion, maintenance and keypad. The running platform advertises `mode: managed`; per-controller actuation still requires commissioning. Observation fixtures advertise false operational capabilities. Never infer actuation from a successful identity or probe response.

## State and observations

Inventory contains id, name, doorBackend, boltBackend, exposeBoltLock, feedback and status. Operational status contains controllerId, bootId, commissioned, actuationEnabled, held, inputStates, state and revision. State reports phase, door, bolt, busy and fault, with target, openEstimated, closeEstimated, externalUnlockOverride, unavailable and obstruction when known. An estimate is not physical position. Faulted/stale HomeKit characteristics report communication failure; known obstruction is published. The poller reads commissioned devices; inventory simply returns the latest status.

Routing contains controllerId, builtins (`homekit: primary`, `virtualKeypad: primary`), motorPaths, inputs and runtimeEnabled. It excludes URLs, device identities and key references. Physical source adapters consume only eligible live notifications, never snapshots/startup/reconnect history. Homebridge events have receipt freshness, not provable physical event age.

An explicit probe reads devices but never writes. Its result contains controllerId, checkedAt, door, bolt, limitations, compatible, actuationEnabled:false. Door contains state, feedback, blocked and error; bolt contains state, feedback and error. Direct Tailwind evidence is closed-sensor (closed/not-closed); direct deCONZ evidence is relay (locked/unlocked). Homebridge feedback follows the selected supported service and declared sensor/command meaning. A successful check does not commission anything. Failures replace values with unknown/unavailable and fixed errors.

## Settings, commissioning and commands

Homebridge config supplies the initial profiles. After first start, private profiles.json is authoritative for both configuration UIs; neither UI edits the other's files. Settings is {revision,configuration}. Review returns a random token, normalized configuration, revision and requiresCommissioning IDs, expiring after five minutes. Apply consumes the token and compares revisions; changing hardware or behavior removes commissioning for those garages. Cancel invalidates the review. Credential replacement resets commissioning before storing a private key. Credentials themselves are not in settings.

Commissioning requires explicit confirmation that the previous controller is stopped and the physical setup checked, then fresh read-only hardware/identity/relay checks. `recover:true` also acknowledges the interrupted/faulted journal. Commissioning does not move hardware. Timed closing still requires physical closed confirmation; an estimated closure alone cannot prove it.

Commands are open, close, lock or unlock. requestId is 16–64 alphanumeric/hyphen characters, issuedAt is epoch milliseconds within 15 seconds, and bootId must match the current runtime. Persist pending intent before executing. Repeated IDs return duplicate:true and never repeat movement; changed payloads conflict. Retain recent requests for at least their validity window and all pending requests. A new boot rejects old boot IDs; interrupted work becomes unknown/held. No waiting command queue, automatic movement retry or route fallback. The combined garage always goes through the shared worker, including an optional bolt Lock tile.

## Keypad and maintenance

Before deCONZ PIN submission, the admin requests a one-use receipt scoped to gateway/alarm/controller. After deCONZ's outcome, it forwards only accepted/rejected/unknown, disarm/arm_away/arm_stay/arm_night and elapsed seconds. The PIN never reaches this API. The two-second receipt captures eligibility and the operation epoch. Accepted disarm additionally reads the configured alarm's fresh disarmed state; rejected closes. Busy, late, changed-epoch and unknown outcomes do not move anything. Both paths use the primary opener.

Maintenance pause is durable and disables every input. The same transaction ID must verify, resume and complete; pause/complete are idempotent for that transaction. Resume does not release the pause: only complete does. A registered Homebridge maintenance participant requires preparation while closed/locked, then bolt-test and unchanged-door confirmations after its service restarts. Read checks never perform those physical tests. Restart preserves maintenance. Missing/unavailable participants cannot acknowledge completion. Generic admin transaction recovery never repeats an uncertain deCONZ write.

## Optional HomeKit reporting diagnostic

`GET /v1/homekit-reporting` is an authenticated, loopback-only, read-only diagnostic; the ordinary API version and capability contract are unchanged. Older/fixture servers may return 404. Unsupported inspection returns 503 `reporting_inspection_unavailable`; other methods return 405. Administrators do not require this endpoint for operation.

`reporting` has schema 1, optional runtime version strings, connectionInspection (available/unavailable), truncated, tiles, clients and events. Tiles contain controllerId, kind, availability and fields with reported/cached scalar values, HAP status, event support, AID/IID and anonymous subscriber labels. Clients contain anonymous process-local labels, paired booleans, subscriptions and queued events limited to coordinator characteristics, request-in-progress state and socket byte counters. Events hold at most 200 recent GET/error/publication summaries; publication rows include the subscribers present when reporting. Inspection limits client/queue output and reports truncation. Null indicates unavailable information.

No hardware read, HAP GET/SET, event subscription, state refresh, or configuration write occurs on this endpoint. No credentials, pairing identities, addresses or unrelated accessory data are exposed. Guarded HAP internal reads are diagnostic only; unavailable fields must not be interpreted as zero subscribers or successful delivery. A paired subscriber/empty queue/byte-count increase does not establish that Apple Home rendered a value.
