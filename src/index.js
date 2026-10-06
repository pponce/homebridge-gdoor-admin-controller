import { createManagementServer, listenLocal, closeServer } from './api.js';
import { validateConfiguration, ConfigurationError } from './config.js';
import { loadIdentity } from './storage.js';
import { readCredentials } from './credentials.js';
import { Diagnostics } from './diagnostics.js';

export const PLUGIN_NAME = 'homebridge-gdoorandbolt-coordinator';
export const PLATFORM_NAME = 'GDoorAndBoltCoordinator';

export default function register(api) {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, CoordinatorPlatform);
}

export class CoordinatorPlatform {
  constructor(log, config, api) {
    this.log = log; this.api = api; this.stopped = false;
    api.on('shutdown', () => { void this.shutdown(); });
    if (!config || config.controllers === undefined) return;
    try { this.configuration = validateConfiguration(config); }
    catch (error) {
      log.error(`Coordinator configuration rejected: ${error instanceof ConfigurationError ? error.message : 'invalid_configuration'}`);
      return;
    }
    api.on('didFinishLaunching', () => {
      this.starting = this.start().catch(() => log.error('Coordinator management API unavailable; no actuation is enabled.'));
    });
  }

  configureAccessory() {
    // This milestone never registered accessories. Do not mutate another version's cache.
    this.log.warn('Cached coordinator accessory is unavailable in this development milestone.');
  }

  async start() {
    if (this.stopped || this.server || !this.configuration) return;
    const identity = await loadIdentity(this.api.user.storagePath());
    if (this.stopped) return;
    const diagnostics = new Diagnostics(this.configuration, () => readCredentials(this.api.user.storagePath()));
    this.server = createManagementServer({ identity, configuration: this.configuration, diagnostics });
    this.server.on('error', () => this.log.error('Coordinator management API error.'));
    await listenLocal(this.server, this.configuration.managementPort);
    if (this.stopped) { await closeServer(this.server); return; }
    this.log.info('Coordinator observation API started. Explicit connection checks are available; hardware control and accessory publication remain disabled.');
  }

  async shutdown() {
    this.stopped = true;
    await this.starting;
    await closeServer(this.server);
  }
}
