# Coordinator management API v1

This repository owns the protocol. The admin repository carries the same contract and tests its client against the actual server. Contract status: **development, read-only inventory implemented**.

## Transport and identity

Bind only to `127.0.0.1` in milestone 1. Configure a dedicated local port. Every request, including identity, requires `Authorization: Bearer <token>`. The plugin generates a random token and persistent UUID beneath its Homebridge storage directory, with owner-only permissions. Never place tokens in URLs, logs or browser JavaScript.

The admin backend pins the expected instance UUID after explicit setup. A UUID mismatch, unsupported API version, redirect, oversized response or malformed payload fails closed. Responses use JSON and `Cache-Control: no-store`. Browser Origin requests are rejected: this is a server-to-server API, not an unauthenticated cross-origin website.

## Implemented endpoints

| Method/path | Result |
| --- | --- |
| GET /v1/identity | `apiVersion`, `instanceId`, `pluginVersion`, `mode`, `capabilities` |
| GET /v1/controllers | API envelope plus `controllers` array |
| GET /v1/controllers/{id} | API envelope plus one `controller` |

API envelopes repeat `apiVersion` and `instanceId`; validate both on every response. Identity mode is `development`. Capabilities are exactly `inventory: true`, `settingsWrite: false`, `motion: false`, `maintenance: false`, `keypad: false` in M1. Clients must not infer operational readiness from HTTP 200.

Inventory records contain `id`, `name`, `doorBackend`, `boltBackend`, `exposeBoltLock`, `feedback` (closing, opening, bolt), and `status`. Feedback contains modes only, never device URLs/IDs, secret references or credentials. M1 status is `phase: not-commissioned`, `door: unknown`, `bolt: unknown`, `actuationEnabled: false`. No hardware is sampled.

Errors are `{ "error": "<fixed_code>" }`: 401 `unauthorized`, 403 `origin_not_allowed`/`host_not_allowed`, 404 `not_found`, 405 `read_only_milestone`, 500 `internal_error`. Error messages never include supplied URLs, credentials or exception text. No motion, configuration-write or maintenance route exists yet.

## Reserved future operations — not implemented

- Controller configuration read/review/apply with revision conflicts and secret redaction.
- Explicit commands with controller ID, source, request ID and operation outcome; never automatically retry an ambiguous write.
- Fresh, scoped virtual-keypad outcomes without the entered PIN; persist duplicate suppression and prevent replay after restarts.
- Durable maintenance preflight/pause/verify/resume/complete; no acknowledgement until an operation actually succeeds.
- Bounded event history and health reflecting actual hardware freshness and reachability.

Preserve the existing settings, keypad and maintenance behavior in the new standalone administrator's coordinator adapter. The owner will stop the old administrator at cutover; adapting that installation is not required. Transport loss must retain a maintenance hold or unknown operation, not imply successful resume. Capabilities are enabled only with implemented, tested behavior.
