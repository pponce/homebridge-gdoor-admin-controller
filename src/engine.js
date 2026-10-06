import { performance } from 'node:perf_hooks';
import { Fault, requireValue } from './fault.js';
import { TravelEstimate, followInterruptedTravel } from './interruption.js';

const systemClock = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
const defaults = Object.freeze({ pollMs: 500, boltTimeoutMs: 10000, motionTimeoutMs: 45000,
  openRetractSettleMs: 2000, closeRetractSettleMs: 2000, closedStableMs: 2000,
  boltSettleMs: 2000, openingMs: 20000, closingMs: 20000, interruptedOpenMarginMs: 1000 });
const code = error => error instanceof Fault ? error.message : 'unexpected_adapter_error';

/** Single-assembly worker shared by every admitted input.
 * No action in construction, initialization, observe(), or state publication.
 */
export class MovementEngine {
  constructor({ door, bolt, journal, feedback, timing = {}, motorPaths = {}, clock = systemClock, publish = () => {} }) {
    this.door = door; this.bolt = bolt; this.journal = journal; this.clock = clock; this.publish = publish;
    this.feedback = { ...feedback }; this.timing = { ...defaults, ...timing };
    requireValue(motorPaths && typeof motorPaths === 'object' && !Object.hasOwn(motorPaths, 'primary'), 'engine_motor_paths_invalid');
    this.motorPaths = new Map([['primary', door], ...Object.entries(motorPaths)]);
    this.motor = door; this.interruptionAllowed = false; this.interruptionRequest = null;
    this.travel = null; this.partialOwner = null; this.autoClosePending = false;
    requireValue(['sensor', 'timed'].includes(feedback.opening) && ['sensor', 'timed'].includes(feedback.closing) &&
      ['position', 'relay'].includes(feedback.bolt) && typeof feedback.allowEstimatedBolting === 'boolean', 'engine_feedback_invalid');
    requireValue(Object.keys(timing).every(key => Object.hasOwn(defaults, key)) &&
      Object.values(this.timing).every(value => Number.isFinite(value) && value >= 0 && value <= 300000) &&
      ['pollMs', 'boltTimeoutMs', 'motionTimeoutMs', 'openingMs', 'closingMs'].every(key => this.timing[key] > 0), 'engine_timing_invalid');
    this.busy = false; this.initialized = false; this.stopped = false; this.lastBolt = null;
    this.state = { phase: 'starting', door: 'unknown', bolt: 'unknown', target: null,
      openEstimated: false, closeEstimated: false, fault: null, externalUnlockOverride: false };
  }

  snapshot() { return structuredClone({ ...this.state, busy: this.busy }); }
  update(changes) { Object.assign(this.state, changes); this.publish(this.snapshot()); }
  checkRunning() { requireValue(!this.stopped, 'operation_interrupted'); }
  stop() { this.stopped = true; this.admitInterruption(false); }
  admitInterruption(allowed) {
    this.interruptionAllowed = allowed && this.interruptionOperation && this.interruptionRequest === null;
    if (!allowed) this.interruptionRequest = null;
  }
  requestInterruption() {
    if (!this.interruptionAllowed || this.interruptionRequest !== null) return false;
    this.interruptionRequest = this.clock.now(); this.interruptionAllowed = false; return true;
  }
  takeInterruption() {
    if (this.interruptionRequest === null) return false;
    const age = this.clock.now() - this.interruptionRequest; this.interruptionRequest = null;
    requireValue(age >= 0 && age <= 1500, 'interruption_request_expired'); return true;
  }

  async initialize() {
    requireValue(!this.initialized && !this.busy, 'engine_already_initialized');
    this.busy = true;
    try {
      const previous = await this.journal.read();
      requireValue(previous && typeof previous.inProgress === 'boolean' && typeof previous.fault === 'boolean', 'journal_invalid');
      requireValue(!previous.inProgress && !previous.fault, 'previous_run_requires_review');
      const sample = await this.read();
      requireValue(sample.door === 'closed' || !sample.locked, 'startup_bolt_state_requires_review');
      this.update({ phase: sample.door === 'closed' ? 'closed' : sample.door === 'open' ? 'open' : 'position-unknown' });
      this.initialized = true;
    } catch (error) { await this.fail(code(error)); }
    finally { this.busy = false; }
    return this.snapshot();
  }

