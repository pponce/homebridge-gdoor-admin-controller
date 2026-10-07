export class CoordinatorAccessories {
  constructor(api, identity, runtime, cached = [], timers = { setTimeout, clearTimeout }) {
    this.api = api; this.runtime = runtime; this.identity = identity; this.cached = new Map(cached.map(a => [a.UUID, a])); this.active = new Map();
    this.timers = timers;
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
        const info = a.getService(S.AccessoryInformation);
        info.setCharacteristic(C.Manufacturer, 'Garage Door and Bolt Coordinator').setCharacteristic(C.Model, kind === 'garage' ? 'Coordinated Garage' : 'Coordinated Bolt')
          .setCharacteristic(C.SerialNumber, p.id + '-' + kind);
        const type = kind === 'garage' ? S.GarageDoorOpener : S.LockMechanism;
        const service = a.getService(type) ?? a.addService(type, a.displayName);
        service.setCharacteristic(C.Name, a.displayName);
        const state = () => {
          const e = this.runtime.entry(p.id); const s = this.runtime.status(p.id);
          if (!s.actuationEnabled || s.state.fault || s.state.unavailable || !e.engine?.observedAt || Date.now() - e.engine.observedAt > Math.max(10000, p.timing.idlePollSeconds * 2500))
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          return s.state;
        };
        const command = async command => {
          const { randomUUID } = await import('node:crypto');
          try { await this.runtime.submit(p.id, { command, requestId: randomUUID(), issuedAt: Date.now(), bootId: this.runtime.bootId }, 'homekit'); }
          catch { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE); }
        };
        if (kind === 'garage') {
          service.getCharacteristic(C.CurrentDoorState).onGet(() => this.doorState(state()));
          service.getCharacteristic(C.TargetDoorState).onGet(() => this.doorTarget(state())).onSet(v => command(v === 0 ? 'open' : 'close'));
          service.getCharacteristic(C.ObstructionDetected).onGet(() => { state(); return this.runtime.entry(p.id).engine.sample?.obstruction === true; });
        } else {
          service.getCharacteristic(C.LockCurrentState).onGet(() => state().bolt === 'locked' ? 1 : state().bolt === 'unlocked' ? 0 : 3);
          service.getCharacteristic(C.LockTargetState).onGet(() => state().bolt === 'locked' ? 1 : 0).onSet(v => command(v === 1 ? 'lock' : 'unlock'));
        }
        this.active.set(uuid, { accessory: a, service, kind, id: p.id });
        if (fresh) this.api.registerPlatformAccessories('homebridge-gdoorandbolt-coordinator', 'GDoorAndBoltCoordinator', [a]);
        else this.api.updatePlatformAccessories([a]);
      }
    }
    const removed = new Map([...this.cached, ...[...this.active].map(([id,v]) => [id,v.accessory])]);
    for (const [uuid,a] of removed) if (!retained.has(uuid)) { this.api.unregisterPlatformAccessories('homebridge-gdoorandbolt-coordinator', 'GDoorAndBoltCoordinator', [a]); this.active.delete(uuid); }
    this.cached.clear();
  }
  doorState(s) { return s.phase === 'opening' || s.phase === 'unbolting' && s.target === 'open' ? 2 :
    ['closing','bolting'].includes(s.phase) || s.phase === 'unbolting' && s.target === 'closed' ? 3 : s.phase === 'closed' ? 1 : s.phase === 'open' ? 0 : 4; }
  doorTarget(s) { return (s.target ?? s.phase) === 'open' ? 0 : 1; }
  cancelNotification(v) {
    this.timers.clearTimeout(v.notificationTimer); v.notificationTimer = null; v.notificationKey = null;
  }
  stop() { for (const v of this.active.values()) this.cancelNotification(v); }
  terminalKey(state) {
    if (!['open', 'closed'].includes(state.phase) || state.fault || state.unavailable ||
      state.target && state.target !== state.phase) return null;
    return JSON.stringify([state.phase, state.target, state.openEstimated === true, state.closeEstimated === true]);
  }
  reaffirmGarage(v, state, unavailable) {
    const key = unavailable ? null : this.terminalKey(state);
    if (key === null) { this.cancelNotification(v); return; }
    if (key === v.notificationKey) return;
    this.cancelNotification(v); v.notificationKey = key;
    const C = this.api.hap.Characteristic;
    const send = fresh => {
      // A real terminal state only. This does not invoke onSet, operate any
      // hardware, or manufacture an intermediate state to provoke an event.
      const value = fresh.phase === 'open' ? 0 : 1;
      v.service.getCharacteristic(C.TargetDoorState).sendEventNotification(value);
      v.service.getCharacteristic(C.CurrentDoorState).sendEventNotification(value);
    };
    send(state);
    let remaining = 2;
    const repeat = () => {
      if (v.notificationKey !== key) return;
      v.notificationTimer = null;
      let status; let e;
      // A profile rebuild can remove the entry before accessory sync runs.
      try { status = this.runtime.status(v.id); e = this.runtime.entry(v.id); }
      catch { this.cancelNotification(v); return; }
      const observedAt = e.engine?.observedAt;
      if (!status.actuationEnabled || status.state.busy || this.terminalKey(status.state) !== key ||
        !observedAt || Date.now() - observedAt > Math.max(10000, e.profile.timing.idlePollSeconds * 2500)) {
        this.cancelNotification(v); return;
      }
      send(status.state);
      if (--remaining > 0) schedule();
    };
    const schedule = () => { v.notificationTimer = this.timers.setTimeout(repeat, 2000); v.notificationTimer.unref?.(); };
    schedule();
  }
  update(id, state) {
    if (id === null) { this.sync(); return; }
    const C = this.api.hap.Characteristic;
    for (const v of this.active.values()) if (v.id === id) {
      const unavailable = !this.runtime.status(id).actuationEnabled || state.fault || state.unavailable;
      const failure = new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      if (v.kind === 'garage') {
        v.service.updateCharacteristic(C.ObstructionDetected, state.obstruction === true ? true : unavailable ? failure : false);
        if (state.target || ['open', 'closed'].includes(state.phase)) v.service.updateCharacteristic(C.TargetDoorState, this.doorTarget(state));
        v.service.updateCharacteristic(C.CurrentDoorState, unavailable ? failure : this.doorState(state));
        this.reaffirmGarage(v, state, unavailable);
      } else {
        // Garage operations also move the bolt. Keep HomeKit's target in sync
        // with the reported relay state instead of leaving a stale "locking"
        // target behind after the garage has retracted the bolt.
        v.service.updateCharacteristic(C.LockCurrentState, unavailable ? failure : state.bolt === 'locked' ? 1 : state.bolt === 'unlocked' ? 0 : 3);
        if (['locked','unlocked'].includes(state.bolt)) v.service.updateCharacteristic(C.LockTargetState, unavailable ? failure : state.bolt === 'locked' ? 1 : 0);
      }
    }
  }
}
