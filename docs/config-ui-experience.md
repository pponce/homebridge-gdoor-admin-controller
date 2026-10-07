# Configuration save experience

Version 0.4.10 integrates the tested `config-ui-save-preview` work at the owner's request. It retains the reporting experiments from 0.4.9 and does not change HomeKit publication, diagnostic defaults, movement behavior or the standalone administrator. See [release instructions](npm-release.md) and [release validation and publication status](status.md).

## Reference and framework

The reference is [homebridge-roborock-matter at 4d23bf0](https://github.com/mathiashornbek/homebridge-roborock-matter/tree/4d23bf0e812111758afbd46b68e26d1c9bd52e8c/homebridge-ui). Its custom settings use plain JavaScript/CSS and Homebridge's plugin UI API, not React or a separate component framework. Its updatePluginConfig helper reads the current block, preserves unrelated metadata, calls updatePluginConfig, then awaits savePluginConfig. showToast uses homebridge.toast.success. The host retains the bottom Save action.

The [Homebridge custom modal implementation](https://github.com/homebridge/homebridge-config-ui-x/blob/bb94ef61d69fac7fe4c412e59397964f22eb6a2a/ui/src/app/core/plugins/custom-plugins/custom-plugins.component.ts) implements config.update as a modal-memory update and config.save as disk persistence. savePluginConfig(true), used by the host's bottom Save, also closes the modal and invokes the host's restart guidance. The [modal template](https://github.com/homebridge/homebridge-config-ui-x/blob/bb94ef61d69fac7fe4c412e59397964f22eb6a2a/ui/src/app/core/plugins/custom-plugins/custom-plugins.component.html) hides the native validity check while saveButtonDisabled is true. Our old app called disableSaveButton on every load and never enabled it again.

This implementation uses those supported APIs and a local stylesheet with the reference's teal/slate light palette, warm dark surfaces, solid primary buttons, secondary borders, rounded panels and system fonts. It preserves Devices, Inputs and Behavior, uses a prominent Add a garage door button, and asks for the opener connection type before its API fields. It does not import upstream application code, assets, fonts or new runtime dependencies.

## User flow

1. Open existing saved settings: the native bottom Save is available. It can close the modal without reviewing unchanged settings.
2. Edit any field: the status becomes Unsaved changes and native Save is disabled immediately, including while typing. This prevents closing with an older parent-modal snapshot.
3. Review changes: the coordinator validates a complete snapshot and lists any garages requiring checks/re-enablement. No apply or native disk save occurs yet.
4. Save configuration: apply the reviewed snapshot when connected, synchronize Homebridge's configuration, await its save, then show the native success toast. The custom screen remains open. Native Save and its host-owned validity indicator become available.
5. Click the bottom Save to finish: Homebridge saves/closes using its own behavior. This does not apply the managed configuration again or alter commissioning.

The validity indicator concerns configuration. It is separate from explicit connection probes and enablement. Check and enable is unavailable while there is an unsaved draft, so it cannot act on devices different from those shown in the editor. Enabling an already saved garage takes effect immediately and tells the user no further review/save is needed.

## Persistence and recovery

Initial setup uses updatePluginConfig and savePluginConfig; it does not call the managed apply endpoint. For running coordinators, private profiles remain authoritative. Only after successful managed apply does the UI mirror the confirmed normalized configuration into the Homebridge platform block. It reads the newest native block before updating so the bridge identity, port, name and other unrelated metadata are preserved. No credential values are copied into that block.

Loading a connected coordinator stages its already saved snapshot in parent-modal memory, without saving config.json or applying configuration. This keeps bottom Save accurate after standalone-administrator changes or a lost apply response. Unreviewed drafts are never staged there.

If managed apply succeeds but native persistence fails, the UI states which step completed and offers Retry Homebridge save. That retries only the native step. Editing and native bottom Save remain disabled until it finishes; it does not consume another review or apply again. An uncertain apply response instead requires Reload saved settings to inspect the confirmed state, with no automatic retry. A successful save followed by a failed status refresh still reports the save accurately. Disabled buttons, busy fieldsets and distinct pending states prevent overlapping review/save actions.

Private-key saving clears the secret field and preserves unsaved configuration and tab selection. Its success toast does not mark that draft saved or enable native Save. Key replacement still uses the existing commissioning reset policy. Homebridge's theme classes are observed for live light/dark changes.

## Validation

The merged 0.4.10 release also passed all five jobs in [CI run 37645305805](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37645305805), revision `53027491e867f43addadf60ecb5f9870e39cb2a8`. A subsequent documentation-only commit records those results.

All 142 tests passed locally and on Node 22/24 in [CI run 37642891710](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37642891710), implementation `2b5876b8f2266c97a7db680501ad0766d1ed72a7`. Focused save-session tests cover reviewed snapshots, native acknowledgement, setup vs. managed persistence, bridge metadata, partial failure retry, uncertain apply reload and invalidated reviews. Desktop Chromium and mobile WebKit passed a model of the native footer/API contract, toasts, immediate dirty state, delayed/rejected saves, commissioning, draft-preserving credentials, theme changes and overflow. Actual custom UI server IPC and Homebridge 2.0.0/2.4.0 checks also passed. The browser harness models the parent controls; it does not run the Angular Homebridge modal itself. Screenshot artifacts accompany the run but have not been visually reviewed in this workspace. Live owner-host acceptance of the outer modal remains outstanding.

Other setup feedback, including inline connection-key creation and a clearer virtual-keypad selector, remains separate work. This update does not change those configuration schemas or defaults.