  async read() {
    this.checkRunning();
    const [door, bolt] = await Promise.all([this.door.read(), this.bolt.read()]);
    for (const motor of this.motorPaths.values()) if (typeof motor.verifyIdle === 'function') await motor.verifyIdle();
    this.checkRunning();
    requireValue(door && ['closed', 'open', 'not-closed', 'opening', 'closing'].includes(door.door) &&
      typeof door.blocked === 'boolean' && typeof door.obstruction === 'boolean' &&
      bolt && typeof bolt.locked === 'boolean', 'unknown_state');
    requireValue(bolt.evidence === this.feedback.bolt, 'bolt_feedback_mismatch');
    this.lastBolt = bolt.locked;
    // The transport evidence and user's configured meaning must both agree.
    const sample = { ...door, locked: bolt.locked, boltEvidence: bolt.evidence };
    this.sample = sample; this.observedAt = Date.now();
    this.update({ door: sample.door, bolt: sample.locked ? 'locked' : 'unlocked', obstruction: sample.obstruction });
    requireValue(!door.blocked, 'door_blocked');
    requireValue(!door.obstruction, 'obstruction');
    return sample;
  }

  async fail(reason) {
    this.admitInterruption(false); this.travel = null; this.partialOwner = null; this.autoClosePending = false;
    this.initialized = false;
    try { await this.journal.write({ inProgress: false, fault: true }); }
    catch { reason = 'journal_write_failed'; }
    this.update({ phase: 'fault', fault: reason, openEstimated: false, closeEstimated: false });
  }

  async observe() {
    requireValue(this.initialized && !this.state.fault && !this.busy, 'engine_unavailable');
    this.busy = true;
    const previousBolt = this.lastBolt; const previousDoor = this.state.door;
    try {
      const sample = await this.read();
      const changes = {};
      if (previousBolt === true && !sample.locked) changes.externalUnlockOverride = true;
      if (sample.door === 'closed') {
        if (previousDoor !== 'closed' && previousDoor !== 'unknown') this.autoClosePending = true;
        this.travel = null; this.partialOwner = null;
        Object.assign(changes, { phase: 'closed', openEstimated: false, closeEstimated: false });
      }
      else if (sample.door === 'open') Object.assign(changes, { phase: 'open', openEstimated: false, closeEstimated: false });
      else if (this.partialOwner && sample.door === 'not-closed') {
        requireValue(!sample.locked, 'bolt_extended_at_partial_stop'); changes.phase = 'stopped-estimated';
      } else if (!this.state.openEstimated) Object.assign(changes, { phase: 'position-unknown', closeEstimated: false });
      changes.unavailable = null;
      this.update(changes);
    } catch (error) {
      // Transient idle read loss does not erase the previous bolt observation or
      // invent a recovered travel estimate. Identity/physical conflicts latch.
      if (['door_read_failed', 'bolt_read_failed', 'bolt_unreachable', 'motor_read_failed', 'motor_unreachable', 'homebridge_read_failed'].includes(code(error))) {
        this.update({ phase: 'unavailable', unavailable: code(error), openEstimated: false, closeEstimated: false });
      } else await this.fail(code(error));
    } finally { this.busy = false; }
    return this.snapshot();
  }

  async wait(predicate, timeoutMs, failure) {
    const deadline = this.clock.now() + timeoutMs;
    for (;;) {
      const sample = await this.read();
      if (predicate(sample)) return sample;
      requireValue(this.clock.now() < deadline, failure);
      await this.clock.sleep(Math.min(this.timing.pollMs, deadline - this.clock.now()));
    }
  }

  async hold(duration, predicate, failure) {
    const deadline = this.clock.now() + duration;
    for (;;) {
      requireValue(predicate(await this.read()), failure);
      if (this.clock.now() >= deadline) return;
      await this.clock.sleep(Math.min(this.timing.pollMs, deadline - this.clock.now()));
    }
  }

  async retract(closing) {
    const sample = await this.read();
    requireValue(!['opening', 'closing'].includes(sample.door), 'external_movement');
    // A close always refreshes OFF, including an already-OFF relay. An open
    // only writes OFF if needed; both directions apply their own settle delay.
    if (sample.locked || closing) await this.bolt.write(false);
    await this.wait(s => !s.locked, this.timing.boltTimeoutMs, 'bolt_retract_timeout');
    await this.hold(closing ? this.timing.closeRetractSettleMs : this.timing.openRetractSettleMs,
      s => !s.locked && !['opening', 'closing'].includes(s.door), 'bolt_retract_confirmation_lost');
  }

