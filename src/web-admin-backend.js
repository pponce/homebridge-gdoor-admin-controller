// Non-controller administration dispatch. Explicit ports are required for
// durable setup/history/transactions; absent operations never report success.
import { WebAdminError } from './web-admin-auth.js';
import { WebAdminGateway, validateWebGateways } from './web-admin-gateway.js';
import { WebAdminView } from './web-admin-view.js';
import { requireWeb, object, exact, integer } from './web-admin-common.js';

const regularReads = new Set(['inventory', 'administration', 'lockout', 'transaction_status']);
const readonly = new Set(['inventory', 'discover', 'overview', 'alarm', 'lockout', 'administration', 'editor']);
const privateAttention = /homebridge|extension|maintenance|recovery|participant|host_helper/;
function limitedTransaction(value) {
  const pending = !['none', 'complete'].includes(value.stage);
  return { stage: pending ? 'held' : 'none', pending, administrator_required: pending };
}

export class WebAdminBackend {
  constructor({ registrations = [], accessMode = 'observe', setup, transactions, history, hiddenUsers = async () => [], gatewayFactory = row => new WebAdminGateway(row) }) {
    this.registrations = new Map(validateWebGateways(registrations).map(row => [row.id, row]));
    requireWeb(['observe', 'manage'].includes(accessMode), 'candidate_read_only_required');
    Object.assign(this, { accessMode, setup, transactions, history, hiddenUsers, gatewayFactory });
    this.connected = new Map(); this.catalog = new Map(); this.pending = Promise.resolve();
  }
  dispatch(session, operation, body) {
    const result = this.pending.then(() => this.execute(session, operation, body));
    this.pending = result.catch(() => {}); return result;
  }
  unavailable() { throw new WebAdminError('operation_not_implemented'); }
  async execute(session, operation, body) {
    requireWeb(session && ['admin', 'regular'].includes(session.role), 'forbidden');
    requireWeb(typeof operation === 'string' && object(body), 'invalid_request');
    const regular = session.role === 'regular';
    if (operation === 'gateways') {
      requireWeb(exact(body, []), 'invalid_request');
      return { gateways: [...this.registrations].map(([id, row]) => ({ id, name: row.name, connected: this.connected.get(id) === true })) };
    }
    if (operation === 'setup') {
      requireWeb(exact(body, []), 'invalid_request');
      if (regular) return { access_mode: this.accessMode, extensions: [], onboarding_required: false };
      if (!this.setup?.public) return this.unavailable();
      return { ...await this.setup.public(), access_mode: this.accessMode, extensions: [], gateway_count: this.registrations.size };
    }
    if (operation === 'installation_settings') {
      requireWeb(!regular, 'forbidden'); requireWeb(exact(body, []), 'invalid_request');
      const result = await this.execute(session, 'setup', {});
      return { ...result, homebridge_details: null };
    }
    if (operation !== 'gateway_request') { requireWeb(!regular, 'forbidden'); return this.unavailable(); }
    requireWeb(exact(body, ['gateway', 'alarm', 'operation', 'body']) && object(body.body), 'invalid_request');
    const { gateway, alarm, operation: action, body: payload } = body;
    requireWeb(typeof gateway === 'string' && this.registrations.has(gateway), 'gateway_not_registered');
    requireWeb(alarm === null || integer(alarm, 1, 255), 'invalid_alarm');
    requireWeb(typeof action === 'string' && (!regular || regularReads.has(action)), 'forbidden');
    try {
      if (action === 'transaction_status' || action === 'history') {
        requireWeb(integer(alarm, 1, 255), 'explicit_alarm_required'); requireWeb(exact(payload, []), 'invalid_request');
        if (action === 'transaction_status') {
          if (!this.transactions?.status) return this.unavailable();
          const value = await this.transactions.status(gateway);
          return regular ? limitedTransaction(value) : value;
        }
        if (!this.history?.rows) return this.unavailable();
        return { rows: await this.history.rows(gateway, alarm, 200), connected: this.connected.get(gateway) === true };
      }
      if (!readonly.has(action)) return this.unavailable();
      requireWeb(exact(payload, []), 'invalid_request');
      if (!['inventory', 'discover'].includes(action)) requireWeb(integer(alarm, 1, 255), 'explicit_alarm_required');
      const registration = this.registrations.get(gateway), client = this.gatewayFactory(registration);
      try { await client.verify(alarm); this.connected.set(gateway, true); }
      catch (error) { this.connected.set(gateway, false); throw error; }
      const view = new WebAdminView({ gatewayId: gateway, name: registration.name, alarm, client,
        onInventory: result => { this.catalog.set(gateway, result); },
        transactionStatus: this.transactions?.status ? id => this.transactions.status(id) : undefined });
      if (action === 'inventory' || action === 'discover') return view.inventory();
      if (action === 'editor') return view.snapshot();
      if (action === 'overview') return { alarm: await view.alarm(), users: await view.users(), capabilities: { managed: (await client.verify(alarm)).managed === true } };
      const value = await view[action]();
      if (regular && action === 'administration') {
        const hidden = new Set(await this.hiddenUsers(gateway));
        const protectedIds = new Set(value.alarms.flatMap(alarm => alarm.users.filter(row => row.owner).map(row => row.id)));
        const users = rows => rows.filter(row => !hidden.has(row.id)).map(row => ({ ...row, read_only: protectedIds.has(row.id) }));
        return { identities: users(value.identities), users: users(value.users), keypads: value.keypads,
          alarms: value.alarms.map(alarm => ({ ...alarm, users: users(alarm.users) })), managed: value.managed,
          schedules: value.schedules, transaction: limitedTransaction(value.transaction), pin_rotation_available: false };
      }
      return value;
    } catch (error) {
      if (regular && error instanceof WebAdminError && privateAttention.test(error.message)) throw new WebAdminError('administrator_attention_required');
      throw error;
    }
  }
}
