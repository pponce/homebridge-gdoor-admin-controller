import { performance } from 'node:perf_hooks';
import { requireValue } from './fault.js';

const defaultClock = { now: () => performance.now(), wall: () => Date.now() };

/** Adapter-neutral event gate. Source adapters must supply live notifications,
 * not label GET snapshots as events. deCONZ supplies device timestamps; a
 * Homebridge live stream can establish receipt freshness only, not event age.
 */
export class InputEventGate {
  constructor(profile, clock = defaultClock) {
    this.profile = structuredClone(profile); this.clock = clock; this.reset();
  }
  reset() { this.session = null; this.sequence = -1; this.value = undefined; this.epoch = null; }
  arm({ session, sequence, value, epoch }) {
    requireValue(typeof session === 'string' && session.length > 0 && Number.isSafeInteger(sequence) && sequence >= 0 &&
      Number.isSafeInteger(epoch) && epoch >= 0, 'input_baseline_invalid');
    this.session = session; this.sequence = sequence; this.value = value; this.epoch = epoch;
    this.readyAt = this.clock.now() + this.profile.rearmSeconds * 1000;
  }
  accept(event, context) {
    if (!event || !context || event.session !== this.session || !Number.isSafeInteger(event.sequence) || event.sequence <= this.sequence) return false;
    const previous = this.value;
    this.sequence = event.sequence; this.value = event.value; // Consume busy, stale and unsupported messages too.
    if (event.epoch !== this.epoch || context.epoch !== this.epoch || !context.eligible) { this.reset(); return false; }
    const now = this.clock.now();
    if (event.snapshot !== false || !Number.isFinite(event.receivedAt) || now - event.receivedAt < 0 || now - event.receivedAt > 1500 ||
      now < this.readyAt || !this.profile.enabled) return false;
    if (this.profile.source.type === 'deconz' && (!Number.isFinite(event.occurredAt) ||
      this.clock.wall() - event.occurredAt < -1000 || this.clock.wall() - event.occurredAt > 3000)) return false;
    if (this.profile.source.kind === 'button') return event.value === this.profile.trigger;
    if (this.profile.source.kind === 'switch') {
      if (typeof previous !== 'boolean' || typeof event.value !== 'boolean' || previous === event.value) return false;
      return this.profile.trigger === 'either' || event.value === (this.profile.trigger === 'on');
    }
    // Native keypad adapters independently verify enrollment and fresh disarmed
    // alarm state before forwarding an accepted-disarm outcome. No PIN enters here.
    return this.profile.source.kind === 'keypad' && ['accepted-disarm', 'rejected'].includes(event.value);
  }
}

const timingMap = { openRetractSettleSeconds: 'openRetractSettleMs', closeRetractSettleSeconds: 'closeRetractSettleMs',
  openingSeconds: 'openingMs', closingSeconds: 'closingMs' };

/** Shared admission for built-in sources and every configured physical input.
 * Source bindings are selected from validated configuration, never from event
 * payloads. Receipts are local, one-use objects; HTTP cannot fabricate one.
 */
