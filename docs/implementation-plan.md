# Implementation plan

Decision date: 2026-10-06. Development is authorized; live migration is a later owner-run operation.

## Product and repository boundaries

This is a combined garage-door/bolt coordinator. Every configured controller requires both components. Door connections are existing Homebridge GarageDoorOpener services or direct APIs, initially Tailwind. Bolt connections are existing Homebridge LockMechanism, Switch or Lightbulb services, or direct deCONZ. Any combination is allowed. The plugin owns a combined GarageDoorOpener accessory and optionally a LockMechanism accessory. It does not repurpose or intercept another plugin's accessories.

No native HomeKit pairing, Apple Home automation backend, door-only or bolt-only mode. Additional manufacturer APIs can be added later behind the same driver contract. Excluding native HomeKit control does not require removing an existing Tailwind native tile; this plugin uses the local API.

The current standalone installation stays separate. The new admin repository initially contains a standalone web application, with its own URL and accounts. Converting that application into a Homebridge plugin is deferred. Development here must not silently redirect the current installation or migrate private state.

## Architecture

Run as a Homebridge dynamic platform, preferably in its own child bridge. Homebridge manages the process. Store plugin data, journals, API identity and credentials beneath api.user.storagePath(); never install systemd units or patch other plugins. The Node ESM platform uses Homebridge's injected API, with @homebridge/plugin-ui-utils for its custom configuration server. A commissioned runtime connects the shared movement engine to all supported inputs.

Separate driver connections, state estimation, one coordinator per physical assembly, event/input profiles, accessory publication and the versioned management API. Several keypads/buttons may target one assembly with separate input policies, but do not instantiate competing movement engines. Validate hardware identity and prevent duplicate ownership, including cross-process ownership at deployment.

Existing Homebridge access must support child bridges, bridge-specific credentials, stable service identifiers, current-state reads and event subscriptions. Target state is not current state. Exclude this plugin's own accessories as input devices to prevent cycles. Capability checks determine whether movement/obstruction/stop/reverse semantics are available.

## Feedback and configuration experience

Ask what Closed and Open mean in the upstream integration: physical sensor, not-closed indication, command acknowledgement, or unknown. Offer independent opening/closing travel times, command-to-motion delay where needed, stable-closed interval, operation timeouts, bolt mapping and settling. An extra closed sensor is optional. A user answer declares a policy; it does not prove the driver's state is fresh.

Sensor mode waits for suitable current state, reachability and stability. Timed mode produces explicitly estimated state; time does not establish successful travel. A combined timed-close setup must separately select whether bolting after estimated closure is permitted. Observed obstruction, interruption, reversal or lost connectivity invalidates the estimate. Without feedback, undetected failures remain a stated limitation. Do not invent obstruction state or replay a movement on restart.

Offer an optional plugin-owned Lock tile for both bolt backends. Its SET handler enters the coordinator; feedback updates never call that handler. Existing upstream controls remain independently usable and cannot be intercepted. Preserve the existing paired-relay mechanism: model a logical bolt command, do not infer two independent directions from relay names.

Homebridge's configuration UI and the admin adapter use one plugin-owned profile configuration with revision checks. Bootstrap settings stay in Homebridge configuration. Plan a single migration from the milestone-1 declaration format before profile writes are enabled; do not introduce two competing writable stores.

## Milestones and acceptance

### M1 — Contract and read-only development foundation

- [x] Establish repository scope, migration plan and source provenance.
- [x] Implement combined-controller declaration validation and duplicate declared-resource detection. Discovery must later resolve hostname aliases and connections that reach the same hardware through different backends.
- [x] Implement persistent local API identity/token and authenticated read-only inventory.
- [x] Add Homebridge platform lifecycle scaffold without accessory or hardware side effects.
- [x] Create the matching Python admin client and a real Node/Python contract test.
- [x] Run the observation platform inside actual Homebridge 2.0.0, in a child bridge with temporary storage and loopback device emulators; see status.md. Live owner installation remains untested.

