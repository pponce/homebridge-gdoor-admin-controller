import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { inventory, routingInventory } from './config.js';

export const PLUGIN_VERSION = '0.3.0-dev.1';
export const CAPABILITIES = Object.freeze({ inventory: true, routingInventory: true, diagnostics: false, settingsWrite: false, motion: false, maintenance: false, keypad: false });
export function createManagementServer({ identity, configuration, diagnostics }) {
  const expectedAuthorization = Buffer.from(`Bearer ${identity.token}`);
  const envelope = { apiVersion: 1, instanceId: identity.instanceId };
  const controllers = inventory(configuration);
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
      const probe = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})\/probe$/.exec(request.url ?? '');
      if (request.method === 'POST' && probe && diagnostics) {
        if (request.headers['content-type'] !== 'application/json') return send(400, { error: 'invalid_request' });
        let body;
        try { body = await readBody(request); } catch { return send(400, { error: 'invalid_request' }); }
        if (!body || Object.keys(body).join() !== 'instanceId' || body.instanceId !== identity.instanceId) return send(409, { error: 'instance_mismatch' });
        if (!controllers.some(row => row.id === probe[1])) return send(404, { error: 'not_found' });
        try { return send(200, { ...envelope, probe: await diagnostics.probe(probe[1]) }); }
        catch (error) {
          if (error.message === 'probe_busy') return send(409, { error: 'probe_busy' });
          throw error;
        }
      }
      if (request.method !== 'GET') return send(405, { error: 'read_only_milestone' });
      if (request.url === '/v1/identity') return send(200, { ...envelope, pluginVersion: PLUGIN_VERSION,
        mode: diagnostics ? 'observation' : 'development', capabilities: { ...CAPABILITIES, diagnostics: Boolean(diagnostics) } });
      if (request.url === '/v1/controllers') return send(200, { ...envelope, controllers });
      const routing = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})\/routing$/.exec(request.url ?? '');
      const routed = routing && configuration.controllers.find(item => item.id === routing[1]);
      if (routed) return send(200, { ...envelope, routing: routingInventory(routed) });
      const match = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})$/.exec(request.url ?? '');
      const controller = match && controllers.find(item => item.id === match[1]);
      if (controller) return send(200, { ...envelope, controller });
      return send(404, { error: 'not_found' });
    } catch { return send(500, { error: 'internal_error' }); }
  });
  server.maxConnections = 32;
  return server;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = ''; let size = 0;
    const fail = () => { clearTimeout(timer); reject(new Error('invalid_request')); };
    const timer = setTimeout(fail, 2000);
    request.on('error', fail); request.on('aborted', fail);
    request.on('data', chunk => { size += chunk.length; if (size > 1024) fail(); else data += chunk.toString('utf8'); });
    request.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data)); } catch { fail(); }
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