  async execute(command, { motorPath = 'primary', timing = {}, interruption = false, owner = null } = {}) {
    requireValue(['open', 'close', 'unlock', 'lock', 'observed-close'].includes(command), 'command_invalid');
    requireValue(!this.busy, 'controller_busy');
    requireValue(this.initialized && !this.state.fault && !this.stopped, 'engine_unavailable');
    requireValue(command !== 'observed-close' || !this.state.externalUnlockOverride, 'manual_unlock_override');
    requireValue(this.motorPaths.has(motorPath), 'motor_path_unavailable');
    requireValue(Object.keys(timing).every(key => ['openRetractSettleMs', 'closeRetractSettleMs', 'openingMs', 'closingMs'].includes(key)) &&
      Object.entries(timing).every(([key, value]) => Number.isFinite(value) && value >= (key.includes('Retract') ? 0 : 1) && value <= 300000), 'engine_input_timing_invalid');
    requireValue(!this.partialOwner || command === 'close' && owner === this.partialOwner && interruption === true,
      'partial_stop_requires_original_input');
    const selected = this.motorPaths.get(motorPath);
    requireValue(!interruption || selected.capabilities?.interruption === true && this.feedback.opening === 'timed' && this.feedback.closing === 'sensor',
      'interruption_not_supported');
    const previousTiming = this.timing;
    this.busy = true; // Claim ownership synchronously, before any await.
    this.interruptionOperation = interruption; this.operationOwner = owner; this.autoClosePending = false;
    this.motor = selected; this.timing = { ...this.timing, ...timing };
    try {
      await this.journal.write({ inProgress: true, fault: false }); // Durable intent before any actuator request.
      this.update({ externalUnlockOverride: command === 'unlock', target: command === 'open' ? 'open' : command === 'close' ? 'closed' : this.state.target });
      const sample = await this.read();
      requireValue(!['opening', 'closing'].includes(sample.door), 'external_movement');
      if (command === 'unlock') {
        await this.bolt.write(false);
        await this.wait(s => !s.locked, this.timing.boltTimeoutMs, 'bolt_retract_timeout');
        await this.hold(this.timing.openRetractSettleMs, s => !s.locked, 'bolt_retract_confirmation_lost');
      } else if (command === 'lock' || command === 'observed-close') {
        requireValue(sample.door === 'closed' && this.feedback.closing === 'sensor' && sample.evidence === 'closed-sensor', 'locking_requires_closed_sensor');
        await this.confirmClosed(this.clock.now() + this.timing.motionTimeoutMs);
        if (!this.sample.locked) await this.extend(false);
        else await this.hold(this.timing.boltSettleMs, s => s.door === 'closed' && s.locked, 'close_or_bolt_confirmation_lost');
        this.update({ phase: 'closed', closeEstimated: false, openEstimated: false });
      } else if (command === 'close' && sample.door === 'closed' && sample.locked && this.feedback.closing === 'sensor') {
        await this.hold(this.timing.closedStableMs, s => s.door === 'closed' && s.locked, 'closed_confirmation_lost');
        this.update({ phase: 'closed', closeEstimated: false, openEstimated: false });
      } else {
        this.update({ phase: 'unbolting' });
        await this.retract(command === 'close');
        if (command === 'open') await this.open(); else await this.close();
      }
      await this.journal.write({ inProgress: Boolean(this.partialOwner), fault: false });
    } catch (error) { await this.fail(code(error)); }
    finally { this.admitInterruption(false); this.interruptionOperation = false; this.operationOwner = null; this.motor = this.door; this.timing = previousTiming; this.busy = false; }
    return this.snapshot();
  }

  async motorCommand(command) {
    await this.motor.write(command, { beforeWrite: async () => {
      const fresh = await this.read();
      requireValue(!fresh.locked && (command === 'open' ? fresh.door === 'closed' : ['open', 'not-closed'].includes(fresh.door)), 'motor_precondition_lost');
    } });
  }

