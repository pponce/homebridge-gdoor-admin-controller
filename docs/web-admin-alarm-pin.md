# Homebridge deCONZ alarm credential

## Required child bridges

Garage Door Admin Controller **must run in its own child bridge**.
`homebridge-deconz` **must run in a different child bridge**. Do not run either
on the main Homebridge bridge or place them together. The PIN update restarts
only the deCONZ child bridge; the controller and web administrator stay running,
so the browser page and web session can remain open.

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
The fingerprints were reviewed from homebridge-deconz 1.3.5 and homebridge-lib
8.1.5. Those version numbers record provenance; exact installed-version equality
is not required. Package names and all listed source fingerprints must match,
and the relevant saved accessory-data structure and identities must validate.
Changed source files still require review.
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
including current-page/session retention. CI run 37731476101 also passes the actual Homebridge 2.0/2.4 and custom-UI
IPC checks for 0.4.24. These remain synthetic host tests. The source is ready for
owner publication and installation; no npm test release has been published.

## Setup status and user selection

Settings → Homebridge reports a specific readiness reason when setup needs attention: child-bridge configuration, local HTTP Homebridge UI, plugin availability, file access or reviewed-source compatibility. The user-level Homebridge checkbox remains visible but disabled until this check succeeds. The adapter does not restart anything while checking readiness.

Choose one deCONZ user per gateway in Users using **Use this user for Homebridge on this gateway**. On every selected alarm, that user needs an enabled grant with arm/disarm and API access, unlimited uses and no schedule or expiry. Physical-keypad permissions remain separately selectable on the same user grants. Save access-policy edits before synchronizing the PIN. Enter the PIN twice, select the linked alarms, save, then explicitly confirm the deCONZ child-bridge restart and provide Homebridge UI administrator authentication.

## When file readiness blocks user selection

The Homebridge-user checkbox requires both saved unrestricted grants and a ready Homebridge integration. Checking Owner in an unsaved form is not sufficient: save access edits with the PIN fields blank, then select the user for Homebridge.

From 0.4.28, a failed file check names the fixed configuration/package-relative file and reason in Settings and beneath the user checkbox. It does not reveal absolute host paths or file contents. Missing/unreadable files, unsupported links, unexpected owners, oversized files, and world-write access remain rejected.

Reviewed plugin/library files accept both ordinary 644 permissions and 664 when the writable group is the Homebridge process's own primary group. The owner must still be root or the Homebridge service user, and package names/source fingerprints must match. This avoids requiring manual permission changes for a normal homebridge:homebridge installation. Homebridge configuration and private PIN-cache reads retain their stricter no-group-write policy; cache replacement still writes mode 600.

## Private backup and recovery

The stopped child bridge's complete accessory-data file is saved privately, with before/after contents, in one `web-homebridge-private-backup.json` file. It remains after completion and the next prepared PIN update replaces it. This is not a backup of the deCONZ gateway database or its old PIN, and it does not provide an automatic rollback across both systems. Do not treat the backup as permission to bypass compatibility or verification checks. Interrupted operations use the saved recovery flow; it never automatically repeats the original gateway PIN write.
