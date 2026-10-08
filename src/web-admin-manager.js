// Optional server lifecycle. Disabled setup has no listener, gateway activity,
// certificate generation or SQLite work. Errors cannot stop the coordinator.
import { WebAdminSettings, validateWebSettings } from './web-admin-settings.js';
import { WebAdminAccountStore } from './web-admin-store.js';
import { WebAdminTls } from './web-admin-tls.js';
import { WebAdminError } from './web-admin-auth.js';
import { webGatewayExchange, validateWebGateways } from './web-admin-gateway.js';
import { readCredentials } from './credentials.js';
import { webDigest } from './web-admin-files.js';
import { requireWeb, exact, integer, object } from './web-admin-common.js';

const nodeSupported = () => { const [major, minor] = process.versions.node.split('.').map(Number); return major === 22 && minor >= 13 || major === 24; };
const safeErrors = new Set(['web_account_setup_required', 'web_connection_unavailable', 'web_connections_changed', 'web_gateway_unavailable',
  'web_gateway_identity_changed', 'web_gateway_duplicate', 'web_admin_node_update_required', 'web_port_in_use', 'web_listener_failed',
  'web_certificate_generation_failed', 'web_private_storage_invalid', 'web_private_storage_write_failed']);
export class WebAdminManager {
  constructor({ storagePath, runtime, settings = new WebAdminSettings(storagePath), accounts = new WebAdminAccountStore(storagePath),
    tls = new WebAdminTls(storagePath), credentials = () => readCredentials(storagePath), exchange = webGatewayExchange,
    build = async options => (await import('./web-admin-service.js')).createWebAdminService(options) }) {
    Object.assign(this, { storagePath, runtime, settings, accounts, tls, credentials, exchange, build });
    this.pending = Promise.resolve(); this.active = null; this.error = null; this.stopped = false;
  }
  serial(action) { const next = this.pending.then(action); this.pending = next.catch(() => {}); return next; }
  connections() { return (this.runtime.configuration.connections ?? []).filter(row => row.type === 'deconz'); }
  async selected(settings) {
    const keys = await this.credentials(), connections = this.connections();
    return settings.connectionIds.map(id => {
      const row = connections.find(value => value.id === id);
      requireWeb(row && typeof keys[row.credentialRef] === 'string', 'web_connection_unavailable');
      return { id: row.id, name: row.name, endpoint: row.baseUrl, key: keys[row.credentialRef] };
    });
  }
  async resolve(row) {
    const selected = await this.selected(row.settings), identities = { ...row.identities };
    const results = await Promise.allSettled(selected.map(async connection => {
      const { id, name, endpoint, key } = connection;
      // Validate the endpoint/key before issuing even a read-only discovery.
      validateWebGateways([{ id: 'discovery', name, endpoint, key, identity: '0000000000000000' }]);
      let response; try { response = await this.exchange({ url: endpoint.replace(/\/$/, '') + '/api/' + key + '/config', method: 'GET' }); }
      catch { throw new WebAdminError('web_gateway_unavailable'); }
      const identity = typeof response[1]?.bridgeid === 'string' ? response[1].bridgeid.replaceAll(':', '').toUpperCase() : '';
      requireWeb(response[0] === 200 && /^[0-9A-F]{16}$/.test(identity), 'web_gateway_unavailable');
      requireWeb(!identities[id] || identities[id] === identity, 'web_gateway_identity_changed'); identities[id] = identity;
      return { id: 'gateway-' + identity.toLowerCase(), name, endpoint, key, identity };
    }));
    const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    const registrations = results.map(result => result.value);
    requireWeb(new Set(registrations.map(value => value.identity)).size === registrations.length, 'web_gateway_duplicate');
    validateWebGateways(registrations);
    const fingerprint = webDigest(selected);
    return { registrations, identities, assertCurrent: async () => requireWeb(webDigest(await this.selected(row.settings)) === fingerprint, 'web_connections_changed') };
  }
  async status() {
    const row = await this.settings.read();
    let current = true; if (this.active) { try { await this.active.assertCurrent(); } catch { current = false; } }
    return { revision: row.revision, settings: row.settings, running: !!this.active, error: current ? this.error : 'web_connections_changed',
      accountConfigured: await this.accounts.configured(), nodeSupported: nodeSupported(),
      connections: this.connections().map(({ id, name }) => ({ id, name })) };
  }
  async deactivate() { const active = this.active; this.active = null; if (active) await active.service.close(); }
  async activate(row, prepared) {
    if (!row.settings.enabled) return;
    requireWeb(nodeSupported(), 'web_admin_node_update_required');
    requireWeb(await this.accounts.configured(), 'web_account_setup_required');
    const resolved = prepared ?? await this.resolve(row); await resolved.assertCurrent();
    const tls = await this.tls.load(row.settings);
    const service = await this.build({ storagePath: this.storagePath, runtime: this.runtime, row, accounts: this.accounts, tls, ...resolved });
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { service.server.removeListener('listening', ready); reject(new WebAdminError(error.code === 'EADDRINUSE' ? 'web_port_in_use' : 'web_listener_failed')); };
        const ready = () => { service.server.removeListener('error', failed); resolve(); };
        service.server.once('error', failed); service.server.once('listening', ready); service.server.listen(row.settings.port, row.settings.bind);
      });
      service.server.on('error', () => { this.error = 'web_listener_failed'; });
      await resolved.assertCurrent(); service.start(); this.active = { service, assertCurrent: resolved.assertCurrent };
    } catch (error) { await service.close(); throw error; }
  }
  start() { return this.serial(async () => {
    if (this.stopped || this.active) return;
    try { await this.activate(await this.settings.read()); this.error = null; }
    catch (error) { this.error = safeErrors.has(error.message) ? error.message : 'web_start_failed'; }
  }); }
  configure(body) {
    const copy = structuredClone(body);
    return this.serial(async () => {
      requireWeb(!this.stopped, 'web_admin_stopping');
      requireWeb(exact(copy, ['expectedRevision', 'settings', 'admin']) && integer(copy.expectedRevision, 0, Number.MAX_SAFE_INTEGER), 'web_settings_invalid');
      validateWebSettings(copy.settings);
      requireWeb(copy.settings.port !== (this.runtime.configuration.managementPort ?? 27773), 'web_management_port_conflict');
      const current = await this.settings.read(); requireWeb(current.revision === copy.expectedRevision, 'web_settings_changed');
      const configured = await this.accounts.configured();
      requireWeb(copy.admin === null || !configured && exact(copy.admin, ['username', 'password']), 'web_account_already_configured');
      let prepared;
      if (copy.settings.enabled) {
        requireWeb(nodeSupported(), 'web_admin_node_update_required'); requireWeb(configured || object(copy.admin), 'web_account_setup_required');
        prepared = await this.resolve({ ...current, settings: copy.settings });
      }
      // A disabled server does not need gateway access and keeps its accounts,
      // history and identity bindings for a later explicit re-enable.
      await this.deactivate();
      if (copy.admin !== null) await this.accounts.initialize(copy.admin.username, copy.admin.password);
      const row = await this.settings.save(copy.expectedRevision, copy.settings, prepared?.identities ?? current.identities);
      this.error = null;
      try { await this.activate(row, prepared); }
      catch (error) { this.error = safeErrors.has(error.message) ? error.message : 'web_start_failed'; }
      return this.status();
    });
  }
  close() { this.stopped = true; return this.serial(() => this.deactivate()); }
}
