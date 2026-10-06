import { performance } from 'node:perf_hooks';
import { DeconzBolt } from './drivers.js';
import { Fault, requireValue } from './fault.js';

const clockDefault = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

// Generic deCONZ level output, independent of button brand and bolt semantics.
// Identity checks and exact write acknowledgements are shared with the existing
// output driver, while this interface exposes active/inactive rather than lock.
export class DeconzMotorRelay {
  constructor(configuration, key, options = {}) {
    const { activeValue, ...connection } = configuration;
    requireValue(typeof activeValue === 'boolean', 'motor_relay_mapping_invalid');
    this.output = new DeconzBolt({ ...connection, lockedValue: activeValue }, key, options);
    this.capabilities = Object.freeze({ inactiveWriteIdempotent: true });
  }
  async read() {
    try { return { active: (await this.output.read()).locked }; }
    catch (error) { throw this.error(error); }
  }
  async write(active) {
    try { return await this.output.write(active); }
    catch (error) { throw this.error(error); }
  }
  error(error) {
    return new Fault(error instanceof Fault && error.message.startsWith('bolt_') ?
      'motor_' + error.message.slice(5) : error instanceof Fault ? error.message : 'motor_relay_unavailable');
  }
}

/** One pulse through a supported level-output driver. OFF cleanup is distinct
 * from replaying a door command. Its idempotence must be established by the
 * output adapter; an arbitrary "toggle" or command-only switch cannot be used.
 */
export class PulseMotor {
  constructor({ relay, openPulseMs, closePulseMs, clock = clockDefault, readOnly = true, interruption = false }) {
    requireValue([openPulseMs, closePulseMs].every(ms => Number.isFinite(ms) && ms >= 100 && ms <= 2000), 'motor_pulse_duration_invalid');
    requireValue(relay?.capabilities?.inactiveWriteIdempotent === true, 'motor_relay_release_not_supported');
    this.relay = relay; this.openPulseMs = openPulseMs; this.closePulseMs = closePulseMs;
    this.clock = clock; this.readOnly = readOnly; this.busy = false;
    this.capabilities = Object.freeze({ pulse: true, interruption: interruption === true });
  }

  async verifyIdle() {
    const state = await this.relay.read();
    requireValue(state?.active === false, 'motor_relay_active_requires_review');
  }

  async release() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.relay.write(false);
        if ((await this.relay.read()).active === false) return;
      } catch (error) {
        if (error instanceof Fault && ['motor_gateway_identity_mismatch', 'motor_resource_identity_mismatch'].includes(error.message)) throw error;
      }
      if (attempt < 2) await this.clock.sleep(500);
    }
    throw new Fault('motor_relay_release_unconfirmed');
  }

  async interrupt(options) {
    requireValue(this.capabilities.interruption, 'motor_interruption_unavailable');
    return this.write('interrupt', options);
  }

  async write(command, { beforeWrite } = {}) {
    requireValue(!this.readOnly, 'actuation_disabled');
    requireValue((['open', 'close'].includes(command) || command === 'interrupt' && this.capabilities.interruption) && typeof beforeWrite === 'function', 'motor_pulse_context_required');
    requireValue(!this.busy, 'motor_relay_busy');
    this.busy = true;
    try {
      await this.verifyIdle();
      // The assembly worker checks fresh door/bolt state and its durable intent.
      // No raw input listener can pulse a relay by merely publishing a state.
      await beforeWrite();
      const started = this.clock.now();
      try {
        await this.relay.write(true); // Exactly one ON attempt, including ambiguous outcomes.
        await this.clock.sleep(Math.max(0, (command === 'close' ? this.closePulseMs : this.openPulseMs) - (this.clock.now() - started)));
      } finally {
        // Always attempt release after ON was attempted. This does not establish
        // hardware auto-release after power loss; a restart journal remains held.
        await this.release();
      }
    } finally { this.busy = false; }
  }
}
