# Working agreements

- Implement the scope in docs/implementation-plan.md. Every controller requires both a door and bolt; do not add native HomeKit pairing or standalone door/bolt modes.
- Keep the existing standalone project and host installation unchanged while developing here. Source publication is not npm publication, installation, or physical acceptance.
- Preserve current controller behavior through a documented parity inventory, including source-specific motor routes, keypad semantics, manual-unlock policy, restart holds and ambiguous-command handling. A basic open/close demo is not feature parity.
- Never claim command acknowledgements, cached values or elapsed timers prove physical position. Timed modes are explicit estimates; timed bolting is an explicit policy.
- Never send a hardware command from startup, discovery, a configuration test, or a state update. Do not automatically retry ambiguous movement writes.
- One active movement coordinator per physical door/bolt assembly. Installation alongside the old service must initially have actuation disabled.
- Use Homebridge-owned storage for plugin data. No system-modifying install hooks, sudo, systemd installer, or edits to other plugins' files.
- Secrets, live host mappings, PINs and pairing data never go into Git or logs. Use synthetic fixtures and secret references. Errors must not echo supplied credentials or URLs.
- The management API is local and authenticated. Browser clients use their administration backend. Advertise only implemented capabilities; unsupported mutation/maintenance must fail, never acknowledge success.
- Keep API contract examples synchronized with the admin repository and run the cross-repository test when changing the protocol.
- Preserve the original repository's private history: only reviewed source is eligible for later extraction, with provenance and no household-specific documentation.
- CI should run only for relevant code changes or explicit dispatch; avoid expensive repeated full-suite runs without a concrete risk.
- Record progress, validation and remaining work in docs/status.md. No live cutover until the migration gates are satisfied and the owner is ready.