M1 does not publish accessories, operate hardware or replace the admin extension. No migration instructions are enabled by this milestone.

### M2 — Driver and behavior parity

- Inventory the current runtime and tests at the recorded source commit. Include keypad valid/invalid behavior while moving, indoor-button interruption, source-specific Tailwind versus pulse-relay routing, manual bolt overrides, auto-bolt policy, restart/fault holds, stale event rejection and no ambiguous retries.
- Retain source-specific motor routing through generalized profiles: input event/action, target assembly, selected motor path and per-input settings. HomeKit/virtual keypad use the primary opener; physical inputs may use a named pulse relay. Preserve optional indoor stop/reverse only with verified support. See input-routing.md.
- Implement Tailwind local API and direct-deCONZ bolt drivers first. Add status-only probes and document Local Control Key setup and resource selection.
- Implement existing Homebridge opener and bolt drivers with explicit supported service/capability mappings, independent child-bridge access and no source patching.
- Preserve physical-feedback limitations and the distinction between gateway reports and physical sensing.
- Prove each driver against fake transports, malformed/unavailable data and ambiguous writes before physical commissioning.

### M3 — Coordinator, accessories and configuration

- Port the complete agreed behavior to one serialized coordinator per assembly; add durable intent/fault state and observation-only recovery after restart.
- Implement sensor/timed feedback policies, configuration questionnaire, per-controller/input profiles, multiple doors, combined GarageDoorOpener and optional LockMechanism services.
- Persist stable accessory identifiers; propagate reliable upstream obstruction/fault information without fabrication. Document limitations where stop/reverse is unavailable.
- Implement settings revisions, command request IDs, expiring input events, sanitized event history, and persistent pause/maintenance state.
- Verify stop/restart while moving, conflicting inputs, lost gateway/HB connections, interrupted changes, stale state and feedback loops. Hardware timing parity is assessed separately.

### M4 — New standalone administrator integration

- Preserve the complete existing web UI in the companion repository, with its own URL, accounts and roles. Adapt controller settings, virtual keypad, activity and maintenance to this API.
- The owner has chosen to stop the existing administrator and switch to the new one when ready. Supporting simultaneous admins or adapting the old installation is not a phase-1 requirement.
- Bind requests to the expected plugin, gateway, alarm and controller. Do not forward raw keypad PINs to the coordinator.
- Preserve review/apply/cancel/confirmation behavior, protected identities, fresh outcome delivery and durable maintenance holds. A missing plugin cannot count as successful maintenance.
- Validate the two new projects together before owner installation/testing. Generic UI extraction or read-only API success does not establish operational readiness.

### M5 — Release and owner migration

- Pass supported Node/Homebridge checks and simulated behavioral parity, review npm contents and publish a tested installable version when authorized.
- Install the controller plugin first in a non-actuating commissioning mode while the existing service remains active.
- For the owner's migration use Tailwind local API for the opener and direct deCONZ for the bolt; publish both new combined Garage Door and Lock tiles.
- Install the completed new administrator, stop the existing administrator, and switch to the new interface. Stop the old movement controller and its automatic inputs before the new coordinator gains ownership.
- Commission real opening, closing, bolting, input behavior and restart recovery with the owner. Confirm both administration paths and HomeKit state.
- Rebind scenes/automations as necessary. Remove only the obsolete HTTP Webhooks garage/bolt entries after acceptance; retain the plugin if it serves other accessories.
- Retain one bounded rollback baseline, receipt and explicit cleanup inventory. Final old-installation cleanup is separate.

## Later phase

Host the standalone admin in a Homebridge plugin, keeping its own URL. This phase is deferred. It must retain the API and access model already established here.

## Current implementation checkpoint

M2–M4 operational code is now connected, including the custom configuration UI and companion admin. Release CI and cross-repository tests pass. M5 is ready for owner installation/testing; physical acceptance and any later npm publication remain outstanding; see status.md and owner-test.md.