  async open() {
    const sample = await this.read();
    requireValue(!sample.locked, 'bolt_extended_before_motion');
    if (sample.door === 'open' && this.feedback.opening === 'sensor') return this.update({ phase: 'open', openEstimated: false, closeEstimated: false });
    if (sample.door === 'not-closed' && this.state.openEstimated) return this.update({ phase: 'open' });
    requireValue(sample.door === 'closed', 'opening_requires_known_start');
    if (this.interruptionOperation) {
      this.travel = new TravelEstimate(this.timing.openingMs);
      await followInterruptedTravel(this, 'opening', true); return;
    }
    this.update({ phase: 'opening', openEstimated: false, closeEstimated: false });
    const deadline = this.clock.now() + this.timing.motionTimeoutMs;
    await this.motorCommand('open'); // No retry or fallback to another route.
    let departed = null;
    for (;;) {
      const fresh = await this.read();
      requireValue(!fresh.locked, 'bolt_extended_during_open');
      requireValue(fresh.door !== 'closing' && !(departed !== null && fresh.door === 'closed'), 'open_reversed');
      if (fresh.door === 'open' && this.feedback.opening === 'sensor') return this.update({ phase: 'open' });
      if (fresh.door !== 'closed' && departed === null) departed = this.clock.now();
      if (this.feedback.opening === 'timed' && departed !== null && this.clock.now() - departed >= this.timing.openingMs) {
        return this.update({ phase: 'open', openEstimated: true });
      }
      requireValue(this.clock.now() < deadline, 'door_open_timeout');
      await this.clock.sleep(Math.min(this.timing.pollMs, deadline - this.clock.now()));
    }
  }

  async confirmClosed(deadline) {
    let since = null;
    for (;;) {
      const sample = await this.read();
      requireValue(sample.door !== 'opening', 'close_reversed');
      if (sample.door === 'closed') {
        if (since === null) since = this.clock.now();
        if (this.clock.now() - since >= this.timing.closedStableMs) return;
      } else since = null;
      requireValue(this.clock.now() < deadline, 'closed_confirmation_timeout');
      await this.clock.sleep(Math.min(this.timing.pollMs, deadline - this.clock.now()));
    }
  }

  async close() {
    let sample = await this.read();
    requireValue(!sample.locked, 'bolt_extended_before_motion');
    requireValue(!['opening', 'closing'].includes(sample.door), 'external_movement');
    if (this.interruptionOperation) {
      if (sample.door !== 'closed') {
        this.travel ??= new TravelEstimate(this.timing.openingMs, this.timing.openingMs);
        const result = await followInterruptedTravel(this, 'closing');
        if (!result.closed) return;
        await this.confirmClosed(result.deadline);
      } else await this.confirmClosed(this.clock.now() + this.timing.motionTimeoutMs);
      this.travel = null; this.partialOwner = null; this.admitInterruption(false);
      await this.extend(false);
      this.update({ phase: 'closed', closeEstimated: false, openEstimated: false }); return;
    }
    const started = this.clock.now(); const deadline = started + this.timing.motionTimeoutMs;
    this.update({ phase: 'closing', openEstimated: false, closeEstimated: false });
    if (!(sample.door === 'closed' && this.feedback.closing === 'sensor' && sample.evidence === 'closed-sensor')) await this.motorCommand('close');
    let closedSince = null; let retractPending = null;
    for (;;) {
      sample = await this.read();
      requireValue(sample.door !== 'opening', 'close_reversed');
      // An observed extension during closing gets one OFF attempt. The original
      // travel deadline remains in force; no second motor command is allowed.
      if (sample.locked) {
        closedSince = null;
        if (retractPending === null) {
          retractPending = this.clock.now(); await this.bolt.write(false);
        }
        requireValue(this.clock.now() - retractPending < this.timing.boltTimeoutMs, 'bolt_retract_timeout');
      } else {
        retractPending = null;
        const physical = this.feedback.closing === 'sensor' && sample.door === 'closed' && sample.evidence === 'closed-sensor';
        const estimated = this.feedback.closing === 'timed' && this.clock.now() - started >= this.timing.closingMs;
        if (physical || estimated) {
          if (closedSince === null) closedSince = this.clock.now();
          if (this.clock.now() - closedSince >= this.timing.closedStableMs) {
            if (estimated) requireValue(this.feedback.allowEstimatedBolting, 'estimated_bolting_not_allowed');
            await this.extend(estimated);
            return this.update({ phase: 'closed', closeEstimated: estimated });
          }
        } else closedSince = null;
      }
      requireValue(this.clock.now() < deadline, 'door_close_timeout');
      await this.clock.sleep(Math.min(this.timing.pollMs, deadline - this.clock.now()));
    }
  }

  async extend(estimated) {
    const closed = s => estimated ? !['opening', 'closing'].includes(s.door) : s.door === 'closed' && s.evidence === 'closed-sensor';
    const fresh = await this.read();
    requireValue(!fresh.locked && closed(fresh), 'closed_confirmation_lost');
    await this.bolt.write(true);
    await this.wait(s => { requireValue(closed(s), 'closed_confirmation_lost'); return s.locked; }, this.timing.boltTimeoutMs, 'bolt_extend_timeout');
    await this.hold(this.timing.boltSettleMs, s => closed(s) && s.locked, 'close_or_bolt_confirmation_lost');
  }
}
