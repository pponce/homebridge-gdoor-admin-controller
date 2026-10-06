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

### Scope of the next change

Apply the agreed terminology and entry-flow improvements to the shared editor in both repositories when implemented. Verify the first-use path with an empty configuration. Preserve existing coordination and commissioning behavior.
