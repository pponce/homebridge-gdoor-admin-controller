# Node.js web admin development status

## Foundation milestone
Implemented src/web-admin-auth.js and src/web-admin-server.js on web-admin-node-port. Main remains the reviewed 0.4.22 owner release.

The authentication module preserves the reference's named-account schema, asynchronous scrypt verification (N=16384, r=8, p=1, 64 bytes), Admin/Regular restrictions, current-password requirements, last-admin protection, revision-checked writes and session invalidation after uncertain writes. Sessions retain the eight-hour absolute and thirty-minute idle limits, twelve-session cap and six-attempts-per-minute limit. Unrelated account edits preserve unchanged accounts' sessions.

The transport preserves the existing login/session/logout/password/account route shapes, Secure/HttpOnly/SameSite session cookies, Host/Origin/CSRF checks, bounded JSON bodies and sanitized unexpected errors. It accepts an explicit static asset map and rejects unimplemented domain endpoints. The server factory requires TLS and returns an unstarted listener.

## Validation
Nine focused tests passed locally on Node 24.19.0. Coverage includes account permissions, unrelated account changes, disablement, revision/current-password checks, password changes, idle/absolute expiry, rate limits, uncertain writes, logout, Host/Origin/CSRF/cookies, unsupported endpoints and sanitized errors. The transport fixture uses a loopback HTTP harness with explicit Host/Origin headers; it is not a deployed HTTPS browser test.
A focused branch workflow runs the same tests on Node 22 and 24.

## Not yet implemented
No Homebridge startup integration, public listener, persistent account-store adapter, first-admin setup UI, certificate configuration UI, original static asset extraction, frontend/browser parity, deCONZ domain operations, virtual-keypad adapter, backup/history jobs or production release is included.
The initial-account constructor is for trusted setup, not a public anonymous signup endpoint. Legacy password-only account migration is not part of this fresh-setup milestone.
Next: reviewed static asset manifest and persistent account storage/setup integration, then connect the original frontend to the implemented session routes and extend domain operations against the pinned reference.

## Standalone remains available
See standalone-preservation.md. The original Python web interface/controller is retained as the non-Homebridge option. No service or device was operated.
