import http from 'node:http';
import { createHash } from 'node:crypto';
import { listenLocal, closeServer } from '../../src/api.js';

// Closed-loop emulator. Requests to any unrecognised path fail; no LAN access.
export async function hardwareFixture(configuration) {
  const config = structuredClone(configuration);
  const state = { closed: true, locked: true, reachable: true, blocked: false, requests: [], writes: [],
    gatewayId: config.bolt.gatewayId, uniqueId: config.bolt.uniqueId, modelId: config.bolt.modelId,
    manufacturer: config.bolt.manufacturer, resourceType: config.bolt.resourceType,
    ambiguousDoorWrite: false, badBoltAcknowledgement: false, alarmConfigured: true, alarmMembership: true };
  const sockets = new Set();
  const sensors = new Map((config.inputs??[]).filter(i=>i.source.type==='deconz').map(i=>[i.source.resourceId,{...i.source,value:i.source.kind==='keypad'?'disarmed':i.trigger,stamp:new Date(Date.now()-10000).toISOString()}]));
  const motors = new Map((config.motorPaths??[]).filter(m=>m.connection.type==='deconz' && m.connection.resourceId!==config.bolt.resourceId).map(m=>[m.connection.resourceId,{...m.connection,active:false}]));
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    state.requests.push({ method: request.method, path: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    const send = value => response.end(JSON.stringify(value));
    if (request.url === '/json' && request.method === 'POST' && request.headers.token === '123456') {
      if (body?.data?.type === 'get' && body.data.name === 'dev_st') { await state.beforeDoorRead?.(); return send({ result: 'OK', data: {
        ['door' + (config.door.doorIndex + 1)]: { index: config.door.doorIndex, status: state.closed ? 'close' : 'open',
          lockup: state.blocked, disabled: false } } }); }
      if (body?.data?.type === 'set' && body.data.name === 'door_op' && body.product === 'iQ3') {
        state.writes.push(['door', body.data.value.cmd]);
        if (body.data.value.cmd === 'close' && state.closeDelayMs > 0) {
          setTimeout(() => { state.closed = true; }, state.closeDelayMs).unref();
        } else state.closed = body.data.value.cmd === 'close';
        if (state.ambiguousDoorWrite) return request.socket.destroy();
        return send({ result: 'OK' });
      }
    }
    if (request.url === '/api/synthetic-deconz-key/config' && request.method === 'GET') return send({ bridgeid: state.gatewayId, websocketport: server.address().port });
    if (request.url === '/api/synthetic-deconz-key/lights' && request.method === 'GET') return send({
      [config.bolt.resourceId]: { name: 'Synthetic bolt', uniqueid: state.uniqueId, type: state.resourceType,
        modelid: state.modelId, manufacturername: state.manufacturer },
      ...Object.fromEntries([...motors].map(([id, row]) => [id, { name: 'Synthetic opener relay', uniqueid: row.uniqueId,
        type: row.resourceType, modelid: row.modelId, manufacturername: row.manufacturer }])),
      '99': { name: 'Unsupported dimmer', type: 'Dimmable light' },
    });
    if (request.url === '/api/synthetic-deconz-key/sensors' && request.method === 'GET') return send(Object.fromEntries(
      [...sensors].map(([id, row]) => [id, { name: 'Synthetic ' + row.kind, uniqueid: row.uniqueId, type: row.resourceType,
        modelid: row.modelId, manufacturername: row.manufacturer }])));
    if (request.url === '/api/synthetic-deconz-key/alarmsystems' && request.method === 'GET') return send({ '1': { name: 'Synthetic alarm' } });
    const sensor = /^\/api\/synthetic-deconz-key\/sensors\/([0-9]+)$/.exec(request.url);
    if (sensor && request.method === 'GET' && sensors.has(sensor[1])) {
      const row=sensors.get(sensor[1]);return send({uniqueid:row.uniqueId,type:row.resourceType,modelid:row.modelId,manufacturername:row.manufacturer,
        config:{reachable:true,on:true},state:{lastupdated:row.stamp,...(row.kind==='keypad'?{action:row.value}:{buttonevent:row.value})}});
    }
    if (/^\/api\/synthetic-deconz-key\/alarmsystems\/[0-9]+$/.test(request.url) && request.method==='GET') return send({config:{configured:state.alarmConfigured},state:{armstate:'disarmed'},devices:state.alarmMembership?Object.fromEntries([...sensors.values()].filter(s=>s.kind==='keypad').map(s=>[s.uniqueId,{}])):{}});
    const motor=/^\/api\/synthetic-deconz-key\/lights\/([0-9]+)(\/state)?$/.exec(request.url);
    if(motor && motors.has(motor[1])){const row=motors.get(motor[1]);
      if(request.method==='GET')return send({uniqueid:row.uniqueId,type:row.resourceType,modelid:row.modelId,manufacturername:row.manufacturer,state:{reachable:true,on:row.active?row.activeValue:!row.activeValue}});
      if(request.method==='PUT'&&motor[2]){row.active=body.on===row.activeValue;state.writes.push(['motor',row.active]);if(row.active)state.closed=!state.closed;return send([{success:{['/lights/'+motor[1]+'/state/on']:body.on}}]);}
    }
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
  server.on('upgrade',(request,socket)=>{
    const accept=createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    sockets.add(socket);socket.on('data',chunk=>{if((chunk[0]&15)===8)socket.end(Buffer.from([0x88,0]));});socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
  });
  const port = await listenLocal(server, 0);
  config.door.baseUrl = config.bolt.baseUrl = 'http://127.0.0.1:' + port;
  for(const row of [...(config.inputs??[]).map(i=>i.source),...(config.motorPaths??[]).map(m=>m.connection)])if(row.type==='deconz')row.baseUrl=config.bolt.baseUrl;
  const credentials = { [config.door.credentialRef]: '123456', [config.bolt.credentialRef]: 'synthetic-deconz-key' };
  return { config, state, credentials, server, motors, emit(id,value){const sensor=sensors.get(id);sensor.value=value;sensor.stamp=new Date().toISOString();
    const event={t:'event',e:'changed',r:'sensors',id,uniqueid:sensor.uniqueId,state:{lastupdated:sensor.stamp,...(sensor.kind==='keypad'?{action:value}:{buttonevent:value})}};
    const data=Buffer.from(JSON.stringify(event));const header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(data.length,2);for(const socket of sockets)socket.write(Buffer.concat([header,data]));
  }, close: async () => {for(const s of sockets)s.destroy();await closeServer(server);} };
}
