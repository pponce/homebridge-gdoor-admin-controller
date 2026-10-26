# Web admin navigation release checkpoint

Objective: release the dashboard-link login fix as 0.4.55, publish the exact
reviewed npm package, and update the owner's Git checkout and Homebridge plugin.

- Repository: pponce/homebridge-gdoor-admin-controller.
- Review branch: fix/web-admin-navigation-20261026; target: main.
- PR: https://github.com/pponce/homebridge-gdoor-admin-controller/pull/15.
- Original navigation commit: 1451a37d46ce5374142a2ca5741af626472c52b8.
- Base: 054f973de73b8f2d9220c158d38142a14931d5ed.
- Original navigation tree: c73e292869f4f8e428a748d1f76e32e1bf7e459d.
- Release version: 0.4.55.

The transport permits same-site/cross-site GET / only when a public HTML
asset exists and Fetch Metadata says navigate/document. Exact Host/Origin
checks remain. The exception does not include API paths, POSTs or frames.
The release preparation dates the changelog, updates release documentation,
and adds scripts/update-owner-0.4.55.sh plus its installation-outcome coverage.
Controller behavior, reverse-proxy settings and the standalone application
are unchanged.

The navigation regression failed before the implementation and all 16 focused
tests passed afterward. All five original-commit CI checks passed, covering
Node 22/24, Homebridge 2.0/2.4, and desktop/mobile browsers:
https://github.com/pponce/homebridge-gdoor-admin-controller/actions/runs/40419515222.
The versioned revision must pass Coordinator checks before promotion and on main
before the existing workflow creates the GitHub release and its assets.

Local release validation passed: all 576 tests, including 66 installation
outcomes; Bash syntax and staged whitespace; release-note generation; all ten
generated demo files; and the 125-file npm package allowlist/integrity check.

The owner explicitly authorized GitHub release, npm publication and updating
the local checkout on 2026-10-26. npm publication and installation run on the
owner's authenticated host. Use the full reviewed commit and pinned version;
keep generated publication/download receipts inside the repository's .release
directory. The updater verifies source and npm integrity before stopping
Homebridge, then uses stop, pinned add, verification, start. An installation
failure leaves Homebridge stopped. Browser authentication URLs are printed
for manual approval. No live services or physical hardware were used here.

Next steps: publish the release-preparation commit on the existing PR branch,
verify all five checks, advance main without overwriting other work, and
verify its CI, v0.4.55 tag and GitHub release assets. Supply the pinned Bash
launcher for the owner to publish npm and update Homebridge. Confirm the
installed version and normal dashboard-link sign-in flow afterward.

The separate DNS dashboard help is published in pponce/ddns-dnsexit-custom
main at c5f5c21fc782c15078e6403ef5af8d5ea67bcdc0. Its source update needs a
browser reload; installation confirmation remains pending. Separate Roborock
capture work remains outside this release.
