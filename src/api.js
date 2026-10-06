import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { inventory, routingInventory, ConfigurationError } from './config.js';
import { Fault, requireValue } from './fault.js';

export const PLUGIN_VERSION = '0.4.0-dev.1';
export const CAPABILITIES = Object.freeze({ inventory: true, routingInventory: true, diagnostics: false, settingsWrite: false, motion: false, maintenance: false, keypad: false });
export function createManagementServer({ identity, configuration, diagnostics, runtime }) {
  const expectedAuthorization = Buffer.from(`Bearer ${identity.token}`);
  const envelope = { apiVersion: 1, instanceId: identity.instanceId };
  const controllers = () => runtime ? runtime.inventory() : inventory(configuration);
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, async (request, response) => {
    function send(status, value) {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    }
    try {
      const given = Buffer.from(request.headers.authorization ?? '');
      if (given.length !== expectedAuthorization.length || !timingSafeEqual(given, expectedAuthorization)) return send(401, { error: 'unauthorized' });
      if (request.headers.origin !== undefined) return send(403, { error: 'origin_not_allowed' });
      if (request.headers.host !== `127.0.0.1:${server.address().port}`) return send(403, { error: 'host_not_allowed' });
      if (runtime && request.url?.startsWith('/v1/')) {
        if (request.method === 'GET') {
          if (request.url === '/v1/settings') return send(200, { ...envelope, settings: runtime.settings() });
          if (request.url === '/v1/activity') return send(200, { ...envelope, events: runtime.state.events });
          if (request.url === '/v1/maintenance') return send(200, { ...envelope, maintenance: runtime.state.maintenance });
          if (request.url === '/v1/guard') return send(200, { ...envelope, ready: runtime.guard() });
          const state = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})\/state$/.exec(request.url);
          if (state) return send(200, { ...envelope, status: runtime.status(state[1]) });
        }
        if (request.method === 'POST' && !request.url.endsWith('/probe')) {
          requireValue(request.headers['content-type'] === 'application/json', 'invalid_request');
          const body = await readBody(request, 262144);
          requireValue(body && !Array.isArray(body) && body.instanceId === identity.instanceId, 'instance_mismatch');
          const exact = keys => requireValue(Object.keys(body).sort().join() === ['instanceId', ...keys].sort().join(), 'invalid_request');
          if (request.url === '/v1/commissioning/reset') { exact([]); return send(200, { ...envelope, result: await runtime.resetCommissioning() }); }
          if (request.url === '/v1/settings/review') { exact(['configuration', 'revision']); return send(200, { ...envelope, review: await runtime.review(body.configuration, body.revision) }); }
          if (request.url === '/v1/settings/cancel') { exact(['token']); return send(200, { ...envelope, review: runtime.cancelReview(body.token) }); }
          if (request.url === '/v1/settings/apply') { exact(['token']); return send(200, { ...envelope, settings: await runtime.apply(body.token) }); }
          const command = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})\/commands$/.exec(request.url);
          if (command) { exact(['command','requestId','issuedAt','bootId']); return send(202, { ...envelope, operation: await runtime.submit(command[1], body) }); }
          const commission = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})\/commission$/.exec(request.url);
          if (commission) { exact(['revision','previousControllerStopped','physicalSetupReviewed','recover']); return send(200, { ...envelope, status: await runtime.commission(commission[1], body) }); }
          const maintenance = /^\/v1\/maintenance\/(preflight|pause|verify|resume|complete)$/.exec(request.url);
          if (maintenance) { exact(['transactionId','physicalCheck','gateway']); requireValue(typeof body.physicalCheck === 'boolean', 'invalid_request'); return send(200, { ...envelope, acknowledged: await runtime.maintenance(maintenance[1], body.transactionId, body) }); }
          if (request.url === '/v1/maintenance/prepare') { exact(['gateway','confirmedClosed']); return send(200, { ...envelope, result: await runtime.prepareMaintenance(body.gateway, body.confirmedClosed) }); }
          if (request.url === '/v1/maintenance/confirm') { exact(['kind','token','confirmed']); return send(200, { ...envelope, acknowledged: await runtime.confirmMaintenance(body.kind, body.token, body.confirmed) }); }
          const begin = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})\/keypad-begin$/.exec(request.url);
          if (begin) { exact(['gatewayId','alarmId']); return send(200, { ...envelope, receipt: runtime.keypadBegin(begin[1], body) }); }
          if (request.url === '/v1/keypad-after') { exact(['token','outcome','mode','elapsed']); requireValue(['accepted','rejected','unknown'].includes(body.outcome) && ['disarm','arm_away','arm_stay','arm_night'].includes(body.mode), 'invalid_request');
            return send(200, { ...envelope, result: await runtime.keypadAfter(body.token, body.outcome, body.mode, body.elapsed) }); }
          return send(404, { error: 'not_found' });
        }
      }
      const probe = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})\/probe$/.exec(request.url ?? '');
      if (request.method === 'POST' && probe && diagnostics) {
        if (request.headers['content-type'] !== 'application/json') return send(400, { error: 'invalid_request' });
        let body;
        try { body = await readBody(request); } catch { return send(400, { error: 'invalid_request' }); }
        if (!body || Object.keys(body).join() !== 'instanceId' || body.instanceId !== identity.instanceId) return send(409, { error: 'instance_mismatch' });
        if (!controllers().some(row => row.id === probe[1])) return send(404, { error: 'not_found' });
        try { return send(200, { ...envelope, probe: await diagnostics.probe(probe[1]) }); }
        catch (error) {
          if (error.message === 'probe_busy') return send(409, { error: 'probe_busy' });
          throw error;
        }
      }
      if (request.method !== 'GET') return send(405, { error: 'read_only_milestone' });
      if (request.url === '/v1/identity') return send(200, { ...envelope, pluginVersion: PLUGIN_VERSION,
        mode: runtime ? 'managed' : diagnostics ? 'observation' : 'development', capabilities: { ...CAPABILITIES, diagnostics: Boolean(diagnostics), ...(runtime ? { settingsWrite: true, motion: true, maintenance: true, keypad: true } : {}) } });
      if (request.url === '/v1/controllers') return send(200, { ...envelope, controllers: controllers() });
      const routing = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})\/routing$/.exec(request.url ?? '');
      const routed = routing && (runtime?.configuration ?? configuration).controllers.find(item => item.id === routing[1]);
      if (routed) return send(200, { ...envelope, routing: runtime ? runtime.routing(routed.id) : routingInventory(routed) });
      const match = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})$/.exec(request.url ?? '');
      const controller = match && controllers().find(item => item.id === match[1]);
      if (controller) return send(200, { ...envelope, controller });
      return send(404, { error: 'not_found' });
    } catch (error) { return error instanceof Fault || error instanceof ConfigurationError ? send(error.message === 'controller_not_found' ? 404 : 409, { error: error.message }) : send(500, { error: 'internal_error' }); }
  });
  server.maxConnections = 32;
  return server;
}

function readBody(request, limit = 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const fail = () => { clearTimeout(timer); reject(new Error('invalid_request')); };
    const timer = setTimeout(fail, 2000);
    request.on('error', fail); request.on('aborted', fail);
    request.on('data', chunk => { size += chunk.length; if (size > limit) fail(); else chunks.push(chunk); });
    request.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail(); }
    });
  });
}

export async function listenLocal(server, port) {
  await new Promise((resolve, reject) => {
    const failed = (error) => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  return server.address().port;
}

export async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
}
