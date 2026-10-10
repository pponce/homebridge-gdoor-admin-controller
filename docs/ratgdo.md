# Experimental ratgdo integration

Version 0.4.43 adds **homekit-ratgdo firmware's local HTTP API**, not ESPHome,
MQTT firmware, native HomeKit pairing, or every product marketed as ratgdo.
This adapter has synthetic protocol tests only; physical operation is untested.
Every garage still requires an independently configured bolt.

Select **ratgdo — HomeKit firmware (experimental, untested)** in Devices →
Garage Door opener. Enter its local origin and the exact `macAddress` from
`GET /status.json`. Every read checks that identity. Discovery and shared
connection catalog support are not included for this experimental backend.

If device authentication is enabled, store a private credential string such as
`{"username":"example-admin","password":"example-password"}` and enter its
credential reference, never the password, in the opener settings. This uses
HTTP Digest MD5 with qop=auth. Unsupported authentication fails closed. Do not
disable device authentication to work around an error. Use a trusted local
network; HTTP Digest is not TLS encryption. No credentials enter status output.

| Capability | Mapping / difference from Tailwind |
| --- | --- |
| Read state | `GET /status.json`; Open, Closed, Opening, Closing, Stopped. Unknown or malformed replies are unavailable, not closed. |
| Open / Close | One form POST to `/setgdo`, `garageDoorState=1` / `0`. Success acknowledges a request only; operation completion still needs feedback. |
| Position | Explicit reported endpoints rather than treating not-closed as fully open. Configure sensor feedback and physically verify endpoint reporting before commissioning. |
| Stopped | Internally not-closed/uncertain. No new motor command from a partial or unknown starting position. No primary-route stop/reverse support. |
| Obstruction | Actual `garageObstructed` flag; held independently of inferred movement failure. No beam override. |
| Tailwind-style lockout | Not exposed. `lockout=null`, not false. Unsupported reporting is shown in troubleshooting. |
| Remote lock | `garageLockState=Disabled` means OEM remotes disabled, not a Tailwind failed-attempt lockout and not the bolt. Conservatively hold commands; never change the remote lock. Unknown remote-lock state holds as unavailable. |
| Restart | Not exposed by this adapter. Tailwind's restart controls remain Tailwind-only. |
| Warning delay / safety settings | Left unchanged. Allow sufficient movement timeout for the firmware's closing warning plus travel. |
| Physical pulse relay | Existing explicitly configured route remains available under normal coordinator guards; no automatic fallback. |

Status is the firmware's last known opener feedback, not an independent physical
sensor read and not a guarantee its opener bus is healthy. Verify the firmware's
behavior for your opener/protocol, particularly after device/opener power loss.
Security+ 1.0 and some Security+ 2.0 openers do not offer reliable directional
commands from partial position. The adapter therefore deliberately does not
advertise uncertain-position directional recovery, even though its API accepts
open and close requests. A pulse or acknowledgment never proves clearance.

Authentication obtains a challenge using read-only GET `/auth` before the single
movement POST. The coordinator rereads position and checks its bolt guard before
writing. There are no redirects, automatic authentication POST retries, generic
setting writes, remote-unlock commands, firmware updates or device resets.

Upstream references reviewed for this implementation:

- [Documented HTTP CLI](https://github.com/ratgdo/homekit-ratgdo#command-line-interface)
- [Published status fields](https://github.com/ratgdo/homekit-ratgdo/blob/main/src/www/status.json)
- [HTTP handlers and numeric command mapping](https://github.com/ratgdo/homekit-ratgdo/blob/main/src/web.cpp)
- [Door and remote-lock state definitions](https://github.com/ratgdo/homekit-ratgdo/blob/main/src/ratgdo.h)

ESPHome's documented cover REST interface was considered but is not implemented
here: its generic position value can collapse restored/estimated and unknown
ratgdo states into the same endpoint report. Do not select this backend for an
ESPHome device simply because its web interface is reachable.
