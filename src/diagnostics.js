import { TailwindDoor, DeconzBolt } from './drivers.js';
import { RatgdoDoor } from './ratgdo.js';
import { HomebridgeDoor, HomebridgeBolt, HomebridgeMotorRelay, HomebridgeInput } from './homebridge-devices.js';
import { DeconzMotorRelay, PulseMotor } from './pulse-motor.js';
import { DeconzInput } from './deconz-input.js';
import { Fault, requireValue } from './fault.js';

export const PROBE_ERRORS = Object.freeze([
  'credentials_unavailable', 'credential_reference_missing', 'backend_not_implemented',
  'tailwind_credential_invalid', 'door_read_failed', 'door_response_invalid',
  'ratgdo_credential_invalid', 'ratgdo_auth_unsupported',
  'bolt_credential_invalid', 'bolt_identity_configuration_required', 'bolt_read_failed',
  'bolt_gateway_identity_mismatch', 'bolt_resource_identity_mismatch', 'bolt_unreachable', 'bolt_response_invalid',
  'device_probe_failed',
]);

// These additional checks are used by the Homebridge settings UI. Keep the
// existing v1 door/bolt probe response compatible with the standalone admin.
export const CONTROL_PROBE_ERRORS = Object.freeze([
  ...PROBE_ERRORS, 'motor_gateway_identity_mismatch', 'motor_resource_identity_mismatch',
  'motor_unreachable', 'motor_response_invalid', 'motor_read_failed',
  'motor_relay_active_requires_review', 'motor_relay_mapping_invalid',
  'motor_pulse_duration_invalid', 'motor_relay_release_not_supported',
  'pulse_release_confirmation_required', 'input_credential_invalid', 'input_read_failed',
  'input_gateway_identity_mismatch', 'input_resource_identity_mismatch', 'input_unreachable',
  'input_state_invalid', 'input_keypad_type_invalid', 'input_alarm_mapping_changed',
  'input_stream_unavailable',
]);

export class Diagnostics {
  constructor(configuration, credentials, { request, ratgdoRequest } = {}) {
    this.configuration = configuration; this.credentials = credentials;
    this.request = request; this.ratgdoRequest = ratgdoRequest; this.active = new Set();
  }

  async probeControls(id) {
    const controller = this.configuration.controllers.find(row => row.id === id);
    requireValue(controller, 'controller_not_found');
    let credentials; let credentialError;
    try { credentials = await this.credentials(); }
    catch { credentialError = new Fault('credentials_unavailable'); }
    const rows = [
      ...(controller.motorPaths ?? []).map(row => ({ row, kind: 'motor', connection: row.connection })),
      ...(controller.inputs ?? []).filter(row => row.enabled).map(row => ({ row, kind: 'input', connection: row.source })),
    ];
    return Promise.all(rows.map(async ({ row, kind, connection }) => {
      let error = null;
      try {
        if (credentialError) throw credentialError;
        const secret = credentials?.[connection.credentialRef];
        requireValue(typeof secret === 'string', 'credential_reference_missing');
        const options = { readOnly: true, request: this.request };
        if (kind === 'motor') {
          const relay = new (connection.type === 'deconz' ? DeconzMotorRelay : HomebridgeMotorRelay)(connection, secret, options);
          await new PulseMotor({ relay, readOnly: true, openPulseMs: row.openPulseSeconds * 1000,
            closePulseMs: row.closePulseSeconds * 1000 }).verifyIdle();
        } else {
          await new (connection.type === 'deconz' ? DeconzInput : HomebridgeInput)(connection, secret, options).inspect();
        }
      } catch (failure) {
        error = failure instanceof Fault && CONTROL_PROBE_ERRORS.includes(failure.message) ? failure.message : 'device_probe_failed';
      }
      return { id: row.id, name: row.name, kind, error };
    }));
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
          requireValue(configuration.type === 'ratgdo-homekit' && !configuration.credentialRef || typeof secret === 'string', 'credential_reference_missing');
          const driver = kind === 'door' && configuration.type === 'ratgdo-homekit' ? new RatgdoDoor(configuration, secret, { request: this.ratgdoRequest }) : kind === 'door' ? new (configuration.type === 'tailwind' ? TailwindDoor : HomebridgeDoor)(configuration, secret, { request: this.request, feedback: controller.feedback }) :
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
