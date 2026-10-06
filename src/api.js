import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { inventory } from './config.js';

export const PLUGIN_VERSION = '0.1.0-dev.1';
export const CAPABILITIES = Object.freeze({ inventory: true, settingsWrite: false, motion: false, maintenance: false, keypad: false });
export function createManagementServer({ identity, configuration }) {
  const expectedAuthorization = Buffer.from(`Bearer ${identity.token}`);
  const envelope = { apiVersion: 1, instanceId: identity.instanceId };
  const controllers = inventory(configuration);
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    function send(status, value) {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    }
    try {
      const given = Buffer.from(request.headers.authorization ?? '');
      if (given.length !== expectedAuthorization.length || !timingSafeEqual(given, expectedAuthorization)) return send(401, { error: 'unauthorized' });
      if (request.headers.origin !== undefined) return send(403, { error: 'origin_not_allowed' });
      if (request.headers.host !== `127.0.0.1:${server.address().port}`) return send(403, { error: 'host_not_allowed' });
      if (request.method !== 'GET') return send(405, { error: 'read_only_milestone' });
      if (request.url === '/v1/identity') return send(200, { ...envelope, pluginVersion: PLUGIN_VERSION, mode: 'development', capabilities: CAPABILITIES });
      if (request.url === '/v1/controllers') return send(200, { ...envelope, controllers });
      const match = /^\/v1\/controllers\/([a-z][a-z0-9-]{0,47})$/.exec(request.url ?? '');
      const controller = match && controllers.find(item => item.id === match[1]);
      if (controller) return send(200, { ...envelope, controller });
      return send(404, { error: 'not_found' });
    } catch { return send(500, { error: 'internal_error' }); }
  });
  server.maxConnections = 32;
  return server;
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
