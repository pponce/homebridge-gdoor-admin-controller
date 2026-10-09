# Homebridge Garage Door Admin Controller

Coordinate a **garage door opener and a separate motorized bolt** from Apple Home, physical controls, and a keypad. The plugin manages the sequence: retract the bolt before opening, then wait for the configured closed-door checks before extending it. Each door and bolt share one controller so requests from different controls use the same movement and locking rules.

An optional **web administration interface** brings deCONZ users, PINs, access schedules, keypad lockout protection, alarms, and activity history into one place. It runs inside the Homebridge plugin; there is no separate web service to install.

[**Try the interactive demo →**](https://pponce.github.io/homebridge-gdoor-admin-controller/)

> **Custom deCONZ is currently required for the keypad and user-management setup described here.** It needs the alarm-user features in [pponce's custom deCONZ REST plugin](https://github.com/pponce/deconz-rest-plugin/tree/alarm-users-v1). The upstream proposal, [deCONZ PR #8661](https://github.com/dresden-elektronik/deconz-rest-plugin/pull/8661), is still an open draft as of October 8, 2026. Acceptance is **TBD**. A standard deCONZ installation does not currently provide these features, and installing this Homebridge plugin does not install or upgrade deCONZ for you.

## What it does

- **One coordinated garage door in Apple Home.** Publishes a Garage Door accessory, with an optional separate Lock accessory for the bolt. Configure additional controllers for additional door-and-bolt pairs.
- **Shared control rules.** HomeKit, supported buttons and switches, physical keypads, and the web keypad send requests through the same coordinator. Supported relay setups can use configurable stop/reverse behavior.
- **Timing for your hardware.** Set opening and closing times, bolt delays, settling time, relay pulses, and timing overrides for individual controls. Feedback can use supported sensors or explicitly configured estimates.
- **Persistent setup.** The saved Enabled setting survives Homebridge and child-bridge restarts. Current faults and device availability are shown separately. Startup checks current device state without replaying movement commands.
- **deCONZ access administration.** Manage named users and PINs, per-alarm permissions, allowed keypads, schedules, validity periods, and usage limits. Configure failed-PIN lockout protection and inspect access activity.
- **Web accounts and controller settings.** Manage web logins and edit controller defaults or device timing overrides in a browser. Timing changes apply to the next operation without restarting the plugin.

## Requirements

The full garage, keypad, and web-administration setup uses:

| Component | Requirement |
| --- | --- |
| Homebridge | **Homebridge 2.4 or later in the 2.x series** with the Homebridge UI for the tested deCONZ integration. Run this plugin in its **own child bridge**. |
| Node.js | **22.13 or later in the 22.x series, or 24.x**, for the full setup including the web interface. OpenSSL is needed to create its local HTTPS certificate. |
| deCONZ | A working Zigbee gateway and the **custom alarm-user build** linked above, with a deCONZ API key. This is a separate prerequisite, not an npm dependency installed by this plugin. |
| homebridge-deconz | Install and configure [homebridge-deconz](https://github.com/ebaauw/homebridge-deconz) on the same Homebridge host, in a **different child bridge**. It provides the Homebridge side of the deCONZ alarm integration. |
| Physical keypad | The tested model is the **Xfinity/Comcast URC4450BC0-X-R**, paired with deCONZ and assigned to the intended alarm. Other compatible IAS ACE keypads **may work, but have not been hardware-tested with this setup**. Do not assume other Xfinity models behave identically. |
| Garage hardware | A supported garage opener **and a separate bolt/lock** for each controller, with suitable feedback or explicitly configured timing estimates. See Supported connections below. |
| Network access | Homebridge must be able to reach the configured devices and deCONZ gateway. Your browser must be able to reach Homebridge for setup and the plugin's HTTPS port for web administration. |

**Both plugins require separate child bridges.** Do not run this plugin or `homebridge-deconz` on the main bridge, or put them together in one child bridge. This keeps the controller and web interface running when a confirmed alarm-PIN update restarts the deCONZ child bridge.

The physical keypad is needed for physical PIN entry; it is not needed to operate a configured garage from Apple Home. A garage controller using other supported connections can run without the optional deCONZ administration features.

**Homebridge alarm-PIN synchronization has additional requirements:** Linux, a local HTTP Homebridge UI, writable Homebridge storage, and the reviewed `homebridge-deconz` **1.3.5** / `homebridge-lib` **8.1.5** sources. Other versions are not automatically accepted for this operation. See [alarm-PIN setup and compatibility](docs/web-admin-alarm-pin.md).

## Supported connections

| Part | Supported connection |
| --- | --- |
| Garage opener | Tailwind local API, or a supported Garage Door accessory supplied by another Homebridge plugin. |
| Separate bolt | Direct deCONZ relay, or a supported Lock, Switch, or Light accessory supplied by another Homebridge plugin. |
| Additional opener relays | Supported deCONZ or Homebridge outputs, assigned to controls through the same coordinator. |
| Physical controls | Supported deCONZ or Homebridge buttons/switches, plus the tested Xfinity keypad through the custom deCONZ alarm integration. |

Direct Tailwind access needs its local control key. Direct deCONZ access needs its API key. Homebridge accessory connections use the source bridge's pairing PIN and require unpaired accessory control to be enabled. The setup UI stores credentials privately.

Every configured garage needs both a door and a bolt; door-only and bolt-only controllers are not supported. Timed feedback is an estimate, and a relay's reported state is not proof of the bolt's physical position. Choose settings that match what your devices can actually report.

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
  sudo hb-service add homebridge-gdoor-admin-controller@0.4.28
  sudo hb-service start
)
```

If installation fails, the block stops and leaves Homebridge stopped so you can resolve the error. Then open the Homebridge UI to configure the child bridges and plugin. This does not install deCONZ or `homebridge-deconz`.

For an existing installation, update through the Homebridge UI or use the same pinned `hb-service` command. Keep your saved configuration and HomeKit pairing; there is no need to uninstall the plugin or remove its bridge from Apple Home. Check the [changelog](CHANGELOG.md) before upgrading or downgrading.

## First setup

1. In the plugin's **General** tab, add the connections and credentials for your deCONZ gateway, Tailwind controller, or existing Homebridge accessories.
2. Add a garage. Under **Devices**, choose its opener, separate bolt, and any additional opener relays. Select the feedback and timing settings appropriate for your hardware.
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

To use a deCONZ user's PIN for the Homebridge alarm, follow [Homebridge alarm-PIN setup](docs/web-admin-alarm-pin.md). This is a separate, explicitly confirmed operation that restarts only the deCONZ child bridge.

Under **Controller**, select the **Garage Door**, edit controller defaults or device timing overrides, then review and apply. Save while the controller is idle; changes take effect on the next operation **without a Homebridge or child-bridge restart**. Hardware mappings and other controller configuration remain in the Homebridge plugin settings.

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

I use this plugin on my own garage, but it's still software, and software can have bugs. Please test **all functions of your setup** before relying on it, and test again after updates or configuration changes. Check PIN access, opening, stopping or reversing where configured, closing, locking, and behavior after a restart. My garage gives it a regular workout, but yours may discover a new party trick.

This plugin is provided **as is, without warranties**. You're responsible for making sure your setup works safely and as intended. I'm not responsible for bugs, failures, damage, or other issues resulting from its use.
