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

### Scope of the next change

Apply the agreed terminology and entry-flow improvements to the shared editor in both repositories when implemented. Verify the first-use path with an empty configuration. Preserve existing coordination and commissioning behavior.
