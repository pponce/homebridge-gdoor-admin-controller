// Only documented config.json fields. Never read another plugin's cache or
// pairing files, change Homebridge settings, or issue a device write.
import { createHash, randomUUID } from 'node:crypto';

const pinValid = value => typeof value === 'string' && /^\d{3}-\d{2}-\d{3}$/.test(value);
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0,64) : fallback;
const portValid = value => Number.isInteger(value) && value > 0 && value <= 65535;
function gatewayOrigin(host) {
  if (typeof host !== 'string' || !host.trim() || host.length > 256) return null;
  try {
    const url = new URL(host.includes('://') ? host : 'http://' + host);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
export function configuredConnections(config) {
  const rows = [], seen = new Set();
  const blocks = [...(Array.isArray(config.platforms) ? config.platforms : []), ...(Array.isArray(config.accessories) ? config.accessories : [])];
  const ownBridges = new Set(blocks.filter(p => p?.platform === 'GDoorAndBoltCoordinator').map(p => p._bridge?.username).filter(Boolean));
  function bridge(settings, name, identity, inheritedPin) {
    if (!settings || typeof settings !== 'object' || settings.hap === false || ownBridges.has(identity)) return;
    const token = 'homebridge:' + identity;
    if (seen.has(token)) return; seen.add(token);
    const baseUrl = portValid(settings.port) ? 'http://127.0.0.1:' + settings.port : '';
    // An explicitly invalid PIN must not silently fall back to another PIN.
    const pin = settings.pin === undefined ? inheritedPin : settings.pin;
    rows.push({ identity: token, type:'homebridge', name:label(settings.name,name), baseUrl,
      pin:pinValid(pin) ? pin : null,
      detail:!baseUrl ? 'No fixed accessory port is configured. Enter the address and key manually.' : !pinValid(pin) ? 'Address found. Enter or select the pairing PIN.' : 'Address and pairing PIN available. Access will be checked when added.' });
  }
  bridge(config.bridge,'Main Homebridge bridge','main',undefined);
  for (const block of blocks.slice(0,512)) {
    if (!block || typeof block !== 'object') continue;
    const alias = block.platform ?? block.accessory;
    if (alias !== 'GDoorAndBoltCoordinator' && typeof block._bridge?.username === 'string') {
      bridge(block._bridge,label(block.name,label(alias,'Child bridge')),block._bridge.username,config.bridge?.pin);
    }
    if (block.platform !== 'deCONZ') continue;
    // homebridge-deconz's published schema documents hosts, not its private key storage.
    for (const host of (Array.isArray(block.hosts) ? block.hosts : []).slice(0,64)) {
      const baseUrl = gatewayOrigin(host); if (!baseUrl || seen.has('deconz:' + baseUrl)) continue;
      seen.add('deconz:' + baseUrl);
      rows.push({identity:'deconz:' + baseUrl,type:'deconz',name:label(block.name,'deCONZ gateway'),baseUrl,pin:null,
        detail:'Address from homebridge-deconz. Select a saved deCONZ API key or enter one.'});
    }
  }
  return rows.slice(0,256);
}
export class LocalConnections {
  constructor({readConfig,readKeys,saveKey,inspect}) { Object.assign(this,{readConfig,readKeys,saveKey,inspect});this.candidates=new Map(); }
  async list() {
    const rows=configuredConnections(await this.readConfig()),keys=await this.readKeys(),candidates=new Map();
    const publicRows=rows.map(row=>{
      const id=randomUUID(),canImportPin=row.type==='homebridge' && !!row.baseUrl && !!row.pin;
      let credentialRef=null;
      if(canImportPin) {
        credentialRef=Object.keys(keys).sort().find(ref=>keys[ref]===row.pin) ?? 'local-homebridge-'+createHash('sha256').update(row.identity).digest('hex').slice(0,12);
        if(Object.hasOwn(keys,credentialRef) && keys[credentialRef]!==row.pin) credentialRef='local-homebridge-'+randomUUID().replaceAll('-','').slice(0,12);
      }
      candidates.set(id,{...row,credentialRef});
      return {id,type:row.type,name:row.name,baseUrl:row.baseUrl,detail:row.detail,canImportPin,credentialRef};
    });
    this.candidates=candidates;return {candidates:publicRows};
  }
  async importPin(id) {
    const selected=this.candidates.get(id);
    if(!selected?.credentialRef)throw Error('local_connection_unavailable');
    const current=configuredConnections(await this.readConfig()).find(row=>row.identity===selected.identity);
    if(!current || current.baseUrl!==selected.baseUrl || current.pin!==selected.pin)throw Error('local_connection_changed');
    // Reads /accessories through the existing adapter. Never enables insecure
    // mode, pairs, changes a bridge, or operates an accessory.
    await this.inspect(current.baseUrl,current.pin);
    const keys=await this.readKeys();
    if(Object.hasOwn(keys,selected.credentialRef)) {
      if(keys[selected.credentialRef]!==current.pin)throw Error('local_key_changed');
    } else {
      const saved=await this.saveKey({reference:selected.credentialRef,secret:current.pin,mode:'create'});
      if(!saved.saved)throw Error('local_key_changed');
    }
    return {saved:true,reference:selected.credentialRef};
  }
}
