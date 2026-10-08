import { requestJson } from './transport.js';
import { Fault, requireValue } from './fault.js';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const flag = v => typeof v === 'boolean' || v === 0 || v === 1;
const gatewayId = v => typeof v === 'string' ? v.replaceAll(':', '').toUpperCase() : '';

export class TailwindDoor {
  constructor(configuration, token, { request = requestJson, readOnly = true } = {}) {
    requireValue(typeof token === 'string' && /^[0-9]{6}$/.test(token), 'tailwind_credential_invalid');
    this.config = structuredClone(configuration); this.token = token;
    this.request = request; this.readOnly = readOnly;
    this.capabilities = Object.freeze({ directional: true });
  }

  async call(data, write = false) {
    let result;
    try {
      result = await this.request({ url: this.config.baseUrl + '/json', method: 'POST',
        headers: { TOKEN: this.token }, timeoutMs: 8000,
        body: { version: '0.1', ...(write ? { product: 'iQ3' } : {}), data } });
    } catch { throw new Fault(write ? 'door_write_ambiguous' : 'door_read_failed'); }
    requireValue(object(result) && result.result === 'OK', write ? 'door_write_unconfirmed' : 'door_response_invalid');
    return result;
  }

  async read() {
    const result = await this.call({ type: 'get', name: 'dev_st' });
    const row = result.data?.['door' + (this.config.doorIndex + 1)];
    requireValue(object(row) && row.index === this.config.doorIndex &&
      ['open', 'close'].includes(row.status) && flag(row.lockup) && flag(row.disabled), 'door_response_invalid');
    // Tailwind's "open" means the closed sensor has departed; it is not fully open.
    return { door: row.status === 'close' ? 'closed' : 'not-closed',
      blocked: Boolean(row.lockup || row.disabled), obstruction: false, evidence: 'closed-sensor' };
  }

  async write(command, { beforeWrite } = {}) {
    requireValue(!this.readOnly, 'actuation_disabled');
    requireValue(['open', 'close'].includes(command), 'door_command_invalid');
    const fresh = await this.read();
    requireValue(!fresh.blocked, 'door_blocked');
    await beforeWrite?.();
    await this.call({ type: 'set', name: 'door_op', value: { door_idx: this.config.doorIndex, cmd: command } }, true);
  }
}

export class DeconzBolt {
  constructor(configuration, key, { request = requestJson, readOnly = true } = {}) {
    requireValue(typeof key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(key), 'bolt_credential_invalid');
    requireValue(/^[0-9A-F]{16}$/.test(gatewayId(configuration.gatewayId)) &&
      ['On/Off light', 'On/Off output', 'On/Off switch'].includes(configuration.resourceType) &&
      typeof configuration.modelId === 'string' && configuration.modelId.length > 0 &&
      typeof configuration.manufacturer === 'string' && configuration.manufacturer.length > 0,
    'bolt_identity_configuration_required');
    this.config = structuredClone(configuration); this.key = key;
    this.request = request; this.readOnly = readOnly;
  }

  async call(path, method = 'GET', body) {
    try { return await this.request({ url: this.config.baseUrl + '/api/' + this.key + path, method, body }); }
    catch { throw new Fault(method === 'GET' ? 'bolt_read_failed' : 'bolt_write_ambiguous'); }
  }

  async read() {
    const gateway = await this.call('/config');
    requireValue(object(gateway) && gatewayId(gateway.bridgeid) === gatewayId(this.config.gatewayId), 'bolt_gateway_identity_mismatch');
    const row = await this.call('/lights/' + this.config.resourceId);
    requireValue(object(row) && row.uniqueid === this.config.uniqueId && row.type === this.config.resourceType &&
      row.modelid === this.config.modelId && row.manufacturername === this.config.manufacturer, 'bolt_resource_identity_mismatch');
    requireValue(object(row.state) && row.state.reachable === true, 'bolt_unreachable');
    requireValue(typeof row.state.on === 'boolean', 'bolt_response_invalid');
    return { locked: row.state.on === this.config.lockedValue, evidence: 'relay' };
  }

  async write(locked, { beforeWrite } = {}) {
    requireValue(!this.readOnly, 'actuation_disabled');
    requireValue(typeof locked === 'boolean', 'bolt_command_invalid');
    await this.read(); // Re-verify gateway, endpoint identity and reachability before PUT.
    const value = locked ? this.config.lockedValue : !this.config.lockedValue;
    const path = '/lights/' + this.config.resourceId + '/state';
    await beforeWrite?.();
    const result = await this.call(path, 'PUT', { on: value });
    requireValue(Array.isArray(result) && result.length === 1 && object(result[0]) &&
      Object.keys(result[0]).join() === 'success' && object(result[0].success) &&
      Object.keys(result[0].success).join() === path + '/on' && result[0].success[path + '/on'] === value,
    'bolt_write_unconfirmed');
  }
}
