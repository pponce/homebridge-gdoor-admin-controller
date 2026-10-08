// Build an isolated static demo from the real UI. Never reads private settings.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { controllerTimingFields } from '../src/controller-timings.js';

const source = new URL('../web-admin/public/', import.meta.url);
const destination = new URL('../web/demo/', import.meta.url);
const check = process.argv.includes('--check');
const files = new Map();
const read = name => readFile(new URL(name, source), 'utf8');
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw Error('Demo source anchor changed: ' + from.slice(0, 80));
  return text.replace(from, to);
}
for (const name of ['keypad.js', 'settings.js', 'homebridge-flow.js', 'controller.js', 'app-icon.svg']) files.set(name, await read(name));
files.set('controller.js', replaceOnce(files.get('controller.js'), 'Timings saved and active. Homebridge was not restarted.', 'Demo timings saved in this tab. No devices were contacted.'));
files.set('demo.js', replaceOnce(await read('demo.js'), "const KEY='configurator-demo-v2'", "const KEY='gdoor-public-demo-v1'"));
let app = await read('app.js');
const apiStart = app.indexOf('  async function api('), apiEnd = app.indexOf('  const controllerPanel=', apiStart);
if (apiStart < 0 || apiEnd < apiStart) throw Error('Demo API boundary changed');
app = app.slice(0, apiStart) + '  async function api(path, body, context={gateway:selectedGateway,alarm:selectedAlarm}) { return window.StaticDemo.request(path, body, context); }\n' + app.slice(apiEnd);
app = replaceOnce(app, 'let demoMode=false,', 'let demoMode=true,');
app = replaceOnce(app, "demoMode=!regular&&sessionStorage.getItem('configurator-demo-active')==='true';", 'demoMode=true;');
app = app.replaceAll('demoMode||!applicationSettings', '!applicationSettings');
const switchStart = app.indexOf("  $('#demo-mode').onchange="), switchEnd = app.indexOf("  $('#demo-reset').onclick=", switchStart);
if (switchStart < 0 || switchEnd < switchStart) throw Error('Demo mode boundary changed');
app = app.slice(0, switchStart) + "  $('#demo-mode').onchange=()=>{$('#demo-mode').checked=true;};\n" + app.slice(switchEnd);
app = app.replaceAll('configurator-demo-', 'gdoor-public-demo-').replaceAll('configurator-navigation', 'gdoor-public-demo-navigation');
app = replaceOnce(app, 'window.ConfiguratorDemo.reset();clearContext();', 'window.StaticDemo.reset();clearContext();');
files.set('app.js', app);
files.set('standalone.js', 'window.StaticDemoFields=' + JSON.stringify(controllerTimingFields) + ';\n' + await readFile(new URL('demo/standalone.js', import.meta.url), 'utf8'));
files.set('style.css', await read('style.css') + '\n/* Public demo has no login, live-mode switch, or installation maintenance. */\n#configurator-preview #login,#configurator-preview #logout,#configurator-preview #settings-gear,#configurator-preview label:has(#demo-mode),#configurator-preview label:has(#debug-mode){display:none!important}\n');
let html = await read('index.html');
html = replaceOnce(html, '<title>deCONZ · Administration</title>', '<title>Garage Door Admin Controller · Interactive demo</title><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'; object-src \'none\'"><meta name="robots" content="noindex">');
html = replaceOnce(html, '<script src="/app.js" defer></script>', '<script src="/standalone.js" defer></script><script src="/app.js" defer></script>');
html = html.replace(/<link rel="apple-touch-icon"[^>]*>|<link rel="manifest"[^>]*>/g, '');
html = html.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./');
html = replaceOnce(html, '<span>Local administration</span>', '<span>Interactive demo · fictional data</span>');
html = replaceOnce(html, 'Turn off demo to return to your unchanged real setup.', 'This is a standalone preview. No sign-in or hardware connection is available. Controller timing edits are simulated; installation settings and maintenance are not included.');
files.set('index.html', html);
if (!check) await mkdir(destination, { recursive: true });
for (const [name, content] of files) {
  if (check) {
    if (await readFile(new URL(name, destination), 'utf8') !== content) throw Error('Rebuild stale demo file: ' + name);
  } else await writeFile(new URL(name, destination), content);
}
console.log(`${check ? 'Verified' : 'Built'} ${files.size} static demo files in web/demo.`);
