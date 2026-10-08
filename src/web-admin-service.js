// Loaded only when the owner enables the optional server. Uses the existing
// coordinator's maintenance/keypad ports and does not start another controller.
import { WebAdminAuth } from './web-admin-auth.js';
import { WebAdminBackend } from './web-admin-backend.js';
import { WebAdminApplication } from './web-admin-application.js';
import { WebAdminTransactions, WebAdminTransactionStore } from './web-admin-transactions.js';
import { WebAdminHistory } from './web-admin-history.js';
import { WebAdminPolicyBackup } from './web-admin-backup.js';
import { WebAdminCollector } from './web-admin-collector.js';
import { webCoordinatorParticipant, webCoordinatorKeypad } from './web-admin-coordinator.js';
import { createWebAdminServer } from './web-admin-server.js';
import { loadWebAdminAssets } from './web-admin-assets.js';
import { WebHomebridgeMaintenance, WebHomebridgeMaintenanceStore } from './web-admin-homebridge-maintenance.js';
import { WebHomebridgeHost } from './web-admin-homebridge-host.js';

export async function createWebAdminService({ storagePath, configPath, coordinatorBridge, runtime, row, registrations, accounts, tls, assertCurrent, homebridgeHost }) {
  const application = new WebAdminApplication(storagePath); await application.load();
  const auth = new WebAdminAuth({ store: accounts }); await auth.refresh();
  const history = new WebAdminHistory(storagePath, new Map(registrations.map(value => [value.id, value])));
  const backup = new WebAdminPolicyBackup(storagePath);
  const host = homebridgeHost ?? new WebHomebridgeHost({ storagePath, configPath, coordinatorBridge, registrations });
  const integration = new WebHomebridgeMaintenance({ store: new WebHomebridgeMaintenanceStore(storagePath), registrations, host });
  const transactions = new WebAdminTransactions({ store: new WebAdminTransactionStore(storagePath),
    participants: new Map([['coordinator', webCoordinatorParticipant(runtime)], ['homebridge', integration]]), enrollmentGuard: assertCurrent });
  let collector, accepting = true;
  const setup = {
    public: async () => ({ deployment: { label: 'Homebridge plugin' }, onboarding_required: false,
      revision: String(row.revision), restart_required: false, gateways: registrations.map(({ key, ...value }) => value),
      ...application.public(), connection_activation: 'homebridge_settings', integration_registration: 'protected_local_configuration',
      key_enrollments: [], backup: backup.status(registrations), homebridge: await integration.status() }),
    application: async body => { await application.save(body); for (const value of registrations) collector.requestDiscovery(value.id); return setup.public(); },
  };
  const backend = new WebAdminBackend({ registrations, accessMode: row.settings.accessMode, setup, history, transactions, backup, assertCurrent, integration,
    hiddenUsers: gateway => integration.hiddenUsers(gateway),
    keypadHook: (registration, alarm, started) => webCoordinatorKeypad(runtime, registration, alarm)(started),
    requestDiscovery: gateway => collector.requestDiscovery(gateway) });
  collector = new WebAdminCollector({ backend, interval: () => application.values.discovery_seconds });
  const server = createWebAdminServer({ tls, origin: row.settings.origin, auth, backend,
    assets: await loadWebAdminAssets(), available: () => accepting,
    web: { public_url: row.settings.publicUrl, bind: row.settings.bind, port: row.settings.port } });
  return {
    server, start: () => collector.start(),
    async close() {
      accepting = false;
      const closed = new Promise(resolve => server.close(() => resolve())); server.closeAllConnections();
      await collector.close(); await auth.close(); await backend.pending; await host.clearAuthentication(); await history.pending; await application.pending; await closed;
    },
  };
}
