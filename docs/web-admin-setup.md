# Optional web admin setup

The web administrator is new in the validated 0.4.24 owner-test source release. Source validation, npm publication, installation and physical acceptance are separate steps; see status.md for the current gate.

In General → Web admin interface, check **Enable web admin**, create the first administrator, and click **Save web settings**. A single saved deCONZ connection is selected automatically. With several connections, choose the gateways to administer. On a normal LAN installation the plugin detects the Homebridge machine's IPv4 address, configures the listener and accepted origin together, and shows **Open web admin: https://IP:9443** after the server starts. Browser trust of the private self-signed certificate is still required.

**Advanced network settings** contains the IP address selector, port and an explicit reverse-proxy/custom-address option. Existing saved custom settings are retained. Multiple NICs, VPNs and containers may need a different address; Docker bridge installations need the host address and the same port published. If discovery cannot find an address, enter the machine's IP there. Address discovery is local OS enumeration and sends no network/device probes. Automatic setup is applied on explicit Save, not on startup; after a DHCP address change, select the current address and save again.

Web accounts remain separate from Homebridge accounts. Manage additional accounts in the web interface.
The optional server needs Node.js 22.13 or later in the 22 series, or Node.js 24, and OpenSSL for initial private certificate generation. It is off by default. Disabling closes the listener and collector but keeps accounts, history and gateway identity bindings. Re-enabling cannot overwrite the initial administrator. Web settings are stored privately by the active coordinator; changing them does not edit garage profiles or commissioning.

## HTTPS and nginx

The browser web address and backend address may differ. For example, the browser could use https://garage.example.test while nginx forwards HTTPS to https://192.0.2.10:9443. In that arrangement, the backend address must match the Host and Origin headers nginx sends. The plugin accepts that exact backend origin rather than trusting arbitrary forwarded headers. The configured backend port must equal the listening port.

The public certificate and its private key remain in nginx. The plugin generates and stores its own private self-signed backend certificate in Homebridge-owned storage. Configure the proxy's upstream certificate trust explicitly. Direct browser access to a self-signed listener needs a separately trusted certificate arrangement; it is not automatically trusted by browsers.

The simple LAN setup listens on 0.0.0.0, with requests restricted to the chosen IP and port. Custom proxy setups can select a specific listening interface, including loopback for a proxy on the same machine. An occupied port produces a setup error and does not stop or modify the other service. Choose a different port for parallel web testing, or perform an explicit owner-controlled cutover of the existing web listener.

## Local setup API

The additive GET /v1/web-admin and POST /v1/web-admin/configure routes are for this plugin's Homebridge custom UI. They retain the existing local-only listener, bearer authentication, browser-Origin rejection and instance identity check. Configure accepts exactly expectedRevision, settings and admin in addition to instanceId. A result with configured:false is a rejected/uncertain setup, never a successful save; the UI must display its safe reason and reload before retrying an uncertain result. A saved configuration with running:false and an error indicates listener activation failed.

Existing controller API capabilities and payloads are unchanged. The standalone client/repository remains preserved and does not need these optional routes. No private files or keys are exposed to web clients, and no hardware command is sent by setup, discovery or startup.

## First functional test

1. Update the existing plugin normally. Keep its controller settings and HomeKit pairing; no uninstall or re-pair is needed. Do not start the preserved standalone movement controller alongside it.
2. In General → Web admin interface, enable the server, select an already saved deCONZ connection, and enter the first administrator username/password twice. Use automatic local access, or select the custom-address option for an existing nginx route. Save web settings; expect Running and an Open web admin link. An occupied port must be resolved by an explicit owner-controlled web-listener cutover or a different test port.
3. Sign in and inspect Gateway, Users, Access grants, Protection, Alarm, Activity and Settings on desktop and phone. Confirm the intended gateway/alarm is selected. Discovery and opening pages do not operate the garage or alarm.
4. In Settings, change a display preference, create another web account, sign out/in, and verify the preference/account persists. Later account management stays here; General no longer offers first-account creation.
5. For a reversible gateway write, use a dedicated test identity to verify a name or grant change and restore it. Confirm the activity entry. Ordinary user PIN changes are separate from choosing the Homebridge alarm identity. Do not replace an existing credential unless ready to update its dependants.
6. When ready to test Homebridge alarm PIN synchronization, follow web-admin-alarm-pin.md. The UI requires an explicit restart confirmation and a Homebridge administrator login. Only the deCONZ child bridge stops/starts; the web page/session remains open. Unsupported source versions/configurations fail before the stop. An uncertain PIN write remains held and can require manual review; this first release does not implement the standalone independent credential-evidence adapter.
7. Turning the web feature off closes its listener/collector and retains its accounts/history. Existing controller behavior should continue. Do not conduct a door movement test as part of installation or discovery; physical control acceptance is a separate supervised step.

The Controller page edits controller defaults, physical-input timing overrides and motor relay pulse durations. Review and apply changes while idle; they are persisted and applied to the existing engine without restarting Homebridge or changing commissioning. Other controller configuration stays in Homebridge. See controller-timings.md. The original standalone repository and its deployment remain available separately.
