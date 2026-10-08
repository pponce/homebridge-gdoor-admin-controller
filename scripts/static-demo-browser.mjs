// Serve only static demo assets; any attempted API/device connection is a failure.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowed = new Set(['index.html', 'app.js', 'demo.js', 'standalone.js', 'keypad.js', 'settings.js', 'homebridge-flow.js', 'controller.js', 'style.css', 'app-icon.svg']);
const unexpected = [], failures = [];
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname.replace(/^\/(?:demo\/)?/, '') || 'index.html';
  if (req.method !== 'GET' || !allowed.has(file)) { unexpected.push(req.method + ' ' + pathname); res.writeHead(404).end(); return; }
  const body = await readFile(new URL('../web/demo/' + file, import.meta.url));
  const ext = file.split('.').pop();
  res.writeHead(200, { 'Content-Type': ({ html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' })[ext] }); res.end(body);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const playwright = await import(pathToFileURL(join(process.env.PLAYWRIGHT_MODULE, 'index.mjs')).href);
let browser;
try {
  for (const kind of ['chromium', 'webkit']) {
    browser = await playwright[kind].launch({ headless: true });
    const mobile = kind === 'webkit';
    const context = await browser.newContext(mobile ? playwright.devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => failures.push(error.message));
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { failures.push('External request'); return route.abort(); }
      return route.continue();
    });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(origin + (mobile ? '/demo/' : '/'));
    const ready = () => page.waitForFunction(() => !document.querySelector('#settings-gear').disabled && !document.querySelector('#application').hidden);
    async function navigate(id) {
      await ready();
      if (mobile) await page.locator('#mobile-menu').click();
      await page.locator('[data-page="' + id + '"]').click(); await ready();
    }
    await page.locator('#user-list [data-id]').first().waitFor(); await ready();
    assert.equal(await page.locator('#login').isVisible(), false);
    assert.equal(await page.locator('#demo-mode').isVisible(), false);
    assert.match(await page.locator('#demo-banner').textContent(), /standalone preview/);
    await navigate('gateway'); assert.equal(await page.locator('#gateway-inventory .gp-alarm-card').count(), 7);
    await navigate('access'); assert.ok(await page.locator('#grant-preview .gp-grant-row').count() > 0);
    await navigate('protection'); assert.equal(await page.locator('#lockout-threshold').inputValue(), '6');
    await navigate('alarm'); assert.equal(await page.locator('[data-alarm-timer]').count(), 9);
    await navigate('controller');
    const selector = page.locator('[data-controller-select]');
    await selector.waitFor(); assert.equal(await selector.locator('option').count(), 2);
    assert.equal(await selector.evaluate(element => element.closest('label').firstChild.textContent.trim()), 'Garage Door');
    assert.ok((await selector.boundingBox()).width <= 321);
    const opening = page.locator('[data-default-group="feedback"][data-key="openingSeconds"]');
    await opening.fill('18');
    await page.getByRole('button', { name: 'Review timing changes', exact: true }).click();
    await page.getByRole('button', { name: 'Apply timings', exact: true }).click();
    await page.getByText('Demo timings saved in this tab. No devices were contacted.', { exact: true }).waitFor();
    assert.equal(await opening.inputValue(), '18');
    await selector.selectOption('demo-garage-1'); assert.equal(await opening.inputValue(), '15');
    await selector.selectOption('demo-garage-0'); assert.equal(await opening.inputValue(), '18');
    if (process.env.PREVIEW_OUTPUT) {
      await mkdir(process.env.PREVIEW_OUTPUT, { recursive: true });
      await page.screenshot({ path: join(process.env.PREVIEW_OUTPUT, 'static-demo-controller-' + kind + '.png'), fullPage: true });
    }
    await navigate('keypad'); assert.match(await page.locator('#keypad-description').textContent(), /2323/);
    await navigate('history'); assert.match(await page.locator('#activity').textContent(), /Demo actions do not create log rows/);
    // Even an accidental fetch cannot escape to the host's /api namespace.
    assert.equal(await page.evaluate(async () => { try { await fetch('/api/session'); return false; } catch { return true; } }), true);
    assert.deepEqual(unexpected, []); assert.deepEqual(failures, []);
    await context.close(); await browser.close(); browser = null;
    console.log(kind + ': static demo pages, timing edits, relative paths, and network isolation passed');
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'result=Desktop and mobile static demo passed; no API or external requests\n');
} catch (error) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'result=' + String(error.stack || error).replaceAll('\n', ' ').slice(0, 1500) + '\n');
  throw error;
} finally {
  if (browser) await browser.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
