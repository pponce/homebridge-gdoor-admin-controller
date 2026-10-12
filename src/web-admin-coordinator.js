// Adapt the plugin's existing coordination API. No second movement engine,
// HomeKit pairing, other-plugin edits, or credentials passed to movement hooks.
import { performance } from 'node:perf_hooks';
import { requireWeb } from './web-admin-common.js';

export function webCoordinatorParticipant(runtime) {
  const released = tx => !runtime.state.maintenance && runtime.state.lastMaintenanceId === tx.id;
  const neverPaused = tx => !runtime.state.maintenance && !tx.write_attempted;
  const readyUnpaused = tx => { if (!neverPaused(tx)) return false; runtime.assertIdle(); runtime.guard(); return true; };
  return {
    api_version: 1,
    applies: context => context.operation !== 'keypad_send' && runtime.configuration.controllers.length > 0,
    guard: () => runtime.guard(),
    preflight: context => runtime.maintenance('preflight', 'web-admin-preflight', { gateway: context.gateway }),
    pause: tx => runtime.maintenance('pause', tx.id, { gateway: tx.gateway }),
    verify: tx => released(tx) || readyUnpaused(tx) || runtime.maintenance('verify', tx.id),
    resume: tx => released(tx) || readyUnpaused(tx) || runtime.maintenance('resume', tx.id),
    complete: tx => released(tx) || readyUnpaused(tx) || runtime.maintenance('complete', tx.id),
    recovery_ready: tx => runtime.state.maintenance?.id === tx.id || released(tx) || readyUnpaused(tx),
  };
}
export function webCoordinatorKeypad(runtime, registration, alarm, { controllerId, clock = () => performance.now() / 1000 } = {}) {
  return started => {
    const profiles = runtime.configuration.controllers;
    if (!profiles.length) { requireWeb(controllerId === undefined, 'controller_not_found'); return null; }
    requireWeb(controllerId !== undefined || profiles.length === 1, 'keypad_scope_ambiguous');
    const profile = controllerId === undefined ? profiles[0] : profiles.find(profile => profile.id === controllerId);
    requireWeb(profile, 'controller_not_found');
    const connections = (runtime.configuration.connections ?? []).filter(row => row.type === 'deconz' && row.baseUrl === registration.endpoint);
    requireWeb(connections.length === 1, 'keypad_scope_mismatch');
    const keypad = { baseUrl: connections[0].baseUrl, credentialRef: connections[0].credentialRef,
      gatewayId: registration.identity, alarmId: alarm };
    const receipt = runtime.keypadBegin(profile.id, { gatewayId: keypad.gatewayId, alarmId: alarm }, keypad);
    return {
      api_version: 1, note: null,
      async after(outcome, mode) {
        const result = await runtime.keypadAfter(receipt.token, outcome, mode, clock() - started); this.note = result.note;
      },
      async failed() {
        // Consume an unused ticket as an unknown outcome. Never request motion
        // to establish what happened to a lost alarm authorization reply.
        try { await runtime.keypadAfter(receipt.token, 'unknown', 'disarm', clock() - started); } catch { /* Already consumed/expired. */ }
        this.note = 'Controller request was not confirmed. No automatic retry.';
      },
    };
  };
}
