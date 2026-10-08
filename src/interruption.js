import { requireValue } from './fault.js';

// A time estimate of travel, never physical full-open/partial-position sensing.
export class TravelEstimate {
  constructor(total, progress = 0) { this.total = total; this.progress = progress; this.at = null; this.direction = null; this.interrupted = false; }
  advance(now) {
    if (this.at !== null && this.direction) this.progress = Math.min(this.total, Math.max(0,
      this.progress + (this.direction === 'opening' ? 1 : -1) * (now - this.at)));
    this.at = now;
  }
  start(direction, now) { this.advance(now); this.direction = direction; }
  stop(now) { this.advance(now); this.direction = null; this.interrupted = true; }
}

// Runs inside the assembly's existing durable operation and single worker.
export async function followInterruptedTravel(engine, direction, departing = false, checked = null) {
  const e = engine;
  e.admitInterruption(false);
  e.update({ phase: direction, target: direction === 'opening' ? 'open' : 'closed', openEstimated: false, closeEstimated: false });
  const started = e.clock.now(); const deadline = started + e.timing.motionTimeoutMs;
  if (!departing) e.travel.start(direction, started);
  await e.motorCommand(direction === 'opening' ? 'open' : 'close', checked);
  let completion = null; let retractPending = checked?.retractionRequestedAt ?? null;
  for (;;) {
    const s = await e.read(); const now = e.clock.now();
    if (direction === 'closing') {
      if (s.locked) {
        e.admitInterruption(false);
        if (retractPending === null) { retractPending = now; await e.bolt.write(false); }
        requireValue(now - retractPending < e.timing.boltTimeoutMs, 'bolt_retract_timeout');
      } else retractPending = null;
    } else requireValue(!s.locked, 'bolt_extended_during_open');
    requireValue(['closed', 'not-closed'].includes(s.door), 'external_movement');
    if (departing && s.door !== 'closed') { departing = false; e.travel.start('opening', now); }
    if (!departing) {
      e.travel.advance(now);
      if (s.door === 'closed') {
        e.admitInterruption(false);
        requireValue(direction === 'closing', 'open_reversed');
        if (retractPending === null) { e.travel = null; return { closed: true, deadline }; }
      } else {
        if (direction === 'opening' && completion === null) completion = now + e.travel.total - e.travel.progress +
          (e.travel.interrupted ? e.timing.interruptedOpenMarginMs : 0);
        if (retractPending === null && e.takeInterruption()) {
          e.admitInterruption(false);
          if (direction === 'opening') e.travel.stop(e.clock.now());
          await e.motor.interrupt({ beforeWrite: async () => {
            const fresh = await e.read();
            requireValue(fresh.door === 'not-closed' && !fresh.locked, 'interruption_precondition_lost');
          } });
          if (e.travel.direction === null) {
            e.partialOwner = e.operationOwner;
            e.update({ phase: 'stopped-estimated', target: null, openEstimated: false, closeEstimated: false });
            return { closed: false };
          }
          // Retain downward travel through command completion. This conservatively
          // includes the pulse/release interval; no upward progress is credited
          // during relay checks, delivery or cleanup. Physical position is unknown.
          direction = 'opening'; e.travel.interrupted = true;
          e.travel.start(direction, e.clock.now());
          e.update({ phase: 'opening', target: 'open' }); completion = null;
        } else if (direction === 'opening' && now >= completion) {
          e.admitInterruption(false); e.travel = null; e.partialOwner = null;
          e.update({ phase: 'open', openEstimated: true, closeEstimated: false });
          return { closed: false };
        }
        e.admitInterruption(retractPending === null);
      }
    }
    requireValue(e.clock.now() < deadline, 'interrupted_travel_timeout');
    await e.clock.sleep(Math.min(e.timing.pollMs, deadline - e.clock.now()));
  }
}
