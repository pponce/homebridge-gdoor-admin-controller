# Host the interactive demo

Publish the contents of **demo/** with any static web server. The entry point is **demo/index.html**. No Node.js server, Homebridge installation, deCONZ gateway, credentials, or backend proxy is needed. Relative asset paths support a site root or a subdirectory such as `/garage-demo/`.

For a local preview from the repository root:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web/demo
```

Then open http://127.0.0.1:8080. For public hosting, use HTTPS so browser features such as UUID generation work. Serve this folder as static files; do not point it at a live administration backend. Opening the HTML directly as a `file:` URL is not supported.

## GitHub Pages

The included **Deploy web demo** workflow publishes only `web/demo`, with `index.html` at the site root. Keep the written documentation in `docs`; no directory move is needed.

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open **Actions → Deploy web demo → Run workflow**, select **main**, and run it. If the initial automatic run failed before Pages was enabled, rerun it after selecting the source.
4. Wait for the deployment to finish. Open the URL in the deployment summary or **Settings → Pages**.

Without a custom domain, the expected address is `https://pponce.github.io/homebridge-gdoor-admin-controller/`. It becomes available after the first successful deployment. Future changes to `web/demo` on `main` deploy automatically. No custom domain, home server, or reverse proxy is required.

If GitHub asks you to choose a static-site starter workflow, you can skip it: this repository already contains `.github/workflows/pages.yml`. GitHub Free supports Pages for public repositories; Pages for private repositories requires an eligible paid plan.

## What visitors can try

- Explore fictional gateways, users, grants, schedules, and alarms.
- Change sample access policies and keypad protection settings.
- Use the virtual keypad with the fictional code **2323**.
- Open **Controller**, select a garage, edit timings, and review/apply changes to an in-memory sample.
- Use **Reset demo** to restore the sample data.

The page is permanently in demo mode. There is no login or live-mode switch. Network connections and form submission are blocked by its Content Security Policy, and application requests use the local simulator. No hardware can be controlled. PIN values are not saved. Fictional user/policy edits use browser storage; controller timing edits reset on page reload.

This is a UI preview, not a hardware simulator or an exact model of physical Xfinity PIN-entry behavior. The Activity page explains that demo actions do not create real history. Installation settings, web-account administration, and Homebridge PIN maintenance require the installed plugin and are not included in the demo.

After hosting, add the actual URL to the **Interactive demo** link in the root README. Until then, that link opens these hosting instructions rather than claiming a live site exists.

## For developers

The static folder is generated from the plugin's real web assets plus `scripts/demo/standalone.js`. After UI changes, run:

```sh
node scripts/build-demo.mjs
node scripts/build-demo.mjs --check
```

The public demo is separate from the installed web server and is not included in the npm package.
