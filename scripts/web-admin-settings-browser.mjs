// Desktop/mobile checks for automatic LAN setup and the real timing editor.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm, mkdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CoordinatorRuntime } from '../src/runtime.js';
import { WebAdminController } from '../src/web-admin-controller.js';
import { loadIdentity } from '../src/storage.js';
import { defaultWebSettings, validateWebSettings } from '../src/web-admin-settings.js';

const playwright = await import(pathToFileURL(join(process.env.PLAYWRIGHT_MODULE, 'index.mjs')).href);
const server = http.createServer(async (request, response) => {
  const routes = { '/web-admin.js': 'homebridge-ui/public/web-admin.js', '/controller.js': 'web-admin/public/controller.js',
    '/style.css': 'web-admin/public/style.css', '/setup.css': 'homebridge-ui/public/style.css' };
  if (routes[request.url]) { response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'); response.end(await readFile(routes[request.url])); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(request.url === '/setup' ? '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/setup.css"><main><section id="panel" class="panel"></section></main><script type="module">import {WebAdminPanel} from "/web-admin.js";window.panel=new WebAdminPanel(document.querySelector("#panel"),{request:window.request});await panel.load(true);</script>' :
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><script src="/controller.js"></script><div id="configurator-preview"><main class="gp-main"><h2>Controller</h2><div id="controller"></div></main></div><script>window.panel=ConfiguratorController({root:document.querySelector("#controller"),api:window.request,readOnly:()=>window.readOnly===true});panel.load();</script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  for (const kind of ['chromium', 'webkit']) {
    browser = await playwright[kind].launch({ headless: true });
    const context = await browser.newContext(kind === 'webkit' ? playwright.devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    let setup = { revision: 0, settings: defaultWebSettings(), running: false, error: null, accountConfigured: false,
      network: { addresses: ['192.0.2.10'], suggestedAddress: '192.0.2.10' }, connections: [{ id: 'deconz', name: 'Gateway' }] };
    await page.exposeFunction('request', async (path, body) => {
      if (path === '/web-admin') return { webAdmin: setup };
      assert.equal(path, '/web-admin/configure'); validateWebSettings(body.settings);
      setup = { ...setup, revision: setup.revision + 1, settings: body.settings, accountConfigured: true, running: body.settings.enabled };
      return { configured: true, webAdmin: setup };
    });
    await page.goto(origin + '/setup');
    await page.getByLabel('Enable web admin', { exact: true }).check();
    assert.equal(await page.locator('[name="connection"]').isChecked(), true);
    assert.equal(await page.locator('[name="publicUrl"]').isVisible(), false);
    await page.locator('[name="username"]').fill('Owner'); await page.locator('[name="password"]').fill('synthetic-password'); await page.locator('[name="repeat"]').fill('synthetic-password');
    await page.getByRole('button', { name: 'Save web settings', exact: true }).click();
    await page.getByText('Saved. Web admin is running.', { exact: true }).waitFor();
    assert.equal(setup.settings.bind, '0.0.0.0'); assert.equal(setup.settings.origin, 'https://192.0.2.10:9443');
    assert.equal(await page.locator('[data-web-open]').getAttribute('href'), setup.settings.origin);
    setup = { ...setup, settings: { ...setup.settings, publicUrl: 'https://garage.example.test' } };
    await page.reload(); await page.locator('[name="enabled"]').waitFor();
    await page.getByRole('button', { name: 'Save web settings', exact: true }).click();
    await page.getByText('Saved. Web admin is running.', { exact: true }).waitFor();
    assert.equal(setup.settings.publicUrl, 'https://garage.example.test');
    setup = { ...setup, revision: 0, settings: defaultWebSettings(), accountConfigured: false, running: false, network: { addresses: [], suggestedAddress: null } };
    await page.reload(); await page.getByLabel('Enable web admin', { exact: true }).check();
    await page.locator('[name="username"]').fill('Owner'); await page.locator('[name="password"]').fill('synthetic-password'); await page.locator('[name="repeat"]').fill('synthetic-password');
    await page.getByRole('button', { name: 'Save web settings', exact: true }).click();
    await page.getByText('Enter the Homebridge machine’s local IPv4 address in Advanced network settings.', { exact: true }).waitFor();
    assert.equal(setup.revision, 0);
    await page.close();

    const storagePath = await mkdtemp(join(tmpdir(), 'controller-browser-'));
    await loadIdentity(storagePath);
    const config = JSON.parse(await readFile('examples/development-config.json'));
    config.controllers[0].inputs = [{ id: 'button', name: 'Indoor button', enabled: true,
      source: { type: 'deconz', kind: 'button', baseUrl: 'http://example.invalid', gatewayId: '0011223344556677', resourceId: '80', uniqueId: 'button-endpoint', resourceType: 'ZHASwitch', modelId: 'EXAMPLE', manufacturer: 'Example', credentialRef: 'example-key' },
      trigger: 1002, action: 'toggle', motorPath: 'primary', busyBehavior: 'drop', rearmSeconds: 1.5, timing: {} }];
    let failReads = false; const hardwareWrites = [];
    const drivers = async () => ({
      door: { read: async () => ({door:'closed',blocked:failReads,obstruction:false,evidence:'closed-sensor'}), write:async()=>hardwareWrites.push('door') },
      bolt: { read: async () => ({locked:true,evidence:'relay'}), write:async()=>hardwareWrites.push('bolt') },
      motorPaths:{}, inputDrivers:new Map([['button',{inspect:async()=>({}),read:async()=>({})}]])
    });
    const runtime = new CoordinatorRuntime({ storagePath, configuration: config, drivers }); await runtime.start();
    const controller = new WebAdminController(runtime); let saves = 0, loseReply = false;
    const editor = await context.newPage(); editor.on('pageerror', error => errors.push(error.message)); editor.on('dialog', dialog => dialog.accept());
    await editor.exposeFunction('request', async (path, body) => {
      if (path === 'controller') return controller.dispatch('controller_settings', {});
      if (path === 'controller/recover') return controller.dispatch('controller_recover', body);
      assert.equal(path, 'controller/timings'); saves++;
      const result = await controller.dispatch('controller_timings_save', body);
      if (loseReply) { loseReply = false; throw Error('simulated response loss'); } return result;
    });
    try {
      await editor.goto(origin + '/controller'); await editor.locator('[data-default-group="timing"]').first().waitFor();
      const id=config.controllers[0].id;
      await runtime.commission(id,{revision:runtime.state.revision,previousControllerStopped:true,physicalSetupReviewed:true});
      for (const listener of runtime.entry(id).listeners) listener.stop();
      failReads=true; await runtime.entry(id).engine.observe(); await editor.evaluate(()=>panel.load());
      assert.equal(runtime.status(id).enabled,true); assert.equal(runtime.status(id).health.title,'Fault');
      await editor.getByText(/Enabled · Fault/).waitFor();
      assert.equal(await editor.getByRole('button',{name:'Check again',exact:true}).count(),1);
      failReads=false; await editor.getByRole('button',{name:'Check again',exact:true}).click();
      await editor.getByText('Device states checked. No movement command was sent.',{exact:true}).waitFor();
      await editor.getByText(/Enabled · Ready · Closed/).waitFor();
      for (const listener of runtime.entry(id).listeners) listener.stop();
      assert.equal(runtime.status(id).enabled,true); assert.deepEqual(hardwareWrites,[]);
      await editor.locator('[data-default-group="timing"][data-key="openRetractSettleSeconds"]').fill('0.3');
      await editor.getByText('Indoor button', { exact: true }).click();
      await editor.locator('[data-inherit="0"][data-key="closeRetractSettleSeconds"]').uncheck();
      await editor.locator('[data-input-index="0"][data-key="closeRetractSettleSeconds"]').fill('0');
      await editor.getByRole('button', { name: 'Review timing changes', exact: true }).click();
      await editor.getByRole('button', { name: 'Apply timings', exact: true }).click();
      await editor.getByText('Timings saved and active. Homebridge was not restarted.', { exact: true }).waitFor();
      assert.equal(runtime.configuration.controllers[0].timing.openRetractSettleSeconds, 0.3);
      assert.equal(runtime.configuration.controllers[0].inputs[0].timing.closeRetractSettleSeconds, 0); assert.equal(saves, 1);
      await editor.getByText('Indoor button', { exact: true }).click();
      await editor.locator('[data-inherit="0"][data-key="closeRetractSettleSeconds"]').check();
      await editor.getByRole('button', { name: 'Review timing changes', exact: true }).click();
      await editor.getByRole('button', { name: 'Apply timings', exact: true }).click();
      await editor.getByText('Timings saved and active. Homebridge was not restarted.', { exact: true }).waitFor();
      assert.deepEqual(runtime.configuration.controllers[0].inputs[0].timing, {});
      assert.equal(saves, 2);
      loseReply = true;
      await editor.locator('[data-default-group="feedback"][data-key="closingSeconds"]').fill('14');
      await editor.getByRole('button', { name: 'Review timing changes', exact: true }).click();
      await editor.getByRole('button', { name: 'Apply timings', exact: true }).click();
      await editor.getByText('The save result could not be confirmed. Reload saved timings before making another change.', { exact: true }).waitFor();
      assert.equal(saves, 3); assert.equal(await editor.getByRole('button', { name: 'Review timing changes', exact: true }).isDisabled(), true);
      await editor.getByRole('button', { name: 'Reload saved timings', exact: true }).click();
      await editor.waitForFunction(() => document.querySelector('[data-default-group="feedback"][data-key="closingSeconds"]')?.value === '14');
      assert.equal(saves, 3);
      if (process.env.PREVIEW_OUTPUT) { await mkdir(process.env.PREVIEW_OUTPUT, { recursive: true }); await editor.screenshot({ path: join(process.env.PREVIEW_OUTPUT, 'controller-' + kind + '.png'), fullPage: true }); }
      assert.equal(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await editor.evaluate(async () => { window.readOnly = true; await panel.load(); });
      assert.equal(await editor.getByRole('button', { name: 'Review timing changes', exact: true }).isDisabled(), true);
      assert.deepEqual(errors, []);
    } finally { await runtime.stop(); await rm(storagePath, { recursive: true, force: true }); }
    await browser.close(); browser = null;
    console.log(kind + ': automatic LAN setup, custom setting retention, overrides, live save and response loss passed');
  }
} catch (error) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'result=' + String(error.stack).replaceAll('\n', ' ').slice(0,1500) + '\n');
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
