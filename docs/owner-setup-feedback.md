# Owner setup feedback

## 2026-10-06 — first setup of npm 0.4.0

Status: recorded for a future UI update. These notes do not describe changes already shipped.

### Make adding the door the obvious first action

Observed: the owner missed **Add a garage** because it was small, very lightly colored and did not look like a button. The larger **Start with one garage** panel drew attention, followed by the connection-key fields below it. The owner therefore saved keys without discovering the Devices, Inputs and Behavior editor.

Requested change:
- Rename the action to **Add a garage door**.
- Give it a prominent, clearly button-like appearance with adequate contrast and a generous click/tap target.
- Put the primary action inside the introductory panel, alongside the explanation, so the strongest visual element leads into configuration.
- Use “garage door” consistently in this entry flow.

Acceptance: on an empty configuration, the next action is visible and recognizable on desktop and mobile. Clicking it reveals the Devices, Inputs and Behavior steps. Connection-key entry should not appear to be the entire setup.

### Distinguish key labels from accessory names

Observed: **Connection name** was mistaken for the name of the HomeKit garage tile.

Proposed improvement: label it **Saved key name** (or an equally clear label), explain that it identifies a credential, and point out that **Garage name** in Devices determines the garage tile name. Give neutral examples such as garage-tailwind and garage-deconz; never include real keys.

### Explain the two credentials in context

Observed: the owner needed clarification that Tailwind's six-digit local control key is the credential for its local API and does not require a second Tailwind API key. deCONZ uses its own API key.

Proposed improvement: explain this beside the relevant connection, preserve leading zeros in Tailwind keys, and make the relationship between saving a key and selecting that saved key clear.

### Explain saving and review

Observed: after saving connection keys, the owner asked whether to click **Review changes**, because no further device settings were apparent.

Proposed improvement: confirm that **Save connection key** saves immediately, then guide the owner to add/configure the garage door. Explain that **Review changes** reviews the door configuration after the Devices, Inputs and Behavior steps. Keep activation as a separately explained **Enable** step.

### Explain which Tailwind door to select

Observed: the numeric Door field prompted questions about multi-door controllers, whether the first door is 0, and how to confirm the selection in the Tailwind app.

Proposed improvement: label the field **Which door on this Tailwind controller?** and show **Door 1**, **Door 2**, **Door 3** while preserving API indices 0, 1, 2 internally. Explain that the address identifies the controller and the selection identifies its door/output. Include a short help link for checking the configured door count in Tailwind's Devices/My Devices screen, using the gear beside the device. Where doors have custom names and the channel is unclear, the numbered physical connection or an existing working integration can establish the mapping; do not suggest test movement just to identify a door.