export class InputRouter {
  constructor(engine, profiles, clock = defaultClock) {
    this.engine = engine; this.clock = clock; this.profiles = new Map(profiles.map(row => [row.id, structuredClone(row)]));
    this.epoch = 0; this.activeInput = null; this.receipts = new WeakSet();
    this.gates = new Map(profiles.map(row => [row.id, new InputEventGate(row, clock)]));
    this.sourceEpochs = new Map(profiles.map(row => [row.id, 0]));
  }
  arm(inputId, baseline) {
    requireValue(this.gates.has(inputId), 'input_not_configured');
    this.sourceEpochs.set(inputId, this.sourceEpochs.get(inputId) + 1);
    this.gates.get(inputId).arm({ ...baseline, epoch: this.epoch });
  }
  disconnect(inputId) {
    requireValue(this.gates.has(inputId), 'input_not_configured');
    this.sourceEpochs.set(inputId, this.sourceEpochs.get(inputId) + 1); this.gates.get(inputId).reset();
  }
  context(inputId) {
    const profile = this.profiles.get(inputId); const state = this.engine.snapshot();
    const healthy = !this.inhibited?.() && this.engine.initialized && !state.fault && !state.reconciling && !this.engine.stopped;
    const idle = healthy && !state.busy && this.activeInput === null && (['open', 'closed'].includes(state.phase) || state.phase === 'stopped-estimated' && this.engine.partialOwner === inputId);
    const interrupt = healthy && state.busy && this.activeInput === inputId && profile?.busyBehavior === 'interrupt' &&
      this.engine.interruptionAllowed === true && typeof this.engine.requestInterruption === 'function';
    return { epoch: this.epoch, eligible: Boolean(profile?.enabled && (idle || interrupt)), mode: interrupt ? 'interrupt' : 'idle' };
  }
  capture(inputId) {
    const receipt = Object.freeze({ inputId, ...this.context(inputId), sourceEpoch: this.sourceEpochs.get(inputId), receivedAt: this.clock.now() });
    this.receipts.add(receipt); return receipt;
  }
  async offer(inputId, event, receipt, { alarmDisarmed = false } = {}) {
    if (!receipt || !this.receipts.has(receipt)) return { accepted: false, reason: 'input_receipt_invalid' };
    this.receipts.delete(receipt);
    const profile = this.profiles.get(inputId); const current = this.context(inputId);
    const elapsed = this.clock.now() - receipt.receivedAt;
    // Always consume a newly observed source sequence, including busy/expired
    // messages, so it cannot become a command after the controller goes idle.
    const matched = this.gates.get(inputId)?.accept(event, current);
    if (!profile || !matched || receipt.sourceEpoch !== this.sourceEpochs.get(inputId) || receipt.inputId !== inputId || !receipt.eligible || !current.eligible || current.epoch !== receipt.epoch ||
      current.mode !== receipt.mode || elapsed < 0 || elapsed > (profile.source.kind === 'keypad' ? 2000 : 1500)) return { accepted: false, reason: 'input_stale_or_busy' };
    // Gate users cannot inject a different action or motor path through value.
    const value = event.value;
    if (profile.source.kind === 'button' && value !== profile.trigger ||
      profile.source.kind === 'switch' && (typeof value !== 'boolean' || profile.trigger !== 'either' && value !== (profile.trigger === 'on'))) {
      return { accepted: false, reason: 'input_trigger_mismatch' };
    }
    if (profile.source.kind === 'keypad' && value === 'accepted-disarm' && alarmDisarmed !== true) return { accepted: false, reason: 'keypad_outcome_ineligible' };
    if (current.mode === 'interrupt') return { accepted: this.engine.requestInterruption() === true, reason: 'interruption_requested' };
    let command = profile.action;
    if (command === 'keypad') {
      if (profile.busyBehavior === 'interrupt') {
        const phase = this.engine.snapshot().phase;
        if (phase === 'closed' && value !== 'accepted-disarm') return { accepted: false, reason: 'keypad_pin_required' };
        command = phase === 'closed' ? 'open' : 'close';
      } else if (value === 'accepted-disarm' && alarmDisarmed === true) command = 'open';
      else if (value === 'rejected') command = 'close';
      else return { accepted: false, reason: 'keypad_outcome_ineligible' };
    }
    if (command === 'toggle') command = this.engine.snapshot().phase === 'closed' ? 'open' : 'close';
    const timing = Object.fromEntries(Object.entries(profile.timing).map(([key, seconds]) => [timingMap[key], seconds * 1000]));
    return this.run(command, { motorPath: profile.motorPath, timing, interruption: profile.busyBehavior === 'interrupt', owner: inputId }, inputId);
  }
  async builtin(source, command) {
    requireValue(['homekit', 'virtual-keypad'].includes(source) && ['open', 'close'].includes(command), 'builtin_input_invalid');
    return this.run(command, { motorPath: 'primary' }, source);
  }
  async run(command, options, inputId) {
    if (this.activeInput !== null || this.engine.busy) return { accepted: false, reason: 'controller_busy' };
    this.epoch++; this.activeInput = inputId;
    try { this.operation = this.engine.execute(command, options); return { accepted: true, result: await this.operation }; }
    finally { this.operation = null; this.activeInput = null; this.epoch++; }
  }
}
