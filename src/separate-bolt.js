import { performance } from 'node:perf_hooks';
import { DeconzBolt } from './drivers.js';
import { Fault, requireValue } from './fault.js';

const defaultClock = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
const identityFailure = error => error instanceof Fault && ['bolt_gateway_identity_mismatch', 'bolt_resource_identity_mismatch'].includes(error.message);

// Two explicitly selected, level-controlled outputs. ON on one output requests
// that direction; OFF releases it. Neither acknowledgements nor relay reports
// establish physical bolt position. Pulse estimates exist only in this process.
export class DeconzSeparateBolt {
  constructor(configuration, key, { request, readOnly = true, clock = defaultClock } = {}) {
    const { type, baseUrl, gatewayId, credentialRef, lockRelay, unlockRelay, momentary, pulseSeconds = 0.2 } = configuration;
    requireValue(configuration.relayMode === 'separate' && typeof momentary === 'boolean', 'bolt_relay_mapping_invalid');
    requireValue(lockRelay?.resourceId !== unlockRelay?.resourceId &&
      lockRelay?.uniqueId?.toLowerCase() !== unlockRelay?.uniqueId?.toLowerCase(), 'bolt_relay_mapping_invalid');
    requireValue(!momentary || Number.isFinite(pulseSeconds) && pulseSeconds >= 0.1 && pulseSeconds <= 2, 'bolt_pulse_duration_invalid');
    const output = row => new DeconzBolt({ type, baseUrl, gatewayId, credentialRef, ...row, lockedValue: true }, key, { request, readOnly });
    this.lock = output(lockRelay); this.unlock = output(unlockRelay);
    this.momentary = momentary; this.pulseMs = pulseSeconds * 1000;
    this.readOnly = readOnly; this.clock = clock; this.busy = false; this.stopped = false; this.lastCommand = null;
    this.cancelled = new Promise(resolve => { this.cancel = resolve; });
    this.capabilities = Object.freeze({ separateRelays: true, commandBased: momentary });
  }

  stop() { this.stopped = true; this.lastCommand = null; this.cancel(); }
  invalidate() { this.lastCommand = null; }
  checkRunning() { requireValue(!this.stopped, 'operation_interrupted'); }
  async outputs() {
    const [lock, unlock] = await Promise.all([this.lock.read(), this.unlock.read()]);
    requireValue(!(lock.locked && unlock.locked), 'bolt_relays_conflict');
    return { lock: lock.locked, unlock: unlock.locked };
  }
  async read() {
    try {
      const state = await this.outputs();
      if (this.momentary) {
        requireValue(!state.lock && !state.unlock, 'bolt_relay_active_requires_review');
        return { locked: this.lastCommand, evidence: 'command' };
      }
      return { locked: state.lock ? true : state.unlock ? false : null, evidence: 'relay' };
    } catch (error) { this.lastCommand = null; throw error; }
  }

  async release(output) {
    // OFF is idempotent for these pinned level outputs. Only release is retried;
    // an uncertain ON acknowledgement must never cause another ON request.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await output.write(false); }
      catch (error) { if (identityFailure(error)) throw error; }
      try { if ((await output.read()).locked === false) return; }
      catch (error) { if (identityFailure(error)) throw error; }
      if (attempt < 2) await this.clock.sleep(100);
    }
    throw new Fault('bolt_relay_release_unconfirmed');
  }

  async write(locked, { beforeWrite } = {}) {
    requireValue(!this.readOnly && !this.stopped, 'actuation_disabled');
    requireValue(typeof locked === 'boolean' && typeof beforeWrite === 'function', 'bolt_command_context_required');
    requireValue(!this.busy, 'bolt_relay_busy');
    this.busy = true;
    const selected = locked ? this.lock : this.unlock, opposite = locked ? this.unlock : this.lock;
    let attempted = false, started;
    try {
      const initial = await this.outputs();
      if (this.momentary) requireValue(!initial.lock && !initial.unlock, 'bolt_relay_active_requires_review');
      await beforeWrite(); this.checkRunning();
      this.lastCommand = null;
      // Break before make: release and verify the opposite direction first.
      if (locked ? initial.unlock : initial.lock) await this.release(opposite);
      if (!this.momentary && (locked ? initial.lock : initial.unlock)) return;
      try {
        await selected.write(true, { beforeWrite: async () => {
          requireValue((await opposite.read()).locked === false, 'bolt_relays_conflict');
          await beforeWrite(); this.checkRunning();
          started = this.clock.now(); attempted = true;
        } });
        if (this.momentary) {
          await Promise.race([this.clock.sleep(Math.max(0, this.pulseMs - (this.clock.now() - started))), this.cancelled]);
          this.checkRunning();
        }
      } finally {
        // Release even after a lost ON reply or shutdown during the pulse. A
        // process/power loss can still prevent this; hardware auto-off is not assumed.
        if (this.momentary && attempted) await this.release(selected);
      }
      const final = await this.outputs();
      requireValue(this.momentary ? !final.lock && !final.unlock : locked ? final.lock && !final.unlock : final.unlock && !final.lock,
        'bolt_write_unconfirmed');
      this.checkRunning();
      this.lastCommand = locked;
    } catch (error) { this.lastCommand = null; throw error; }
    finally { this.busy = false; }
  }
}
