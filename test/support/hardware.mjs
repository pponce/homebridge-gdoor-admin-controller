import http from 'node:http';
import { listenLocal, closeServer } from '../../src/api.js';

// Closed-loop emulator. Requests to any unrecognised path fail; no LAN access.
export async function hardwareFixture(configuration) {
  const config = structuredClone(configuration);
  const state = { closed: true, locked: true, reachable: true, blocked: false, requests: [], writes: [],
    gatewayId: config.bolt.gatewayId, uniqueId: config.bolt.uniqueId, modelId: config.bolt.modelId,
    manufacturer: config.bolt.manufacturer, resourceType: config.bolt.resourceType,
    ambiguousDoorWrite: false, badBoltAcknowledgement: false };
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    state.requests.push({ method: request.method, path: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    const send = value => response.end(JSON.stringify(value));
    if (request.url === '/json' && request.method === 'POST' && request.headers.token === '123456') {
      if (body?.data?.type === 'get' && body.data.name === 'dev_st') return send({ result: 'OK', data: {
        ['door' + (config.door.doorIndex + 1)]: { index: config.door.doorIndex, status: state.closed ? 'close' : 'open',
          lockup: state.blocked, disabled: false } } });
      if (body?.data?.type === 'set' && body.data.name === 'door_op' && body.product === 'iQ3') {
        state.writes.push(['door', body.data.value.cmd]);
        state.closed = body.data.value.cmd === 'close';
        if (state.ambiguousDoorWrite) return request.socket.destroy();
        return send({ result: 'OK' });
      }
    }
    if (request.url === '/api/synthetic-deconz-key/config' && request.method === 'GET') return send({ bridgeid: state.gatewayId });
    const resource = '/lights/' + config.bolt.resourceId;
    if (request.url === '/api/synthetic-deconz-key' + resource && request.method === 'GET') return send({
      uniqueid: state.uniqueId, type: state.resourceType, modelid: state.modelId, manufacturername: state.manufacturer,
      state: { reachable: state.reachable, on: state.locked ? config.bolt.lockedValue : !config.bolt.lockedValue } });
    if (request.url === '/api/synthetic-deconz-key' + resource + '/state' && request.method === 'PUT') {
      state.writes.push(['bolt', body.on]); state.locked = body.on === config.bolt.lockedValue;
      return send(state.badBoltAcknowledgement ? [{ success: {} }] : [{ success: { [resource + '/state/on']: body.on } }]);
    }
    response.writeHead(404); send({ error: 'fixture_request_rejected' });
  });
  const port = await listenLocal(server, 0);
  config.door.baseUrl = config.bolt.baseUrl = 'http://127.0.0.1:' + port;
  const credentials = { [config.door.credentialRef]: '123456', [config.bolt.credentialRef]: 'synthetic-deconz-key' };
  return { config, state, credentials, server, close: () => closeServer(server) };
}
