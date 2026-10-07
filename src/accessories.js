import { randomUUID } from 'node:crypto';
import { HomekitReporting } from './homekit-reporting.js';

export class CoordinatorAccessories {
  constructor(api, identity, runtime, cached = [], timers = { setTimeout, clearTimeout }) {
    this.api = api; this.runtime = runtime; this.identity = identity;
    this.cached = new Map(cached.map(a => [a.UUID, a])); this.active = new Map(); this.timers = timers;
    this.reporting = new HomekitReporting(this);
  }
  sync() {
    this.stop();
    const { Service: S, Characteristic: C } = this.api.hap; const retained = new Set();
    for (const p of this.runtime.configuration.controllers) {
      for (const kind of ['garage', ...(p.exposeBoltLock ? ['bolt'] : [])]) {
        const uuid = this.api.hap.uuid.generate('gdoorandbolt:' + this.identity.instanceId + ':' + p.id + ':' + kind); retained.add(uuid);
        let a = this.active.get(uuid)?.accessory ?? this.cached.get(uuid);
        const fresh = !a; if (!a) a = new this.api.platformAccessory(kind === 'garage' ? p.name : p.name + ' Bolt', uuid);
        a.context = { coordinator: p.id, kind }; a.displayName = kind === 'garage' ? p.name : p.name + ' Bolt';
        a.getService(S.AccessoryInformation).setCharacteristic(C.Manufacturer, 'Garage Door and Bolt Coordinator')
          .setCharacteristic(C.Model, kind === 'garage' ? 'Coordinated Garage' : 'Coordinated Bolt').setCharacteristic(C.SerialNumber, p.id + '-' + kind);
        const type = kind === 'garage' ? S.GarageDoorOpener : S.LockMechanism;
        const service = a.getService(type) ?? a.addService(type, a.displayName);
        service.setCharacteristic(C.Name, a.displayName);
        const v = { accessory: a, service, kind, id: p.id, targetGeneration: 0 };
        this.active.set(uuid, v); this.bind(v);
        // Seed cached and new accessories from one report, before registration.
        // Reading runtime memory here never reads or operates hardware.
        this.commit(v, this.report(v, this.runtime.status(p.id).state)); this.publish(v);
        if (fresh) this.api.registerPlatformAccessories('homebridge-gdoorandbolt-coordinator', 'GDoorAndBoltCoordinator', [a]);
        else this.api.updatePlatformAccessories([a]);
      }
    }
    const removed = new Map([...this.cached, ...[...this.active].map(([id,v]) => [id,v.accessory])]);
    for (const [uuid,a] of removed) if (!retained.has(uuid)) { this.api.unregisterPlatformAccessories('homebridge-gdoorandbolt-coordinator', 'GDoorAndBoltCoordinator', [a]); this.active.delete(uuid); }
    this.cached.clear();
  }
  fields(v) {
    const C = this.api.hap.Characteristic;
    return v.kind === 'garage' ? [['current', C.CurrentDoorState], ['target', C.TargetDoorState], ['obstruction', C.ObstructionDetected]] :
      [['current', C.LockCurrentState], ['target', C.LockTargetState]];
  }
  failure() { return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
  bind(v) {
    v.characteristics = new Map();
    for (const [field, type] of this.fields(v)) {
      const c = v.service.getCharacteristic(type);
      v.characteristics.set(field, c);
      // Match the old publisher's synchronous GET contract. onGet awaits even
      // a plain return value; a concurrent report can otherwise be overwritten
      // when that earlier read completes. Remove handlers when restoring cache.
      c.removeOnGet(); c.removeAllListeners('get');
      c.on('get', (callback, _context, connection) => {
        try {
          const value = this.read(v, field);
          this.reporting.record('get', v, field, value, connection);
          callback(null, value);
        } catch (error) { this.reporting.record('get-error', v, field, null, connection); callback(error); }
      });
      if (field === 'target') {
        c.removeOnSet(); c.removeAllListeners('set');
        c.on('set', (value, callback) => { void this.command(v, value, callback); });
      }
    }
  }
  fresh(id, observedAt) {
    try {
      const e = this.runtime.entry(id); const s = this.runtime.status(id);
      return Boolean(s.actuationEnabled && !s.state.fault && !s.state.unavailable && observedAt &&
        Date.now() - observedAt <= Math.max(10000, e.profile.timing.idlePollSeconds * 2500));
    } catch { return false; }
  }
  read(v, field) {
    if (!v.report?.available || !this.fresh(v.id, v.report.observedAt)) throw this.failure();
    return v.report[field];
  }
  async command(v, value, callback) {
    const generation = v.targetGeneration;
    const command = v.kind === 'garage' ? value === 0 ? 'open' : 'close' : value === 1 ? 'lock' : 'unlock';
    try {
      await this.runtime.submit(v.id, { command, requestId: randomUUID(), issuedAt: Date.now(), bootId: this.runtime.bootId }, 'homekit');
      // HAP writes the requested target after this callback. Do not let a late
      // acknowledgement replace a newer report or a rebuilt accessory binding.
      if (![...this.active.values()].includes(v) || !v.report?.available ||
        v.targetGeneration !== generation && v.report.target !== value) throw this.failure();
      if (v.report.target !== value) {
        const report = { ...v.report, target: value, notificationKey: null };
        // Accepted intent is preparation, not proof of physical movement.
        if (v.kind === 'garage') report.current = value === 0 ? 2 : 3;
        this.commit(v, report); this.publish(v);
      }
      callback();
    } catch { callback(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE)); }
  }
  doorState(s) {
    // The engine publishes its target before the pre-movement read completes.
    // Report preparation as a coherent current/target pair, as the old
    // controller did for unbolting; never report Open with Target Closed.
    if (s.busy && ['open', 'closed'].includes(s.phase) && s.target && s.target !== s.phase) return s.target === 'open' ? 2 : 3;
    return s.phase === 'opening' || s.phase === 'unbolting' && s.target === 'open' ? 2 :
      ['closing','bolting'].includes(s.phase) || s.phase === 'unbolting' && s.target === 'closed' ? 3 : s.phase === 'closed' ? 1 : s.phase === 'open' ? 0 : 4;
  }
  doorTarget(s) { return (s.target ?? s.phase) === 'open' ? 0 : 1; }
  report(v, state) {
    const observedAt = this.runtime.entry(v.id).engine?.observedAt;
    const available = !state.fault && !state.unavailable && this.fresh(v.id, observedAt);
    const report = { available, observedAt, notificationKey: null };
    if (v.kind === 'garage') {
      report.current = this.doorState(state); report.target = this.doorTarget(state); report.obstruction = state.obstruction === true;
      if (available && ['open', 'closed'].includes(state.phase) && (!state.target || state.target === state.phase))
        report.notificationKey = JSON.stringify([state.phase, state.openEstimated === true, state.closeEstimated === true]);
    } else {
      report.current = state.bolt === 'locked' ? 1 : state.bolt === 'unlocked' ? 0 : 3;
      report.target = report.current === 3 ? v.report?.target ?? 0 : report.current;
      if (available && report.current !== 3) report.notificationKey = String(report.current);
    }
    return report;
  }
  commit(v, report) {
    if (v.report?.target !== report.target) v.targetGeneration = (v.targetGeneration ?? 0) + 1;
    v.report = report;
  }
  cancelNotification(v) {
    this.timers.clearTimeout(v.notificationTimer); v.notificationTimer = null; v.notificationKey = null;
  }
  stop() { for (const v of this.active.values()) this.cancelNotification(v); }
  send(v, explicit) {
    const report = v.report;
    const fields = this.fields(v);
    // Match the owner-verified legacy garage patch's explicit terminal pair:
    // TargetDoorState first, then CurrentDoorState. Ordinary reports and bolt
    // reports retain their existing order. Both reported values are committed
    // before either notification; neither notification invokes a SET handler.
    if (explicit && v.kind === 'garage') [fields[0], fields[1]] = [fields[1], fields[0]];
    for (const [field, type] of fields) {
      const c = v.service.getCharacteristic(type);
      const previous = c.value; const forced = explicit && field !== 'obstruction';
      if (!report.available) c.updateValue(this.failure());
      else if (forced) c.sendEventNotification(report[field]);
      else c.updateValue(report[field]);
      if (report.available && (forced || previous !== report[field])) this.reporting.record('publish', v, field, report[field], null, forced);
    }
  }
  publish(v) {
    const key = v.report.notificationKey;
    if (key === null) { this.cancelNotification(v); this.send(v, false); return; }
    if (key === v.notificationKey) { this.send(v, false); return; }
    this.cancelNotification(v); v.notificationKey = key;
    // One publication method per field; send() preserves the legacy garage
    // terminal order and the working bolt's current-then-target order.
    // Ordinary runtime observations continue reconciliation after the budget.
    this.send(v, true);
    let remaining = 2;
    const repeat = () => {
      v.notificationTimer = null;
      let status; let live;
      try { status = this.runtime.status(v.id); live = this.report(v, status.state); }
      catch { this.cancelNotification(v); return; }
      if (v.notificationKey !== key || v.report.notificationKey !== key || !this.fresh(v.id, v.report.observedAt) ||
        live.notificationKey !== key || !live.available || v.kind === 'garage' && status.state.busy ||
        live.current !== v.report.current || live.target !== v.report.target) {
        this.cancelNotification(v); return;
      }
      this.send(v, true);
      if (--remaining > 0) schedule();
    };
    const schedule = () => { v.notificationTimer = this.timers.setTimeout(repeat, 2000); v.notificationTimer.unref?.(); };
    schedule();
  }
  update(id, state) {
    if (id === null) { this.sync(); return; }
    const accessories = [...this.active.values()].filter(v => v.id === id);
    // Commit both tiles before any HAP event/getter can observe this report.
    for (const v of accessories) this.commit(v, this.report(v, state));
    for (const v of accessories) this.publish(v);
  }
}
