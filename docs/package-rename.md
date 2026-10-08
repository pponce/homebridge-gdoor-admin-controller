# 0.4.20 package-name release

The new package is `homebridge-gdoor-admin-controller@0.4.20`; the previous package is `homebridge-gdoorandbolt-coordinator`. This release changes package registration, repository links and visible branding only. Controller logic and the management API remain unchanged. The integrated Node.js web admin is not included.

The owner selected a fresh setup. Remove only this plugin's child bridge from Apple Home, uninstall the old package through Homebridge UI and remove its platform configuration. Do not remove other bridges, plugins or deCONZ users/PINs. Never run both packages as active coordinators.

Uninstalling the package may leave private plugin data. While Homebridge is stopped, archive only the `gdoorandbolt-coordinator` directory inside the actual Homebridge storage directory before installing the new package. This directory contains saved settings and commissioning as well as identity and secrets; leaving it in place can restore the old setup. Keep any archive private. Do not delete Homebridge's general persist/accessories directories. The new package intentionally retains its internal platform alias and storage layout for this name-only release; a fresh data directory gives it a new identity.

Publish from the reviewed clean source using `bash scripts/publish-npm.sh REVIEWED_COMMIT_SHA` in an interactive terminal. npm prints a browser approval URL when required. Verify registry metadata and the downloadable archive before stopping Homebridge. Then use `sudo hb-service stop`, archive this plugin's private data, `sudo hb-service add homebridge-gdoor-admin-controller@0.4.20`, and `sudo hb-service start`. Leave Homebridge stopped on any installation/reset error.

Configure the new plugin and its child bridge from scratch, then pair that child bridge in Apple Home. New garages stay disabled until explicitly checked and enabled. Rebuild any affected scenes/automations. Old npm releases remain available; deprecation is deferred until this installation is accepted.

Validation: 172 local Node tests passed. Actual Homebridge registration and browser/UI checks run in GitHub CI. Source readiness, npm publication, host installation and physical acceptance are separate milestones.
