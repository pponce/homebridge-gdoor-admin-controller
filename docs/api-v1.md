# Coordinator management API v1

This repository owns the protocol. The admin repository carries the same contract and tests its client against the actual server. Contract status: **development, read-only inventory and explicit device checks implemented**.

## Transport and identity

Bind only to `127.0.0.1` in milestone 1. Configure a dedicated local port. Every request, including identity, requires `Authorization: Bearer <token>`. The plugin generates a random token and persistent UUID beneath its Homebridge storage directory, with owner-only permissions. Never place tokens in URLs, logs or browser JavaScript.

The admin backend pins the expected instance UUID after explicit setup. A UUID mismatch, unsupported API version, redirect, oversized response or malformed payload fails closed. Responses use JSON and `Cache-Control: no-store`. Browser Origin requests are rejected: this is a server-to-server API, not an unauthenticated cross-origin website.

## Implemented endpoints

| Method/path | Result |
| --- | --- |
| GET /v1/identity | `apiVersion`, `instanceId`, `pluginVersion`, `mode`, `capabilities` |
| GET /v1/controllers | API envelope plus `controllers` array |
| GET /v1/controllers/{id} | API envelope plus one `controller` |
| POST /v1/controllers/{id}/probe | Explicit read-only hardware check; body `{"instanceId":"<pinned UUID>"}` |

API envelopes repeat `apiVersion` and `instanceId`; validate both on every response. Identity mode is `observation` when diagnostics are available, otherwise `development`. Capabilities are `inventory: true`, `diagnostics: true` (or false when no probe provider is installed), `settingsWrite: false`, `motion: false`, `maintenance: false`, `keypad: false`. Older M1 responses omit diagnostics, which clients treat as false. Clients must not infer operational readiness from HTTP 200.

Inventory records contain `id`, `name`, `doorBackend`, `boltBackend`, `exposeBoltLock`, `feedback` (closing, opening, bolt), and `status`. Feedback contains modes only, never device URLs/IDs, secret references or credentials. M1 status is `phase: not-commissioned`, `door: unknown`, `bolt: unknown`, `actuationEnabled: false`. Inventory never samples hardware. Only an explicit probe does; its observations do not commission the assembly or enable actuation.

Errors are `{ "error": "<fixed_code>" }`: 401 `unauthorized`, 403 `origin_not_allowed`/`host_not_allowed`, 404 `not_found`, 405 `read_only_milestone`, 400 `invalid_request`, 409 `instance_mismatch`/`probe_busy`, 500 `internal_error`. Probe bodies are limited to 1 KiB, have a two-second receive deadline, require JSON content type, and must match the pinned instance before hardware is read. Error messages never include supplied URLs, credentials or exception text. No motion, configuration-write or maintenance route exists yet.

## Reserved future operations — not implemented

- Controller configuration read/review/apply with revision conflicts and secret redaction.
- Explicit commands with controller ID, source, request ID and operation outcome; never automatically retry an ambiguous write.
- Fresh, scoped virtual-keypad outcomes without the entered PIN; persist duplicate suppression and prevent replay after restarts.
- Durable maintenance preflight/pause/verify/resume/complete; no acknowledgement until an operation actually succeeds.
- Bounded event history and health reflecting actual hardware freshness and reachability.

Preserve the existing settings, keypad and maintenance behavior in the new standalone administrator's coordinator adapter. The owner will stop the old administrator at cutover; adapting that installation is not required. Transport loss must retain a maintenance hold or unknown operation, not imply successful resume. Capabilities are enabled only with implemented, tested behavior.

## Read-only probe result

The response envelope contains `probe`, with exactly:

- `controllerId`: requested controller ID.
- `checkedAt`: UTC ISO timestamp with milliseconds; the time of this explicit observation, never an ongoing freshness guarantee.
- `door`: `state` closed/not-closed, `feedback` closed-sensor, `blocked` boolean and `error` null on success. Tailwind open means not-closed, never fully open. On failure: unknown/unavailable/null and a fixed error code.
- `bolt`: `state` locked/unlocked, `feedback` relay and `error` null on success. This is a relay indication, not sensed bolt position. On failure: unknown/unavailable and a fixed error code.
- `limitations`: zero or more of tailwind_open_requires_estimate, tailwind_closed_sensor_available, deconz_relay_is_not_position, door_blocked, bolt_extended_with_door_not_closed.
- `compatible`: true only if both device reads succeeded and limitations is empty. This means that the declared direct-device connection and feedback modes passed the check, not readiness for movement or migration.
- `actuationEnabled`: always false.

Device errors are limited to credentials_unavailable, credential_reference_missing, backend_not_implemented, tailwind_credential_invalid, door_read_failed, door_response_invalid, bolt_credential_invalid, bolt_identity_configuration_required, bolt_read_failed, bolt_gateway_identity_mismatch, bolt_resource_identity_mismatch, bolt_unreachable, bolt_response_invalid, device_probe_failed. Never include raw device responses, endpoints, secret references or credential values.

Tailwind and direct deCONZ probes are implemented. Homebridge accessory probes return backend_not_implemented. Tailwind performs one local dev_st POST using the TOKEN header; deCONZ performs only GET /config and GET /lights/{id}. Drivers default to read-only. No startup check, inventory refresh or probe can send a door_op or relay PUT. One probe per controller may be in progress; overlapping requests fail without queuing. Hardware requests have total deadlines, bounded responses and no redirects or retries. The administrator allows twelve seconds for a probe response.

The admin exposes this through its authenticated, Admin-only Controller page. Its built-in POST_READ route selects a controller and bypasses mutation guards only for this read; external extensions cannot register that route class. Existing gateway-write, keypad and maintenance guards remain enforced. Browser requests retain same-origin, CSRF and account checks. Opening or refreshing the page does not probe devices; pressing Check connections does. Each result replaces any previous result and includes the observation time.
