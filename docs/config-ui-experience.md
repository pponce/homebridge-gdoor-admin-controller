# Configuration save experience

Version 0.4.12 corrects the garage-card and key-management behavior reported after 0.4.11. Checks and enablement are inline inside the garage card, with no fourth setup tab. New-key fields precede saved names and explicit Replace/Delete actions.

## Reference and framework

The reference is [homebridge-roborock-matter at 4d23bf0](https://github.com/mathiashornbek/homebridge-roborock-matter/tree/4d23bf0e812111758afbd46b68e26d1c9bd52e8c/homebridge-ui). Its custom settings use plain JavaScript/CSS and Homebridge's plugin UI API, not React or a separate component framework. Its updatePluginConfig helper reads the current block, preserves unrelated metadata, calls updatePluginConfig, then awaits savePluginConfig. showToast uses homebridge.toast.success. The host retains the bottom Save action.

The [Homebridge custom modal implementation](https://github.com/homebridge/homebridge-config-ui-x/blob/bb94ef61d69fac7fe4c412e59397964f22eb6a2a/ui/src/app/core/plugins/custom-plugins/custom-plugins.component.ts) implements config.update as a modal-memory update and config.save as disk persistence. savePluginConfig(true), used by the host's bottom Save, also closes the modal and invokes the host's restart guidance. The [modal template](https://github.com/homebridge/homebridge-config-ui-x/blob/bb94ef61d69fac7fe4c412e59397964f22eb6a2a/ui/src/app/core/plugins/custom-plugins/custom-plugins.component.html) hides the native validity check while saveButtonDisabled is true. Our old app called disableSaveButton on every load and never enabled it again.

This implementation uses those supported APIs and a local stylesheet with the reference's teal/slate light palette, warm dark surfaces, solid primary buttons, secondary borders, rounded panels and system fonts. It preserves Devices, Inputs and Behavior, uses a prominent Add a garage door button, and asks for the opener connection type before its API fields. It does not import upstream application code, assets, fonts or new runtime dependencies.

## General and garage pages (0.4.11)

General is the landing page for garage readiness, saved connection-key names/replacement and optional web admin setup. Masks are placeholders, not secret values or secret lengths. Replacement starts with an empty password field, keeps the same name, clears the entered value after saving and preserves configuration drafts. Existing credential replacement policy still pauses controls until re-enabled.

Garage doors retains Devices, Inputs and Behavior. Checks and enablement expand inside the selected garage card. Garage cards show enabled (light green), disabled (light red), or needs-attention/setup (amber), with descriptive text. Enable takes the user to explicit checks; Disable persists immediately without movement and is refused during an operation. These immediate actions do not require another configuration save. The General overview has Configure links; live controls are in the garage cards.

Virtual keypad setup belongs to the optional standalone web admin's on-screen keypad. Physical keypads, buttons and HomeKit do not require it. A dropdown replaces the two ambiguous buttons and hides alarm details when Not used is selected. It offers configured physical keypad alarms by name and a manual option when there is no physical keypad. Existing settings are never hidden or cleared based on connection availability. Selecting a physical keypad copies its alarm scope; it does not create a live reference or send an alarm command. The current API has no admin-presence handshake; a displayed coordinator API address does not claim the administrator is installed.

Reviewed name-only changes preserve current valid garage enablement and the stable controller/accessory IDs. Disabled garages are not enabled by renaming; all other control-setting changes retain the existing re-check policy. This does not migrate or weaken the stored commissioning hash.

Adding a garage draft no longer paints unchanged enabled garages amber: card status compares each profile with its own saved configuration. Actual faults and failed connection checks still show attention. Edited profiles identify their pending changes and explain when the saved profile remains enabled. Enablement mutations and probes wait until pending configuration is saved or discarded.

Remove this garage door uses no native browser confirmation, which can be unavailable inside an embedded settings frame. A new draft disappears immediately; removing a saved garage is staged until Review/Save and named in the review summary. Removing a new garage does not discard edits to other garages. Returning exactly to the saved configuration restores bottom Save without another apply. Discard changes still restores the full saved snapshot.

New-key creation cannot silently replace an existing name. Creating or deleting an unused key preserves enablement. Delete asks inline and checks both durable private profiles and the Homebridge platform configuration, including disabled garages and optional inputs; an in-use key is retained with an explanation. No saved secret is returned to the browser. Key replacement retains the existing commissioning-reset policy.

## Shared connection design — follow-up

The owner proposed reusable device connections in General. Recommended scope: named deCONZ gateway URL/key, named Tailwind device URL/token, and optionally named Homebridge bridge URL/PIN. Each garage would select those connections while retaining its Tailwind door index, bolt output, relay mapping, input routing and timings. Tailwind device door count could assist door-index validation, but should not create coordinated garages automatically. This is a design recommendation, not a schema migration in 0.4.12. Existing per-garage addresses and references remain valid.

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

Version 0.4.12 passed all five jobs in [CI run 37680295430](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37680295430), implementation edf183c61e48a998b603d6c01989be754185f04f: 147 tests on Node 22/24, both supported Homebridge versions, actual UI server IPC, desktop Chromium and mobile WebKit. Regression coverage starts with an enabled garage, adds/removes drafts with native confirm unavailable, preserves other edits, restores clean Save when appropriate, retains inline checks and tests key creation/deletion without enablement loss. A first-run browser failure also exposed a redundant blur rebuild that swallowed a garage-card click; that was corrected before the passing run. Real outer-modal acceptance still belongs to the owner.

Version 0.4.11 passed all five jobs in [CI run 37665272198](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37665272198), implementation 365e01c642a6ce3252d7272c40dbb7d9422926a1: 145 tests on Node 22/24, both supported Homebridge smoke-test versions, actual custom UI server IPC and Chromium/WebKit browser flows. New browser checks exercise General, selected-garage enable/disable, status colors, key replacement without secret disclosure, draft preservation, optional keypad setup and failed checks. A previous browser setup timed out, so CI now uses the matching official Playwright image; a subsequent accessible-label mismatch was fixed before this passing run. The owner must still verify the installed modal. These checks send no requests to household hardware.

The merged 0.4.10 release also passed all five jobs in [CI run 37645305805](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37645305805), revision `53027491e867f43addadf60ecb5f9870e39cb2a8`. A subsequent documentation-only commit records those results.

All 142 tests passed locally and on Node 22/24 in [CI run 37642891710](https://github.com/pponce/homebridge-gDoorAndBolt-coordinator/actions/runs/37642891710), implementation `2b5876b8f2266c97a7db680501ad0766d1ed72a7`. Focused save-session tests cover reviewed snapshots, native acknowledgement, setup vs. managed persistence, bridge metadata, partial failure retry, uncertain apply reload and invalidated reviews. Desktop Chromium and mobile WebKit passed a model of the native footer/API contract, toasts, immediate dirty state, delayed/rejected saves, commissioning, draft-preserving credentials, theme changes and overflow. Actual custom UI server IPC and Homebridge 2.0.0/2.4.0 checks also passed. The browser harness models the parent controls; it does not run the Angular Homebridge modal itself. Screenshot artifacts accompany the run but have not been visually reviewed in this workspace. Live owner-host acceptance of the outer modal remains outstanding.

Inline connection-key creation remains separate work; named keys are managed on General. The virtual-keypad selector is addressed by 0.4.11 above. This update does not change those configuration schemas or defaults.
