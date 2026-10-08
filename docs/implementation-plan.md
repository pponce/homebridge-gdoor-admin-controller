# Implementation plan

Initial decision: 2026-10-06. Updated by the owner on 2026-10-07 to one combined Homebridge plugin. Development is authorized; installation and live migration remain owner-run operations.

## Product and repository boundaries

This is a combined garage-door/bolt coordinator. Every configured controller requires both components. Door connections are existing Homebridge GarageDoorOpener services or direct APIs, initially Tailwind. Bolt connections are existing Homebridge LockMechanism, Switch or Lightbulb services, or direct deCONZ. Any combination is allowed. The plugin owns a combined GarageDoorOpener accessory and optionally a LockMechanism accessory. It does not repurpose or intercept another plugin's accessories.

No native HomeKit pairing, Apple Home automation backend, door-only or bolt-only mode. Additional manufacturer APIs can be added later behind the same driver contract. Excluding native HomeKit control does not require removing an existing Tailwind native tile; this plugin uses the local API.

The product is homebridge-gdoor-admin-controller: the existing working Homebridge coordinator plus an optional Node.js web administrator with its own URL and accounts, disabled by default. The earlier plan for two separately installed products is superseded. Reuse the original non-controller web pages, look/feel and administration behavior; connect them to the coordinator already implemented in this plugin. Do not port the old Python movement controller, its controller extension or HTTP Webhooks adapter into this product.

Preserve garageDoorController and its standalone web application as a working alternative for installations without Homebridge. Excluding the old controller from the combined build does not authorize deleting the standalone source, modifying its installed services or migrating private state. See standalone-preservation.md.

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

### M4 — Optional web administration inside the existing plugin

- Reuse the complete non-controller web UI and behavior: gateways, users/PINs, access grants and schedules, keypad protection, alarms, virtual keypad, history, accounts, settings and diagnostics. Keep Admin/Regular permissions and the original desktop/mobile experience.
- Port the administration backend to Node.js and store its private state beneath Homebridge storage. The old controller runtime and HTTP Webhooks integration are excluded.
- The existing CoordinatorRuntime, movement engine, device drivers, input routing, accessory publication and profile store remain the controller authority. The optional administrator uses narrow in-process adapters; external administration uses the existing authenticated API. Do not create another movement loop or independently subscribe physical garage inputs.
- Bind requests to the saved gateway/alarm and existing coordinator. Virtual-keypad authorization goes through deCONZ; its result enters the existing coordinator begin/after API. Never forward raw keypad PINs into the movement engine.
- Use existing coordinator maintenance, settings/recovery and activity interfaces. Preserve review/apply/cancel, protected identities, fresh result delivery and durable interrupted-change handling. An unavailable required component cannot count as successful maintenance.
- Retain the separate homebridge-deconz alarm PIN feature: its existing Security System tile uses that credential for Away/Home/Night/Disarm. Removing HTTP Webhooks does not remove alarm credential synchronization. See web-admin-alarm-pin.md.
- Add explicit Homebridge setup for the optional server, HTTPS and first administrator, using saved connections where appropriate. OFF means no web listener or admin event collector. No systemd helper, other-plugin patch or alternate movement coordinator.
- Web enable/disable must not replace or recommission the existing controller. A web-server failure must not silently stop normal controller operation; recorded maintenance holds remain effective.
- Complete save/recovery and account/browser flows before advertising an owner-test release. Passing read pages alone is not full parity.

### M5 — Combined release and optional owner enablement

- Retain the working controller configuration, accessories and commissioning through the update. Do not make the owner rebuild the controller to add web administration.
- Pass supported Node/Homebridge checks, private-state and interruption tests, exact npm package validation and desktop/mobile web workflows. Publish a tested combined version when ready.
- Supply one SSH Git / npm publication / pinned hb-service install script following the established release checks. Web administration remains disabled until explicitly configured and enabled.
- Verify original non-controller page behavior against synthetic gateways before supervised owner acceptance. Do not send hardware commands from startup, setup, discovery or validation.
- Keep the standalone controller/admin preserved for a separate future rollback; do not run both controllers for one assembly.
- Retirement of old installed services, webhooks accessories or host snapshots is a separate reviewed cleanup task. The standalone build remains the non-Homebridge alternative.

## Later phase

Add a web panel for the existing coordinator's timers, settings, status and supported operations after the non-controller pages are working. Reuse its profile store and reviewed APIs. This is a web presentation of the existing controller, not a port of the old controller implementation.

## Current implementation checkpoint

The Homebridge controller and its configuration UI already exist and are in owner use. The integrated web admin is separate development work on web-admin-node-port. Authentication, original page reads, protected edits, private journal/backups, history, event collection and direct coordinator adapters have automated validation. Optional production setup/lifecycle, alarm-PIN integration and full save/recovery browser acceptance remain outstanding. This branch is not yet the combined owner-test release. See web-admin-node-status.md and status.md for exact validation and remaining work.
