import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import path from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { loadIdentity } from '../src/storage.js';
import { readCredentials } from '../src/credentials.js';
import { PrivateStore } from '../src/private-store.js';
import { requestJson } from '../src/transport.js';
import { discoverHomebridge } from '../src/homebridge-devices.js';
import { validateConfiguration } from '../src/config.js';
import { withConnections } from './public/connections.js';
import { LocalConnections } from '../src/local-connections.js';
import { Diagnostics } from '../src/diagnostics.js';

export class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const route = (name, fn) => this.onRequest(name, async body => { try { return await fn(body ?? {}); } catch { throw new RequestError('The request could not be completed. Check the connection and saved settings.'); } });
    route('/load', () => this.load());
    route('/validate', body => validateConfiguration(body.configuration, { allowEmpty: true }));
    route('/review', body => this.api('/v1/settings/review', body));
    route('/cancel', body => this.api('/v1/settings/cancel', body));
    route('/homebridge', async ({ baseUrl, credentialRef }) => { this.id(credentialRef); const keys = await readCredentials(this.homebridgeStoragePath);
      const data = await discoverHomebridge(baseUrl, keys[credentialRef]); return { bridgeId: data.bridgeId, services: data.services.map(({service,aid,...row}) => row) }; });
    route('/apply', body => this.api('/v1/settings/apply', body));
    route('/commission', ({ controller, ...body }) => { this.id(controller); return this.api('/v1/controllers/' + controller + '/commission', body); });
    route('/disable', ({ controller, ...body }) => { this.id(controller); return this.api('/v1/controllers/' + controller + '/disable', body); });
    route('/probe', async ({ controller }) => {
      this.id(controller);
      const [value, settings] = await Promise.all([
        this.api('/v1/controllers/' + controller + '/probe', {}), this.api('/v1/settings'),
      ]);
      const diagnostics = new Diagnostics(settings.settings.configuration, () => readCredentials(this.homebridgeStoragePath));
      const controls = await diagnostics.probeControls(controller);
      return { ...value, probe: { ...value.probe, controls,
        compatible: value.probe.compatible && controls.every(row => row.error === null) } };
    });
    this.credentialWork=Promise.resolve();
    const credentialTask=fn=>{const next=this.credentialWork.then(fn);this.credentialWork=next.catch(()=>{});return next;};
    this.localConnections=new LocalConnections({
      readConfig:async()=>JSON.parse(await readFile(this.homebridgeConfigPath,'utf8')),
      readKeys:async()=>{
        try{await lstat(path.join(this.homebridgeStoragePath,'gdoorandbolt-coordinator','credentials.json'));}
        catch(error){if(error.code==='ENOENT')return {};throw error;}
        return readCredentials(this.homebridgeStoragePath);
      },
      saveKey:body=>this.saveCredential(body),inspect:discoverHomebridge
    });
    route('/local-connections',()=>this.localConnections.list());
    route('/local-connections/import',body=>credentialTask(()=>this.localConnections.importPin(body.id)));
    route('/credentials', body => credentialTask(()=>this.saveCredential(body)));
    route('/credentials/delete', body => credentialTask(()=>this.deleteCredential(body)));
    route('/deconz', body => this.deconzDevices(body));
    this.ready();
  }
  id(v) { if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(v)) throw Error('invalid_id'); }
  async bootstrap() {
    const config = JSON.parse(await readFile(this.homebridgeConfigPath, 'utf8'));
    const blocks = (config.platforms ?? []).filter(p => p.platform === 'GDoorAndBoltCoordinator');
    if (blocks.length > 1) throw Error('multiple_platforms');
    const block = blocks[0] ?? { platform: 'GDoorAndBoltCoordinator', managementPort: 27773 };
    const port = block.managementPort ?? 27773;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('invalid_port');
    return { block, port };
  }
  async api(endpoint, body) {
    const { port } = await this.bootstrap(); const identity = await loadIdentity(this.homebridgeStoragePath);
    return requestJson({ url: 'http://127.0.0.1:' + port + endpoint, method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + identity.token }, ...(body === undefined ? {} : { body: { ...body, instanceId: identity.instanceId } }),
      timeoutMs: 30000, maxRequestBytes: 262144, maxResponseBytes: 524288 });
  }
  async load() {
    let credentials = []; try { credentials = Object.keys(await readCredentials(this.homebridgeStoragePath)); } catch { /* Not yet configured. */ }
    try {
      const [identity, settings, controllers, routing] = await Promise.all([this.api('/v1/identity'), this.api('/v1/settings'), this.api('/v1/controllers'), this.api('/v1/maintenance')]);
      return { connected: true, adminConnection: { baseUrl: 'http://127.0.0.1:' + (await this.bootstrap()).port, identityFile: path.join(this.homebridgeStoragePath, 'gdoorandbolt-coordinator', 'identity.json') }, settings: settings.settings, controllers: controllers.controllers, maintenance: routing.maintenance, credentials, pluginVersion: identity.pluginVersion };
    } catch {
      const { block } = await this.bootstrap();
      return { connected: false, settings: { revision: null, configuration: withConnections({ managementPort: block.managementPort ?? 27773, controllers: block.controllers ?? [], connections: block.connections??[] }) }, controllers: [], credentials };
    }
  }
  async saveCredential({ reference, secret, mode }) {
    if(mode!==undefined&&!['create','replace'].includes(mode))throw Error('credential_mode_invalid');
    this.id(reference); if (typeof secret !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(secret)) throw Error('credential_invalid');
    await loadIdentity(this.homebridgeStoragePath);
    let existing = {}; try { existing = await readCredentials(this.homebridgeStoragePath); } catch {
      // Missing is allowed; corrupt/insecure credential files are rejected by the
      // atomic writer rather than silently replaced.
    }
    const store = new PrivateStore(this.homebridgeStoragePath, 'credentials.json', value => value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length <= 64 && Object.entries(value).every(([k,v]) => /^[a-z][a-z0-9-]{0,47}$/.test(k) && typeof v === 'string' && /^[\x21-\x7e]{1,256}$/.test(v)));
    const fromDisk = await store.read(); if (fromDisk) existing = fromDisk;
    if(mode==='create'&&Object.hasOwn(existing,reference))return {saved:false,reason:'exists'};
    if(mode==='replace'&&!Object.hasOwn(existing,reference))throw Error('credential_missing');
    const stateStore = new PrivateStore(this.homebridgeStoragePath, 'profiles.json', s => s?.schema === 1 && s.commissioned && typeof s.commissioned === 'object');
    const state = await stateStore.read();
    if (Object.hasOwn(existing,reference) && state && Object.keys(state.commissioned).length) await this.api('/v1/commissioning/reset', {});
    await store.write({ ...existing, [reference]: secret }); return { saved: true, reference };
  }
  async deleteCredential({reference}) {
    this.id(reference);await loadIdentity(this.homebridgeStoragePath);
    const existing=await readCredentials(this.homebridgeStoragePath);
    const {block}=await this.bootstrap();
    const state=await new PrivateStore(this.homebridgeStoragePath,'profiles.json',s=>s?.schema===1&&s.configuration&&Array.isArray(s.configuration.controllers)).read();
    const usesKey=value=>!!value&&typeof value==='object'&&(value.credentialRef===reference||Object.values(value).some(usesKey));
    // Check both durable sources, including disabled garages and optional inputs.
    // A key cannot disappear while either saved configuration still needs it.
    if(usesKey(state?.configuration)||usesKey(block))return {deleted:false,reason:'in-use'};
    delete existing[reference];
    const store=new PrivateStore(this.homebridgeStoragePath,'credentials.json',value=>value&&typeof value==='object'&&!Array.isArray(value)&&
      Object.keys(value).length<=64&&Object.entries(value).every(([k,v])=>/^[a-z][a-z0-9-]{0,47}$/.test(k)&&typeof v==='string'&&/^[\x21-\x7e]{1,256}$/.test(v)));
    await store.write(existing);return {deleted:true,reference};
  }
  async deconzDevices({ baseUrl, credentialRef }) {
    this.id(credentialRef); const endpoint = new URL(baseUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw Error('url_invalid');
    const keys = await readCredentials(this.homebridgeStoragePath); const key = keys[credentialRef];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw Error('credential_invalid');
    const get = name => requestJson({ url: endpoint.origin + '/api/' + key + '/' + name, maxResponseBytes: 524288 });
    const [config, lights, sensors, alarms] = await Promise.all(['config','lights','sensors','alarmsystems'].map(get));
    if (typeof config.bridgeid !== 'string' || !/^[0-9a-fA-F:]{16,23}$/.test(config.bridgeid)) throw Error('gateway_invalid');
    const rows = value => Object.entries(value).filter(([id,row]) => /^[1-9][0-9]{0,5}$/.test(id) && row && typeof row === 'object').slice(0,512).map(([id,row]) => ({
      resourceId: id, name: String(row.name ?? id).slice(0,64), uniqueId: row.uniqueid, resourceType: row.type, modelId: row.modelid, manufacturer: row.manufacturername }));
    return { gatewayId: config.bridgeid, lights: rows(lights).filter(x => ['On/Off light','On/Off output','On/Off switch'].includes(x.resourceType)),
      sensors: rows(sensors).filter(x => ['ZHASwitch','ZHAAncillaryControl'].includes(x.resourceType)),
      alarms: Object.entries(alarms).filter(([id]) => /^[1-9][0-9]{0,2}$/.test(id)).map(([id,v]) => ({ id: Number(id), name: String(v.name ?? id).slice(0,64) })) };
  }
}
new UiServer();
