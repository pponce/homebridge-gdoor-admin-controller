# Homebridge Garage Door Admin Controller

Coordinate a **garage door opener and a separate motorized bolt** from Apple Home, physical controls, and a keypad. The plugin manages the sequence: retract the bolt before opening, then wait for the configured closed-door checks before extending it. Each door and bolt share one controller so requests from different physical controls use the same movement and locking rules/logic.  I was inspired to install a bolt via this awesome guide. I used the [MHCOZY 2 Channel 5V 12V ZigBee Smart Relay Switch](https://amzn.to/4zLRf10) for the bolt control via deconz of the [LiftMaster bolt](https://amzn.to/4sfO3rK). Paired that with an [Xfinity keypad](https://amzn.to/4hVG2Vn).

An optional **web administration interface** which can also be used standalone for deCONZ keypad/alarm user pin management and settings, brings deCONZ users, PINs, access schedules, keypad lockout protection, alarms, and activity history into one place. It runs inside the Homebridge plugin and can be accessed via a url for admin of your keypads..

Web admin can run without a "garage door" configured to use with the controller logic. Its user, PIN and alarm pages remain available; the Controller page explains how to add a garage door in Homebridge if you want to use that feature. When a garage door is configured it allows you change settings via that page too. Enable and configure web admin under **Settings → General → Web admin interface**.  

[**Try the interactive demo of the web interface→**](https://pponce.github.io/homebridge-gdoor-admin-controller/)

> **Custom deCONZ is currently required for the keypad and user-management setup described here.** It needs the alarm-user features in [pponce's custom deCONZ REST plugin](https://github.com/pponce/deconz-rest-plugin/tree/alarm-users-v1). The upstream proposal, [deCONZ PR #8661](https://github.com/dresden-elektronik/deconz-rest-plugin/pull/8661), is still an open draft as of October 8, 2026. Acceptance is **TBD**. A standard deCONZ installation does not currently provide these features, and installing this Homebridge plugin does not install or upgrade deCONZ for you.

## What it does

- **Allows setup of a coordinated garage door in Apple Home.** Publishes a Garage Door accessory, with an optional separate Lock accessory for the bolt. Configure additional controllers for additional door-and-bolt pairs.
- **Shared physical control rules.** HomeKit, supported buttons and switches, physical keypads, and the web keypad send requests through the same coordinator. Supported relay setups can use configurable stop/reverse behavior.
- **Timing for your hardware.** Set opening and closing times, bolt delays, settling time, relay pulses, and timing overrides for individual controls. Feedback can use supported sensors or explicitly configured estimates.
- **Persistent setup.** The saved Enabled setting survives Homebridge and child-bridge restarts. Current faults and device availability are shown separately. Startup checks current device state without replaying movement commands.
- **deCONZ access administration web management console.** Manage named users and PINs, per-alarm permissions, allowed keypads, schedules, validity periods, and usage limits. Configure failed-PIN lockout protection and inspect access activity.
- **Web accounts and controller settings.** Manage web logins for the web management interface and edit controller defaults or device timing overrides in a browser. Timing changes apply to the next operation without restarting the plugin.

## Requirements

The full garage door, keypad, and web-administration setup uses:

| Component | Requirement |
| --- | --- |
| Homebridge | **Homebridge 2.4 or later in the 2.x series** with the Homebridge UI for the tested deCONZ integration. Run this plugin in its **own child bridge**. |
| Node.js | **22.13 or later with built-in SQLite enabled**, for the full setup including the web interface. Use a Homebridge-supported LTS release; CI covers Node 22, 24 and 26. Newer versions are allowed to attempt startup. OpenSSL is needed to create the local HTTPS certificate. |
| deCONZ | A working Zigbee gateway and the **custom alarm-user build** linked above, with a deCONZ API key. This is a separate prerequisite, not an npm dependency installed by this plugin. |
| homebridge-deconz | Install and configure [homebridge-deconz](https://github.com/ebaauw/homebridge-deconz) on the same Homebridge host, in a **different child bridge**. It provides the Homebridge side of the deCONZ alarm integration. |
| Physical keypad | The tested model is the **Xfinity/Comcast URC4450BC0-X-R**, paired with deCONZ and assigned to the intended alarm. Other compatible IAS ACE keypads **may work, but have not been hardware-tested with this setup**. Do not assume other Xfinity models behave identically. |
| Garage hardware | A supported garage opener **and a separate bolt/lock** for each controller, with suitable feedback or explicitly configured timing estimates. See Supported connections below. |

**Both plugins (homebridge-deCONZ and homebridge-gdoor-admin-controller) require being setup as child bridges.** Do not run this plugin or `homebridge-deconz` on the main homebridge bridge, or put them together in one child bridge. This isolates their operation and keeps the controller and web interface available during deCONZ child-bridge maintenance.

The physical keypad is needed for physical PIN entry; it is not needed to operate a configured garage from Apple Home. A garage controller setup with this plugin using other supported connections and physical controls can run without the optional deCONZ web admin administration features.

**Homebridge alarm-PIN synchronization** PINs may appear in Homebridge logs; the confirmation window offers optional log clearing after success via the web admin interface. See [setup, persistence and recovery](docs/web-admin-alarm-pin.md).

## Supported connections

| Part | Supported connection |
| --- | --- |
| Garage opener | Tailwind local API, or a supported Garage Door accessory supplied by another Homebridge plugin. |
| Separate bolt | Direct deCONZ relay, or a supported Lock, Switch, or Light accessory supplied by another Homebridge plugin. |
| Additional opener relays | Supported deCONZ or Homebridge outputs, assigned to controls through the same coordinator. |
| Physical controls | Supported deCONZ or Homebridge buttons/switches, plus the tested Xfinity keypad through the custom deCONZ alarm integration. |

Direct Tailwind access needs its local control key. Direct deCONZ access needs its API key. Homebridge accessory connections use the source bridge's pairing PIN and require unpaired accessory control to be enabled. The setup UI stores credentials privately.

Every configured garage needs a door. **Bolt control enabled** defaults on; turn it off for door-only operation while keeping the saved bolt setup. Bolt-only controllers are not supported. Timed feedback is an estimate, and a relay's reported state is not proof of the bolt's physical position. Choose settings that match what your devices can actually report.

## Install

### Using the Homebridge UI

1. Open **Plugins** in the Homebridge UI.
2. Search for **`homebridge-gdoor-admin-controller`** and click **Install**.
3. Open the plugin's settings and configure it to run in its **own child bridge**. Configure `homebridge-deconz` in a separate child bridge too.
4. Restart when Homebridge prompts you, then follow First setup below. Pair the controller child bridge with Apple Home using the QR code shown by Homebridge.

### Using hb-service

On a host managed by `hb-service`, install the release from a terminal:

```bash
(
  set -e
  sudo hb-service stop
  sudo hb-service add homebridge-gdoor-admin-controller
  sudo hb-service start
)
```

If installation fails, the block stops and leaves Homebridge stopped so you can resolve the error. Then open the Homebridge UI to configure the child bridges and plugin. This does not install deCONZ or `homebridge-deconz`.

For an existing installation, update through the Homebridge UI or use the same pinned `hb-service` command. Keep your saved configuration and HomeKit pairing; there is no need to uninstall the plugin or remove its bridge from Apple Home. Check the [changelog](CHANGELOG.md) before upgrading or downgrading.

## Choose the bolt relays

Under **Garage doors → Devices → Bolt / Lock**, select your deCONZ connection,
then choose **Single relay controls lock / unlock** or **Separate lock and unlock
relays**. Single-relay setup uses the existing mapping. Separate-relay setup
requires selecting both outputs and automatically enables one required HomeKit
bolt Lock tile that controls them together.

For separate outputs, check **Relays are momentary** when the board has built-in
inching. Otherwise set **Pulse duration · seconds**: **0** leaves the selected
output ON until the opposite command; **0.1–2 seconds** makes the plugin generate
a pulse (default **0.2 seconds** for new separate-relay setups). Hardware and
software momentary modes retain estimated Locked/Unlocked after release and
start Unknown after restart. Maintained mode uses relay direction; both OFF means
Unknown. Use the coordinated Lock tile; external pulses can be missed. See
[separate bolt relays](docs/separate-bolt-relays.md) for setup and feedback limits.

## Temporarily operate without the bolt

1. Physically retract and secure the bolt so it cannot extend into the door’s path.
2. Open **Plugin settings → Garage doors → Devices** and turn off **Bolt control enabled**. Review and save.
3. Use the garage’s **Review setup / Enable → Check connections** flow, confirm the physical setup, and enable the garage. The door must be closed for this check.

The garage door tile, motor routes, buttons and keypads continue working. Bolt reads, writes, retraction delays and automatic bolting are skipped. The separate bolt Lock tile is removed while disabled; status shows **Bolt disabled**. Bolt mapping, timing and tile preferences remain saved. Door feedback, obstruction, lockout, restart and ambiguous-command protections still apply.

When the bolt relay is ready, turn the option on, review its mapping under **Bolt / Lock**, save and repeat the connection/setup checks before enabling. Replacement hardware may need its new identity selected. Re-enabling does not move the bolt. The bolt tile may be recreated in Apple Home, so check its room and automations; the garage tile remains in place.

## First setup

1. In the plugin's **General** tab, add the connections and credentials for your deCONZ gateway, Tailwind controller, or existing Homebridge accessories.
2. Add a garage. Under **Devices**, choose its opener, optional separate bolt, and any additional opener relays. Select the feedback and timing settings appropriate for your hardware.
3. Under **Controls**, assign any buttons, switches, and physical keypads. Choose their actions and the opener they should use. Configure the web keypad if wanted.
4. Review and save the configuration. Complete the device checks and explicitly **Enable** the garage when setup is ready. If replacing another controller, stop that controller and any competing automations before enabling this one.
5. Test the full sequence under supervision: unlock, open, any configured stop/reverse action, close, lock, and restart recovery. Only one controller should operate a physical door-and-bolt assembly.

Enabled is your saved choice to use a configured garage. **Ready**, **Checking devices**, **Device unavailable**, and **Fault** describe its current condition. A fault can block commands without disabling the garage or erasing its setup. Use **Check again** after resolving the cause. See [restart recovery and feedback limits](docs/restart-recovery.md).

## Enable the web interface

1. Open **General → Web admin interface** in the plugin settings.
2. Check **Enable web admin** and create the first administrator account.
3. Select the saved deCONZ connection if you have more than one, then click **Save web settings**.
4. Click **Open web admin**. On a normal LAN, the plugin detects the Homebridge machine's IP and shows a URL such as `https://192.168.1.20:9443`. No domain name is required.

The web interface is off by default. Its local HTTPS certificate is self-signed, so your browser will need to trust it. If the host has several network interfaces or runs in Docker, use Advanced network settings to select the reachable host IP and port. See the [web setup guide](docs/web-admin-setup.md) for those cases and reverse proxies.

Web accounts are separate from Homebridge accounts and deCONZ PIN users. Manage additional web accounts and change your own web password in **Settings**. Use **Users** and **Access grants** for deCONZ identities and permissions, **Protection** for keypad lockout policy, and **Activity** for recorded access outcomes.

To use a deCONZ user's PIN for the Homebridge alarm, follow [Homebridge alarm-PIN setup](docs/web-admin-alarm-pin.md). This is a separate, explicitly confirmed operation using the official API without a restart.

Under **Controller**, select the **Garage Door**, edit controller defaults or device timing overrides, then review and apply. Save while the controller is idle; changes take effect on the next operation **without a Homebridge or child-bridge restart**. Hardware mappings and other controller configuration remain in the Homebridge plugin settings.

## Optional Tailwind fully-open sensor

In **Homebridge → Plugins → Garage Door Admin Controller → Settings → Garage doors**, select your garage, then **01 Devices → Garage Door opener**:

1. Keep **Tailwind door** set to the input connected to the actual opener and closed-position sensor.
2. Check **Configure an extra Tailwind open sensor**.
3. Select the spare **Tailwind open sensor input**. It must differ from the primary input and cannot belong to another configured garage. If General lists a door count, include the spare input in that count.
4. Under **03 Behavior**, **Open means…** selects **A sensor confirms fully open**, and **Open confirmation sensor** defaults to **Tailwind open sensor**. The closed sensor remains the default for **Closed confirmation sensor**. Review the mapping, check connections and approve the updated setup.

The spare input needs only its sensor. Its Tailwind **Door control** may stay disabled. Mount the sensor so the magnet engages at the fully-open endpoint. Tailwind reports that engagement as `close`; this plugin interprets it as fully open because of the input's assigned role. Commands still go only to the primary opener input.

| Closed-position sensor | Fully-open sensor | Position |
| --- | --- | --- |
| Engaged | Disengaged | Closed |
| Disengaged | Engaged | Fully open |
| Disengaged | Disengaged | Between endpoints; direction is not proven by these sensors |
| Engaged | Engaged | Conflicting readings; control held |

When selected in Behavior, the extra sensor replaces opening travel estimates, including per-control overrides and extra opening time after a relay reversal. **Movement timeout** remains a failure limit, never proof of arrival. Closed confirmation and its stability wait still govern bolting. Missing/invalid selected sensor data holds control rather than reverting to time estimates. Restart and idle observation read the current endpoints without sending commands.

You can leave the extra input configured and choose **Estimated full opening travel time** in Behavior, or select another configured contact sensor. The saved travel times are retained. Removing the extra input returns to timed opening only when that Tailwind sensor was the selected open source; an external sensor selection is preserved. A single Tailwind sensor reports only closed/not-closed.

### Other position sensors

Under **01 Devices → Add sensor**, name each contact sensor, choose the Homebridge bridge exposing it, click **Find Homebridge devices**, and select the contact service. **Endpoint active when** sets which reading confirms the endpoint: contact detected (magnet engaged), or contact not detected. The bridge must allow accessory control; sensors paired only to Apple Home cannot be read through this connection.

Under **03 Behavior**, select sensor confirmation for closed or open, then choose the device in **Closed confirmation sensor** or **Open confirmation sensor**. You can add multiple sensors, but the same sensor cannot confirm both endpoints. Tailwind and ratgdo feedback appears automatically in Devices without creating another hardware connection. Those entries show which endpoint uses them; you can override the defaults or use timed opening.

Only selected sensors are required for operation. Unused contacts and an unused Tailwind extra input are not queried for confirmation. Selected contacts are read through their pinned Homebridge identity and live characteristic endpoint, including fault/inactive flags when available; the plugin cannot independently establish the physical age of an upstream plugin's reading. Both endpoints reporting active holds control. Opener obstruction, disabled-control and lockout rules still apply. Changes to sensor hardware, polarity or selection require setup review.

## Interactive demo

[**Try the interactive demo →**](https://pponce.github.io/homebridge-gdoor-admin-controller/)

See what the web interface offers before installing. Explore user and PIN management, keypad lockout settings, and garage door timings using sample data.

## Help and reference

- [Xfinity keypad guide and manual scans](docs/xfinity-keypad.md) — tested light and PIN-entry behavior, extra digits, lockout counting, and what is still unproven.
- [Controller timing settings](docs/controller-timings.md).
- [Physical controls and keypad stop/reverse](docs/input-routing.md).
- [Restart recovery](docs/restart-recovery.md).
- [Changelog](CHANGELOG.md) and [GitHub releases](https://github.com/pponce/homebridge-gdoor-admin-controller/releases).
- [Report an issue](https://github.com/pponce/homebridge-gdoor-admin-controller/issues). Include the plugin version, device types, and relevant sanitized diagnostics; leave out PINs and credentials.

Developer setup, implementation notes, and development history are kept in [developer documentation](docs/developer/README.md).

## A friendly disclaimer

I use this plugin on my own garage, but it's still software, and software can have bugs. Please test **all functions of your setup** before relying on it, and test again after updates or configuration changes. Check PIN access, opening, stopping or reversing where configured, closing, locking, and behavior after a restart. My garage gives it a regular workout, but yours may discover a new party trick. I've only tested with my specific setup. This includes a tailwind garage door opener (allows control vi api), homebridge-Deconz with deconz using custom software (PR pending) and bolt setup to be controlled via zigbee + xfinity keypad.

This plugin is provided **as is, without warranties**. You're responsible for making sure your setup works safely and as intended. I'm not responsible for bugs, failures, damage, or other issues resulting from its use.