Reference: [Tailwind support's device settings guidance](https://gotailwind.zendesk.com/hc/en-us/community/posts/360077567852-2nd-Garage-Door). Checking the configured count does not require changing it.

### Select saved credentials or create them where needed

Owner request: populate the connection-key field from saved keys. Let the user create a key beside the device connection when none are saved, instead of requiring a trip to the separate form.

Current limitation: the field is free text with a browser datalist containing the keys present at initial load. Saving a key does not refresh that list in the active editor. This is not an obvious or complete selection flow.

Requested improvement:
- Ask **How is this garage door controlled?** first, with **Tailwind local API** and **Existing Homebridge garage** choices, before showing any Tailwind-specific fields or asking for credentials. Apply the same connection-first order to the bolt and other device setup sections.
- After the connection choice, show the appropriate device address/discovery and saved-credential picker with inline creation. The standalone credential form should not lead the first-use flow.
- Use a visible saved-credential picker rather than requiring the user to type a key label.
- Include **Add a new key** beside the picker, including when saved keys already exist.
- When there are no saved keys, show the inline creation form as the next action.
- After saving, refresh the available choices and select the new credential without losing pending garage-door settings.
- Show only credential labels in the picker; keep stored secret values private.

Explain the credential according to the selected connection: Tailwind local API requires its six-digit local control key; an existing Homebridge garage requires the source bridge's pairing PIN and accessory endpoint with unpaired accessory control enabled. That Homebridge route does not require a Tailwind key in this coordinator. Direct deCONZ still requires a deCONZ key for its selected outputs/inputs. Tailwind-specific fields should be visible only for the Tailwind connection.

Acceptance: both first-key creation and existing-key selection work without leaving the device setup or retyping labels; the selected backend clearly explains which credential is required.

### Separate credential fields for each connection

Owner clarification: provide separate Tailwind and deCONZ credential fields, where entering and saving a credential completes that connection's credential setup. The shared connection-name/key form was mistaken for a Tailwind-only form, leaving no apparent place to save the deCONZ key requested by the bolt configuration.

Preferred first-use flow: choose the connection type, then enter its clearly labeled credential in that connection's section: **Tailwind local control key**, **deCONZ API key**, or **Homebridge pairing PIN** as applicable. Each has a clear save action and a **Key saved** confirmation; saving automatically attaches the private credential reference to the connection. Creating and retyping a connection name must not be required in the normal flow. Keep a visible **Use a saved key** option for reuse, particularly the same deCONZ connection across bolt, motor relay and inputs. Refresh saved choices without losing pending settings. Do not return stored secret values to the browser.

This refines the earlier picker proposal: separate connection-specific credential entry is the obvious first-use path; saved-key selection remains an available reuse path. These are recorded requirements for a future UI update, not changes to the installed 0.4.0 build.

### Device discovery appears unresponsive

Owner report: **Find devices** does not seem to do anything during deCONZ bolt setup. The owner subsequently confirmed the address was missing its http:// prefix; the generic error hid that cause.

Source inspection: the current editor changes a small help paragraph below the button to **Finding devices…**, followed by a device selector, an empty-result message, or a generic address/key error. It does not change/disable the button while discovery is pending. Discovery uses the entered address and saved key reference immediately; reviewing or saving the garage configuration is not a prerequisite. The server requires an origin URL including http:// or https:// and the correct deCONZ port, and reads config, lights, sensors and alarmsystems together.

Follow-up: collect the exact visible status or a credential-free screenshot before attributing the report to a connection failure. Improve the button's pending state and make results/errors prominent beside it. Explain missing address/key fields locally and distinguish connection/key failures from no compatible devices using sanitized messages. Preserve pending settings and avoid exposing raw backend errors or credentials. Accept a plain host/IP plus optional port by normalizing it to an HTTP origin, while preserving an explicitly entered HTTPS scheme. Explain malformed addresses beside the field. This UI improvement is still pending.

### Distinguish relay outputs from physical inputs

Observed: a two-channel relay module exposes relay outputs and wired-button inputs as separate deCONZ resources/HomeKit tiles, making **Additional motor path** and **Physical controls** unclear. Explain that an opener relay is an output and its wired-button sensor is an input, even when both belong to one physical module. Show clear names, resource numbers and roles in discovery. Multiple physical controls, such as a keypad and wired button, can select the same opener relay path.

The T2 relay was also absent from the picker because 0.4.0 excluded its **On/Off switch** type. The 0.4.1 source fix accepts that type consistently through discovery, validation and runtime; see status.md for verification/publication status. This does not implement the other UX changes in this document.

### Explain input rearming

Observed: the owner asked what **Rearm delay** means. Explain it as the ignore interval after an input becomes eligible again (for example after startup, reconnect or an operation), with presses during that interval discarded. It is not a per-press execution delay or the alarm's arm delay. Keep existing input policies and values unchanged when improving the wording.

### Make virtual keypad setup an explicit optional choice

Observed: the owner could not tell whether virtual keypad configuration must wait for the standalone web administrator, or how **Link virtual keypad to physical keypad**, **Set an alarm directly**, and the resulting fields relate. The two buttons look like sequential actions. The owner suggested a dropdown.

Requested improvement: replace those competing setup buttons with a **Virtual keypad setup** dropdown:
- **Not using it yet** (default for an unconfigured virtual keypad): no alarm fields or required values; explain that it can be configured when connecting the web administrator.
- **Use a physical keypad's alarm**: reuse the selected configured keypad's deCONZ connection and alarm. Select the sole physical keypad automatically; offer a clearly labeled keypad picker when there are several. Show a concise summary of the chosen alarm rather than requiring duplicate connection entry.
- **Choose an alarm manually**: show the deCONZ connection and alarm selection fields for installations without a physical keypad or needing a different alarm.

Explain that these choices configure the optional on-screen keypad in the separate web administrator. They do not install that application or create a HomeKit tile. The virtual keypad uses the primary opener; physical controls retain their own selected motor paths. Skipping or removing the virtual keypad configuration must leave physical controls intact and allow Review/Save. The current link action copies settings; any revised interface must describe its actual copy/reuse behavior accurately and preserve already configured alarm scopes on load.

Status: recorded for the next UI update; not included in 0.4.1 or the focused 0.4.2 keypad fix.

### Identify the exact reason Review or Save failed

Observed: after completing the 0.4.0 editor, the owner received **Could not complete the request. Check the selected devices, required fields and coordinator connection.** The same generic message covers validation, coordinator review/apply, and other request failures, leaving no useful next action. The custom settings server also discards the validation error code.

Requested improvement: distinguish configuration validation from coordinator availability and saving failures. For configuration problems, identify the relevant garage, section and field with a safe, actionable explanation. Preserve the unsaved draft after failures. Explain incomplete optional motor paths/inputs and duplicate output selections directly, without exposing credentials or raw backend error text. Do not recommend restarting, refreshing or upgrading as a first diagnostic step while the only copy of the user's configuration is the unsaved editor draft.

Resolution: the owner found a second address missing its http:// prefix after fixing the first. This blocked Review before the Save button appeared. Apply address normalization and field-specific validation consistently across every connection, including opener, bolt, additional motor paths, physical inputs and the optional virtual keypad. Highlight each affected field; fixing one address must not leave the owner guessing about another. The generic message alone was insufficient to diagnose this.

Status: captured for the next UI update; not included in the reviewed 0.4.1 release.

### Finish configuration with Save and close

Observed: after **Save reviewed settings** reported **Setup saved. Restart the coordinator child bridge, then reopen these settings.**, the owner saw Homebridge's disabled footer **Save** and could not tell whether another save was required. The custom editor intentionally disables that standard save button, while using its own save action.

Owner request: allow the final save to close the configuration window.

Follow-up after successful activation: the owner was unsure whether **Enable this garage** still required **Review changes**, with the disabled Homebridge footer Save reinforcing that doubt. Enablement is an immediate, persisted action, not an unsaved editor change. The completed state should explicitly say **Garage enabled. Setup complete. No further save is needed.**, provide a clear **Done / Close** action, and distinguish configuration edits that require review from enablement that has already completed. Do not prompt another configuration save solely because enablement succeeded.

Requested improvement: provide a clear final **Save and close** action after review. Complete the appropriate save (initial Homebridge configuration or coordinator settings apply) before closing through the supported Homebridge UI lifecycle. Keep the editor open and preserve the draft if saving fails. Avoid a competing disabled footer Save that implies unfinished work; make the custom flow and Homebridge footer consistent using supported UI APIs. Present any restart requirement in a visible success confirmation that remains useful after closing. Saving and closing must not enable actuation or implicitly commission a garage.

Status: recorded for the next UI update; not included in 0.4.1 or the focused 0.4.2 keypad fix.

### Check all configured controls before reporting success

Observed: **Check connections** reported the door and bolt verified, but enabling then failed with the generic request error. Read-only inspection isolated the failure to the keypad's non-public enrollment field, while the motor relay and indoor button passed.

The focused 0.4.2 fix removes the invalid private-field requirement and extends the Homebridge settings check to motor relays and enabled physical inputs. It reports the affected control and a fixed error code instead of reporting success based only on the door/bolt checks. The broader field-specific save errors, address normalization, dropdown and save/close UX work remain pending.

### Scope of the next change

Apply the agreed terminology and entry-flow improvements to the shared editor in both repositories when implemented. Verify the first-use path with an empty configuration. Preserve existing coordination and commissioning behavior.
