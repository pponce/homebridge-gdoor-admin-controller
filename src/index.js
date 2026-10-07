import { createManagementServer, listenLocal, closeServer } from './api.js';
import { validateConfiguration } from './config.js';
import { loadIdentity } from './storage.js';
import { readCredentials } from './credentials.js';
import { Diagnostics } from './diagnostics.js';
import { CoordinatorRuntime } from './runtime.js';
import { acquireOwnership } from './ownership.js';
import { CoordinatorAccessories } from './accessories.js';

export const PLUGIN_NAME = 'homebridge-gdoorandbolt-coordinator';
export const PLATFORM_NAME = 'GDoorAndBoltCoordinator';
export default function register(api) { api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, CoordinatorPlatform); }
export class CoordinatorPlatform {
  constructor(log, config, api) {
    this.log = log; this.api = api; this.stopped = false; this.cached = [];
    api.on('shutdown', () => { void this.shutdown(); });
    if (!config || !config.controllers?.length && config.platform !== PLATFORM_NAME) return;
    try { this.configuration = validateConfiguration({ ...config, controllers: config.controllers ?? [] }, { allowEmpty: true }); }
    catch { log.error('Coordinator configuration is invalid; control remains disabled.'); return; }
    api.on('didFinishLaunching', () => {
      this.starting = this.start().catch(async () => { log.error('Coordinator startup failed; control remains disabled.'); await this.runtime?.stop(); await this.releaseOwnership?.(); });
    });
  }
  configureAccessory(accessory) { this.cached.push(accessory); }
  async start() {
    if (this.stopped || this.server || !this.configuration) return;
    const storagePath = this.api.user.storagePath(); const identity = await loadIdentity(storagePath);
    if (this.stopped) return;
    this.releaseOwnership = await acquireOwnership(storagePath);
    this.runtime = new CoordinatorRuntime({ storagePath, configuration: { ...this.configuration, managementPort: this.configuration.managementPort || 27773 },
      publish: (id, state) => this.accessories?.update(id, state) });
    await this.runtime.start(); if (this.stopped) { await this.runtime.stop(); return; }
    if (this.api.hap && this.api.platformAccessory) {
      this.accessories = new CoordinatorAccessories(this.api, identity, this.runtime, this.cached); this.accessories.sync();
    }
    const diagnostics = new Diagnostics(this.runtime.configuration, () => readCredentials(storagePath));
    const probe = diagnostics.probe.bind(diagnostics); diagnostics.probe = id => { diagnostics.configuration = this.runtime.configuration; return probe(id); };
    this.server = createManagementServer({ identity, configuration: this.configuration, diagnostics, runtime: this.runtime,
      ...(this.accessories ? { setReporting: enabled => this.accessories.reporting.setRecording(enabled) } : {}),
      reporting: () => this.accessories?.reporting.snapshot() ?? { schema: 1, connectionInspection: 'unavailable', tiles: [], clients: [], events: [] } });
    this.server.on('error', () => this.log.error('Coordinator management API error.'));
    await listenLocal(this.server, this.configuration.managementPort);
    if (this.stopped) { await closeServer(this.server); await this.runtime.stop(); return; }
    this.log.info('Coordinator ready. Each garage requires explicit commissioning before control is enabled.');
  }
  async shutdown() { this.stopped = true; await this.starting; this.accessories?.stop(); await this.runtime?.stop(); await closeServer(this.server); await this.releaseOwnership?.(); }
}
