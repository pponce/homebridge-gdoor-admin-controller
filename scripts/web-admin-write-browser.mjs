import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { webBrowserFixture } from './web-admin-browser-fixture.mjs';

const playwright = await import(pathToFileURL(join(process.env.PLAYWRIGHT_MODULE, 'index.mjs')).href);
let browser;
try {
  for (const kind of ['chromium', 'webkit']) {
    const f = await webBrowserFixture(), phone = kind === 'webkit';
    const setupServer = http.createServer(async (request, response) => {
      try {
        if (request.url === '/web-admin.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(new URL('../homebridge-ui/public/web-admin.js', import.meta.url))); return; }
        if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(await readFile(new URL('../homebridge-ui/public/style.css', import.meta.url))); return; }
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main><section id="panel" class="panel"></section></main><script type="module">import { WebAdminPanel } from "/web-admin.js";window.panel=new WebAdminPanel(document.querySelector("#panel"),{request:window.setupRequest});await panel.load(true);</script></body></html>');
      } catch { response.statusCode = 500; response.end(); }
    });
    await new Promise(resolve => setupServer.listen(0, '127.0.0.1', resolve));
    try {
      browser = await playwright[kind].launch({ headless: true });
      const context = await browser.newContext({ ignoreHTTPSErrors: true, ...(phone ? playwright.devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } }) });
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => { void dialog.accept(); });
      await page.exposeFunction('setupRequest', async (route, body) => {
        if (route === '/web-admin') return { webAdmin: await f.manager.status() };
        assert.equal(route, '/web-admin/configure'); return { configured: true, webAdmin: await f.manager.configure(body) };
      });
      await page.goto('http://127.0.0.1:' + setupServer.address().port);
      await page.locator('[name="enabled"]').waitFor(); assert.equal(await page.locator('[name="enabled"]').isChecked(), false);
      await page.locator('[name="enabled"]').check();
      await page.getByText('Advanced network settings', { exact: true }).click();
      await page.locator('[name="customNetwork"]').check(); await page.locator('[name="publicUrl"]').fill(f.origin);
      await page.locator('[name="port"]').fill(String(f.settings.port)); await page.locator('[name="origin"]').fill(f.origin);
      await page.locator('[name="connection"]').check();
      await page.locator('[name="username"]').fill('Owner'); await page.locator('[name="password"]').fill(f.password); await page.locator('[name="repeat"]').fill(f.password);
      await page.getByRole('button', { name: 'Save web settings', exact: true }).click();
      await page.getByText('Saved. Web admin is running.', { exact: true }).waitFor();
      assert.deepEqual(f.writes, []); assert.equal(await page.locator('[data-web-account]').isVisible(), false);
      await page.goto(f.origin); await page.locator('#username').fill('Owner'); await page.locator('#password').fill(f.password); await page.locator('#login button').click();
      const ready = () => page.waitForFunction(() => !document.querySelector('#settings-gear').disabled);
      await page.locator('#user-list [data-id]').first().waitFor(); await ready();
      await page.locator('#user-list [data-id]').first().click(); await ready();
      assert.equal(await page.locator('#hb-use').isVisible(), true);
      assert.equal(await page.locator('#hb-use').isDisabled(), true);
      await page.getByText('Run homebridge-deconz in its own child bridge, separate from Garage Door Admin Controller.', { exact: true }).waitFor();
      async function navigate(id) { if (phone) await page.locator('#mobile-menu').click(); await page.locator('[data-page="' + id + '"]').click(); await page.locator('#' + id).waitFor({ state: 'visible' }); await ready(); }
      await page.locator('#name').fill('Owner renamed');
      await page.locator('#editor button.primary').click(); await page.getByText('Saved. A private recovery snapshot was created before the change.', { exact: true }).waitFor();
      assert.equal(f.data.responses['/alarmsystems/users']['a'.repeat(32)].name, 'Owner renamed');
      await page.locator('#pin').fill('5678'); await page.locator('#pin-repeat').fill('5678'); await page.locator('#editor button.primary').click();
      await page.getByText('PIN updated and verified.', { exact: true }).waitFor(); assert.equal(await page.locator('#pin').inputValue(), '');
      await navigate('alarm');
      const timer = page.locator('[data-alarm-timer="armed_stay_entry_delay"]'); await timer.fill('17'); await page.locator('#alarm-save').click();
      await page.waitForFunction(() => document.querySelector('#alarm-save') && !document.querySelector('#alarm-save').disabled && document.querySelector('[data-alarm-timer="armed_stay_entry_delay"]').value === '17');
      assert.equal(f.data.responses['/alarmsystems/1'].config.armed_stay_entry_delay, 17);
      f.state.loseNextAlarmReply = true; await timer.fill('19'); await page.locator('#alarm-save').click();
      await page.locator('#recovery-review').waitFor({ state: 'visible' });
      const count = f.writes.length; await page.locator('#recovery-review').click();
      await page.locator('#recovery-completion').waitFor({ state: 'visible' }); await page.locator('#recovery-ack').check(); await page.locator('#recovery-confirm').click();
      await page.getByText('Recovery completed. The gateway write was not repeated.', { exact: true }).waitFor(); assert.equal(f.writes.length, count);
      await page.locator('#settings-gear').click(); await page.locator('#settings-content').waitFor({ state: 'visible' });
      await page.locator('#settings-home-screen-name').fill('My keypad'); await page.locator('#settings-preferences button').click();
      await page.getByText('Display and discovery preferences saved.', { exact: true }).waitFor();
      await page.locator('#tab-connections').click(); assert.equal(await page.locator('[data-gateway-form]').count(), 0);
      assert.match(await page.locator('#settings-gateways').textContent(), /Homebridge settings/);
      await page.locator('#tab-security').click(); await page.locator('#settings-add-account').click();
      const account = page.locator('#settings-account-editor'); await account.locator('[name="username"]').fill('Guest');
      await account.locator('[name="password"]').fill('synthetic-guest-password'); await account.locator('[name="repeat_password"]').fill('synthetic-guest-password');
      await account.locator('[name="current_password"]').fill(f.password); await account.getByRole('button', { name: 'Save account', exact: true }).click();
      await page.getByText('Web account created.', { exact: true }).waitFor(); assert.equal(await page.locator('[data-web-account]').count(), 2);
      await page.locator('#settings-close').click(); await navigate('history'); assert.ok(await page.locator('#activity .gp-history-row').count() >= 3);
      if (process.env.PREVIEW_OUTPUT) { await mkdir(process.env.PREVIEW_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.PREVIEW_OUTPUT, kind + '-durable-write-history.png'), fullPage: true }); }
      // Exercise the production PIN transaction and browser confirmation while
      // substituting only the host service port. No service or hardware exists.
      f.state.homebridgeAvailable = true; await navigate('users');
      await page.locator('#user-list [data-id="' + 'a'.repeat(32) + '"]').click();
      assert.equal(await page.locator('#pin-guidance').textContent(), 'For user edits, leave both fields blank to keep the current PIN.');
      assert.equal(await page.locator('#hb-use').evaluate(el => el.closest('.gp-identity-options').querySelector('label:first-child input').id), 'enabled');
      assert.equal(await page.locator('#pin-guidance').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('#pin')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
      await page.getByLabel('Use for homebridge', { exact: true }).check();
      assert.match(await page.locator('#pin-guidance').textContent(), /^Enter a PIN in both fields to use for Homebridge and this user\./);
      await page.locator('#hb-use').uncheck();
      assert.equal(await page.locator('#pin-guidance').textContent(), 'For user edits, leave both fields blank to keep the current PIN.');
      await page.locator('#hb-use').check(); await page.locator('[data-hb-alarm="1"]').check();
      await page.locator('#pin').fill('6789'); await page.locator('#pin-repeat').fill('6789'); await page.locator('#editor button.primary').click();
      assert.equal(await page.locator('[name="homebridge-clear-logs"]').isChecked(), false);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const restart = page.getByRole('button', { name: 'Update PIN', exact: true });
      assert.equal(await restart.isEnabled(), false); assert.equal(f.maintenance.includes('stop'), false);
      assert.match(await page.locator('#hb-flow-content').textContent(), /same page/);
      assert.equal(await page.locator('[name="homebridge-username"]').count(), 0);
      await page.locator('[name="homebridge-restart-confirmed"]').check();
      // A failed submission must not adopt the older completed policy transaction.
      const beforeFailure = f.writes.length;
      let failedSubmissions = 0;
      await page.route('**/api/users/rotate-pin', async route => {
        failedSubmissions++;
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'maintenance_preflight_failed:homebridge_cli_discovery_failed:coded_error' }) });
      });
      await restart.click();
      await page.getByText('Update did not start. No PIN was changed.', { exact: true }).waitFor();
      assert.match(await page.locator('#hb-flow-content').textContent(), /homebridge_cli_discovery_failed/);
      assert.match(await page.locator('#hb-flow-content').textContent(), /no new pending update/);
      assert.equal(failedSubmissions, 1); assert.equal(f.writes.length, beforeFailure);
      assert.equal(f.maintenance.includes('stop'), false);
      await page.locator('#hb-flow-close').click(); await ready();
      await page.unroute('**/api/users/rotate-pin');
      await page.locator('#hb-use').check(); await page.locator('[data-hb-alarm="1"]').check();
      await page.locator('#pin').fill('6789'); await page.locator('#pin-repeat').fill('6789');
      await page.locator('#editor button.primary').click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      assert.equal(await page.locator('[name="homebridge-username"]').count(), 0);
      await page.locator('[name="homebridge-restart-confirmed"]').check();
      // A stopped bridge with no confirmed backup must have a usable cancel path.
      f.state.failBackupOnce = true;
      const writesBeforeCancel = f.writes.length;
      await restart.click();
      await page.getByText('Cancel the unfinished PIN change', { exact: true }).waitFor();
      await page.locator('#hb-flow-close').click();
      await page.getByRole('button', { name: 'Continue Homebridge update', exact: true }).click();
      assert.equal(await page.locator('[name="homebridge-username"]').count(), 0);
      await page.getByRole('button', { name: 'Cancel PIN change and restore service', exact: true }).click();
      await page.getByText('Update finished without applying the change', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      assert.equal(f.writes.length, writesBeforeCancel);
      assert.equal(f.state.bridgeStopped, false);
      await page.locator('#interrupted-change').waitFor({ state: 'hidden' });
      // A fresh update is allowed after cancellation; no manual state reset.
      await page.locator('#hb-use').check(); await page.locator('[data-hb-alarm="1"]').check();
      await page.locator('#pin').fill('6789'); await page.locator('#pin-repeat').fill('6789');
      await page.locator('#editor button.primary').click();
      await page.locator('[name="homebridge-clear-logs"]').check();
      f.state.failClearLogs = true;
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.locator('[name="homebridge-username"]').fill('BridgeAdmin');
      await page.locator('[name="homebridge-password"]').fill('synthetic-bridge-password');
      await page.locator('[name="homebridge-restart-confirmed"]').check();
      const stopsBefore = f.maintenance.filter(value => value === 'stop').length;
      const startsBefore = f.maintenance.filter(value => value === 'start').length;
      const pinWritesBefore = f.writes.filter(([, route]) => route === '/alarmsystems/users/' + 'a'.repeat(32)).length;
      f.state.failRunningOnce = true;
      await restart.click();
      await page.getByText('Continue the saved Homebridge update', { exact: true }).waitFor();
      assert.match(await page.locator('#hb-flow-content').textContent(), /Failed step: Homebridge deCONZ — Restore service and device readiness/);
      assert.match(await page.locator('#hb-flow-content').textContent(), /maintenance_step_failed \(Internal type error\)/);
      assert.equal((await page.locator('#hb-flow-content').textContent()).includes('synthetic private error'), false);
      await page.locator('[name="homebridge-username"]').fill('BridgeAdmin');
      await page.locator('[name="homebridge-password"]').fill('synthetic-bridge-password');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByText('PIN updated successfully, but Homebridge logs could not be confirmed cleared. You can clear them from Homebridge UI.', { exact: true }).waitFor();
      assert.equal(f.maintenance.filter(value => value === 'logs cleared').length, 1);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByText('Homebridge access updated.', { exact: true }).waitFor();
      assert.equal(f.writes.filter(([, route]) => route === '/alarmsystems/users/' + 'a'.repeat(32)).length, pinWritesBefore + 1);
      assert.equal(f.maintenance.filter(value => value === 'stop').length, stopsBefore); assert.equal(f.maintenance.filter(value => value === 'start').length, startsBefore);
      assert.equal(await page.locator('#login').isVisible(), false); assert.equal(await page.locator('#users').isVisible(), true);
      assert.equal(await page.locator('[name="homebridge-password"]').count(), 0);
      assert.equal(await page.locator('#hb-use').count(), 0);
      assert.match(await page.locator('#pin-guidance').textContent(), /Leave both fields blank to keep the current PIN/);
      assert.equal(await page.locator('#hb-configuration').isVisible(), true);
      await page.locator('#pin').fill('7890'); await page.locator('#pin-repeat').fill('7890');
      await page.locator('#editor button.primary').click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      assert.equal(await page.locator('[name="homebridge-username"]').count(), 0);
      await page.locator('[name="homebridge-restart-confirmed"]').check();
      await page.getByRole('button', { name: 'Update PIN', exact: true }).click();
      await page.getByText('Homebridge access updated', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      assert.equal(f.writes.filter(([, route]) => route === '/alarmsystems/users/' + 'a'.repeat(32)).length, pinWritesBefore + 2);

      // Isolated recovery dialog: successful auth plus blocked review must show
      // the reason, remove password fields, and never replay a PIN or restart.
      const recoveryPage = await page.context().newPage();
      await recoveryPage.setContent('<div id="configurator-preview"></div>');
      await recoveryPage.addScriptTag({ content: await readFile(new URL('../web-admin/public/homebridge-flow.js', import.meta.url), 'utf8') });
      await recoveryPage.evaluate(() => {
        window.recoveryCalls = [];
        const tx = { id: 'test-operation', stage: 'recovery_required', homebridge: true, alarm: 1, verified: false, write_attempted: false };
        window.recoveryFlow = window.ConfiguratorHomebridgeFlow({
          extensions: () => [], nativeHomebridge: () => true,
          api: async route => { window.recoveryCalls.push(route);
            if (route === 'transaction') return tx;
            if (route === 'homebridge/authorize-recovery') return { authorized: true };
            if (route === 'recovery/review') return { transaction_id: tx.id, ready: false, diagnostics: [{ check: 'private_backup', reason: 'homebridge_snapshot_unverified' }] };
            throw Error('Unexpected mutation');
          }, save: () => { throw Error('PIN replay forbidden'); }
        });
        void window.recoveryFlow.open({ context: { gateway: 'test', alarm: 1 }, transaction: tx });
      });
      await recoveryPage.locator('[name="homebridge-username"]').fill('BridgeAdmin');
      await recoveryPage.locator('[name="homebridge-password"]').fill('synthetic-password');
      await recoveryPage.getByRole('button', { name: 'Cancel PIN change and restore service', exact: true }).click();
      await recoveryPage.getByText('A recovery check needs attention', { exact: true }).waitFor();
      assert.match(await recoveryPage.locator('#hb-flow-content').textContent(), /homebridge_snapshot_unverified/);
      assert.equal(await recoveryPage.locator('input[type="password"]').count(), 0);
      assert.equal(await recoveryPage.locator('#hb-flow-actions button').count(), 0);
      assert.deepEqual(await recoveryPage.evaluate(() => window.recoveryCalls), ['transaction', 'homebridge/authorize-recovery', 'recovery/review']);
      await recoveryPage.locator('#hb-flow-close').click(); await recoveryPage.close();
      await page.locator('#logout').click(); await page.locator('#username').fill('Guest'); await page.locator('#password').fill('synthetic-guest-password'); await page.locator('#login button').click();
      await page.locator('#users').waitFor({ state: 'visible' }); await ready();
      assert.equal(await page.locator('#user-list [data-id="' + 'a'.repeat(32) + '"]').count(), 0);
      assert.deepEqual(errors, []); assert.deepEqual(f.errors, []);
      await context.close(); await browser.close(); browser = null;
      console.log(kind + ': Homebridge setup, production TLS, rename, PIN, alarm save, lost-reply recovery without replay, preferences, accounts, activity, confirmed child-bridge PIN restart and Regular protections passed');
    } finally { if (browser) { await browser.close(); browser = null; } await new Promise(resolve => setupServer.close(resolve)); await f.close(); }
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'result=Desktop and mobile production setup, durable saves and no-replay recovery passed\n');
} catch (error) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'result=' + String(error.stack || error).replaceAll('\n', ' ').slice(0, 1500) + '\n');
  throw error;
}
