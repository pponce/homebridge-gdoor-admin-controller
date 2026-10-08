# Homebridge deCONZ alarm credential

## Required behavior and accepted restart

This PIN is the credential used by the existing homebridge-deconz Security System
tile for Away, Home, Night and Disarm. It is separate from the gateway API key,
web account password, garage controller and removed HTTP Webhooks integration.
Select the alarm user in Users and retain the original protection of that user's
required grants. Do not create a replacement alarm tile or test the PIN by
arming/disarming an alarm.

The owner accepts an infrequent, explicitly confirmed Homebridge restart to
configure this PIN. The chosen route stops/starts only the separate deCONZ child
bridge using the Homebridge UI's authenticated REST controls. The integrated
admin server stays running, so its page and login can remain open. A future host
adapter that restarts the whole service must explain the web interruption before
confirmation and cannot assume an in-service subprocess will survive it.

## Why retain the offline update

The original standalone adapter in configurator/homebridge.py at
45e26c1d586bdcfa22b3b3b486485ba78ee4db6e stopped Homebridge, edited the scoped alarm
PIN in its saved accessory cache, then restarted and verified it. It did not patch
homebridge-deconz source. The standalone source and installed services remain
untouched by this port.

The supported live settings endpoint is unsuitable for a private credential
update: homebridge-lib logs request bodies at debug level and its characteristic
delegate can log old/new values. A live readback also precedes the periodic or
shutdown cache flush. The offline flow avoids sending the PIN through that
logging path and checks the saved value after restart.

This is a narrowly reviewed storage-format dependency inherited from the old
alarm-PIN workflow, not a supported Homebridge PIN-setting API. It is not used
for General connection or device discovery. Compatibility is limited to source
fingerprints recorded in src/web-admin-homebridge-sources.json:
homebridge-deconz 1.3.5 and homebridge-lib 8.1.5. Changed sources require review.
No installed source code, pairing identity or Homebridge config is rewritten.

## Transaction sequence

1. Admin reviews the selected user/alarms, confirms that the garage is stationary
   and authorizes the restart. A Homebridge UI administrator login (including an
   OTP if enabled) is used only in memory for this operation.
2. Verify Homebridge UI administrator permission, the exact child bridge,
   gateway/alarm mapping, process identity, source fingerprints and config.
3. Save the transaction and stop intent, pause the existing coordinator, request
   the deCONZ child stop once, and verify its previous process has exited.
4. Save private before/after cache bytes while stopped. Issue the deCONZ PIN
   update once, requiring the expected response and fresh revision readback.
5. Compare-and-replace only the mapped alarm PIN. Persist the start intent before
   the single start request. Check a new running process, unchanged mapping,
   persisted PIN and gateway grants before publishing the new user binding.
6. Complete the existing coordinator maintenance and forget Homebridge UI
   authentication. Web-account login credentials are never copied into this flow.

The private credential backup is one replaceable transaction-bound record, kept
separately from the credential-free policy snapshots and journal. It cannot be
replaced by a new PIN operation while maintenance remains pending. It is never
served by the web asset handler.

## Limits and recovery

The first host adapter requires Linux, cache files writable by the existing
Homebridge user, one local deCONZ child bridge distinct from this plugin, and a
local HTTP Homebridge UI. It does not install a privileged helper, use sudo,
silently skip HTTPS certificate verification or manufacture an API token.
Unsupported configurations fail before stopping a bridge or changing a PIN.

An acknowledged stop/start is only a request. The journal records each service
intent before delivery, and uncertain requests are not automatically repeated.
Changed cache/config/mapping or an unverified gateway write keeps maintenance
held. Recovery requires a new explicit Homebridge authorization after the
original operation forgets its login, then reviews the saved transaction without
replaying the gateway write. A start whose response was lost can finish after
readback proves the bridge started.

An unknown deCONZ PIN-write response still requires independent credential
evidence; revision metadata alone is not proof. The optional standalone SQLite
evidence adapter has not yet been ported. A stop with no confirmed private
snapshot, a start that never occurred, or unavailable host permissions can need
manual local review. These limits must remain visible in owner-test instructions.

## Validation status

Seventeen focused client, offline-file and maintenance tests pass locally. Tests
cover confirmation, permission/identity checks, no automatic retries, private
backup modes, exact PIN-only changes, competing writes, source/config changes,
grant protection and interrupted service requests. These use synthetic hosts;
no household bridge or alarm was operated. CI run 37731074464 passes Node 22/24
regression/package checks and integrated desktop/mobile confirmation acceptance,
including current-page/session retention. Actual Homebridge compatibility checks
are the final 0.4.24 candidate gate. No npm test release has been published.
