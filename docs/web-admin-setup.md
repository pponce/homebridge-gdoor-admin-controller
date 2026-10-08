# Optional web admin setup (development)

This feature is under development on web-admin-node-port, not part of the validated 0.4.23 release. Do not treat this document as release approval.

In the plugin's General page, save a deCONZ device connection first. The Web admin interface panel uses that saved connection and its private key. Enable the web interface, select its gateways, choose its HTTPS addresses, and create the first named administrator. Save web settings applies just that panel and keeps the Homebridge configuration screen open. Manage additional web accounts inside the web interface.

The optional server needs Node.js 22.13 or later in the 22 series, or Node.js 24, and OpenSSL for initial private certificate generation. It is off by default. Disabling closes the listener and collector but keeps accounts, history and gateway identity bindings. Re-enabling cannot overwrite the initial administrator. Web settings are stored privately by the active coordinator; changing them does not edit garage profiles or commissioning.

## HTTPS and nginx

The browser web address and backend address may differ. For example, the browser could use https://garage.example.test while nginx forwards HTTPS to https://192.0.2.10:9443. In that arrangement, the backend address must match the Host and Origin headers nginx sends. The plugin accepts that exact backend origin rather than trusting arbitrary forwarded headers. The configured backend port must equal the listening port.

The public certificate and its private key remain in nginx. The plugin generates and stores its own private self-signed backend certificate in Homebridge-owned storage. Configure the proxy's upstream certificate trust explicitly. Direct browser access to a self-signed listener needs a separately trusted certificate arrangement; it is not automatically trusted by browsers.

The default listening address is 127.0.0.1. A proxy connecting through a network address needs a corresponding listening interface; 0.0.0.0 listens on all IPv4 interfaces. An occupied port produces a setup error and does not stop or modify the other service. Choose a different port for parallel web testing, or perform an explicit owner-controlled cutover of the existing web listener.

## Local setup API

The additive GET /v1/web-admin and POST /v1/web-admin/configure routes are for this plugin's Homebridge custom UI. They retain the existing local-only listener, bearer authentication, browser-Origin rejection and instance identity check. Configure accepts exactly expectedRevision, settings and admin in addition to instanceId. A result with configured:false is a rejected/uncertain setup, never a successful save; the UI must display its safe reason and reload before retrying an uncertain result. A saved configuration with running:false and an error indicates listener activation failed.

Existing controller API capabilities and payloads are unchanged. The standalone client/repository remains preserved and does not need these optional routes. No private files or keys are exposed to web clients, and no hardware command is sent by setup, discovery or startup.
