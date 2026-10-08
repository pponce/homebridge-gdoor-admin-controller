// Fixed codes only: device bodies, URLs and arbitrary adapter errors must never
// enter the durable journal, diagnostics or the user-facing explanation.
const codes = new Set([
  'previous_run_requires_review', 'startup_bolt_state_requires_review',
  'journal_invalid', 'journal_write_failed', 'unexpected_adapter_error',
  'door_read_failed', 'door_response_invalid', 'door_blocked', 'obstruction',
  'door_write_ambiguous', 'door_write_unconfirmed', 'door_position_requires_review',
  'door_open_timeout', 'door_close_timeout', 'opening_requires_known_start',
  'bolt_read_failed', 'bolt_unreachable', 'bolt_response_invalid', 'bolt_feedback_mismatch',
  'bolt_gateway_identity_mismatch', 'bolt_resource_identity_mismatch',
  'bolt_write_ambiguous', 'bolt_write_unconfirmed', 'bolt_retract_timeout', 'bolt_extend_timeout',
  'bolt_extended_at_partial_stop', 'bolt_extended_before_motion', 'bolt_extended_during_open',
  'motor_read_failed', 'motor_unreachable', 'motor_response_invalid',
  'motor_gateway_identity_mismatch', 'motor_resource_identity_mismatch',
  'motor_write_ambiguous', 'motor_write_unconfirmed', 'motor_precondition_lost',
  'motor_relay_active_requires_review', 'motor_relay_release_unconfirmed', 'motor_relay_state_unknown',
  'motor_relay_unavailable', 'motor_relay_busy', 'motor_pulse_context_required',
  'homebridge_read_failed', 'homebridge_state_unavailable', 'homebridge_service_unavailable',
  'homebridge_response_invalid', 'homebridge_bridge_identity_missing', 'homebridge_bridge_identity_mismatch',
  'homebridge_service_identity_mismatch', 'homebridge_identity_unavailable',
  'homebridge_characteristic_unavailable', 'homebridge_bolt_state_unknown',
  'homebridge_write_ambiguous', 'homebridge_write_unconfirmed',
  'unknown_state', 'external_movement', 'operation_interrupted', 'engine_unavailable',
  'open_reversed', 'close_reversed', 'closed_confirmation_timeout', 'closed_confirmation_lost',
  'locking_requires_closed_sensor', 'estimated_bolting_not_allowed',
  'bolt_retract_confirmation_lost', 'close_or_bolt_confirmation_lost',
  'interruption_precondition_lost', 'interruption_request_expired', 'interrupted_travel_timeout',
  'credentials_unavailable', 'credential_reference_missing', 'tailwind_credential_invalid',
  'bolt_credential_invalid', 'homebridge_credential_invalid', 'input_output_feedback_loop',
  'controller_requires_review', 'controller_unavailable', 'private_storage_write_failed',
]);
export const faultCode = value => codes.has(value) ? value : null;

// Used only before any movement, with a clean journal, or during idle reads.
// Identity mismatches, unknown physical states and write failures never qualify.
export const retryableRead = value => [
  'door_read_failed', 'bolt_read_failed', 'bolt_unreachable', 'motor_read_failed',
  'motor_unreachable', 'homebridge_read_failed', 'homebridge_state_unavailable',
  'homebridge_service_unavailable',
].includes(value);

export function controllerHealth(status) {
  const state = status.state ?? {};
  const code = faultCode(state.fault || state.unavailable || status.held);
  if (status.held === 'maintenance') return { title: 'Maintenance paused', detail: 'Complete maintenance to resume control.', code: null };
  if (status.held === 'waiting-for-devices') return { title: 'Waiting for devices',
    detail: 'Startup connection checks are retrying automatically every 5 seconds. Control resumes after all checks pass.', code };
  if (state.fault || status.held && status.held !== 'not-commissioned') {
    const explanations = {
      previous_run_requires_review: 'An earlier fault or interrupted operation requires review. The older record does not identify the original cause.',
      startup_bolt_state_requires_review: 'The bolt reports locked while the door is not closed.',
      motor_relay_active_requires_review: 'A motor relay reports active.',
      operation_interrupted: 'An operation was interrupted before completion was confirmed.',
      journal_invalid: 'The saved operation record could not be verified.',
      journal_write_failed: 'The operation record could not be saved.',
    };
    return { title: 'Needs review', detail: (explanations[code] ?? (code ? 'Controller fault: ' + code.replaceAll('_', ' ') + '.' : 'The controller is held.')) +
      ' Check the physical setup and connections, then enable this garage door in the Homebridge plugin settings.', code };
  }
  if (state.unavailable) return { title: 'Waiting for devices', detail: 'Device checks are retrying automatically. Control is unavailable until fresh state is received.', code };
  if (status.actuationEnabled && state.reconciling && state.door === 'not-closed') return { title: 'Enabled · Position unconfirmed',
    detail: 'Monitoring resumed after restart. This device confirms only closed; the old travel estimate was discarded.' +
      (state.restartCloseAvailable ? ' You can send a new Close request from HomeKit. Relay toggle inputs wait for confirmed position.' : ' New commands wait for confirmed open or closed feedback.'), code: null };
  if (status.actuationEnabled && state.reconciling) return { title: 'Enabled · Monitoring movement',
    detail: 'The controller restarted during movement and is reading the current state. No movement command is replayed. New commands wait for confirmed open or closed feedback.', code: null };
  if (status.actuationEnabled && state.phase === 'position-unknown') return { title: 'Enabled · Position unconfirmed',
    detail: 'The door is not closed. This device does not confirm whether it is fully open or moving; the previous travel estimate was not restored.', code: null };
  return { title: status.actuationEnabled ? 'Enabled' : 'Disabled', detail: '', code: null };
}
