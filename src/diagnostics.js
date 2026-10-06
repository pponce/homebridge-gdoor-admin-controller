import { TailwindDoor, DeconzBolt } from './drivers.js';
import { HomebridgeDoor, HomebridgeBolt } from './homebridge-devices.js';
import { Fault, requireValue } from './fault.js';

export const PROBE_ERRORS = Object.freeze([
  'credentials_unavailable', 'credential_reference_missing', 'backend_not_implemented',
  'tailwind_credential_invalid', 'door_read_failed', 'door_response_invalid',
  'bolt_credential_invalid', 'bolt_identity_configuration_required', 'bolt_read_failed',
  'bolt_gateway_identity_mismatch', 'bolt_resource_identity_mismatch', 'bolt_unreachable', 'bolt_response_invalid',
  'device_probe_failed',
]);

export class Diagnostics {
  constructor(configuration, credentials, { request } = {}) {
    this.configuration = configuration; this.credentials = credentials;
    this.request = request; this.active = new Set();
  }

  async probe(id) {
    const controller = this.configuration.controllers.find(row => row.id === id);
    requireValue(controller, 'controller_not_found');
    requireValue(!this.active.has(id), 'probe_busy');
    this.active.add(id);
    try {
      let credentials; let credentialError;
      try { credentials = await this.credentials(); }
      catch { credentialError = new Fault('credentials_unavailable'); }
      const run = async (configuration, kind) => {
        try {
          if (credentialError) throw credentialError;
          const secret = credentials[configuration.credentialRef];
          requireValue(typeof secret === 'string', 'credential_reference_missing');
          const driver = kind === 'door' ? new (configuration.type === 'tailwind' ? TailwindDoor : HomebridgeDoor)(configuration, secret, { request: this.request, feedback: controller.feedback }) :
            new (configuration.type === 'deconz' ? DeconzBolt : HomebridgeBolt)(configuration, secret, { request: this.request, feedback: controller.feedback.bolt });
          const value = await driver.read();
          return kind === 'door' ? { state: value.door, feedback: value.evidence, blocked: value.blocked, error: null } :
            { state: value.locked ? 'locked' : 'unlocked', feedback: value.evidence, error: null };
        } catch (error) {
          const code = error instanceof Fault && PROBE_ERRORS.includes(error.message) ? error.message : 'device_probe_failed';
          return { state: 'unknown', feedback: 'unavailable', ...(kind === 'door' ? { blocked: null } : {}), error: code };
        }
      };
      const [door, bolt] = await Promise.all([run(controller.door, 'door'), run(controller.bolt, 'bolt')]);
      const limitations = [];
      if (controller.door.type === 'tailwind' && controller.feedback.opening !== 'timed') limitations.push('tailwind_open_requires_estimate');
      if (controller.door.type === 'tailwind' && controller.feedback.closing !== 'sensor') limitations.push('tailwind_closed_sensor_available');
      if (controller.bolt.type === 'deconz' && controller.feedback.bolt !== 'relay') limitations.push('deconz_relay_is_not_position');
      if (door.blocked) limitations.push('door_blocked');
      if (['not-closed','open','opening','closing'].includes(door.state) && bolt.state === 'locked') limitations.push('bolt_extended_with_door_not_closed');
      return { controllerId: id, checkedAt: new Date().toISOString(), door, bolt, limitations,
        compatible: !door.error && !bolt.error && !limitations.length, actuationEnabled: false };
    } finally { this.active.delete(id); }
  }
}
