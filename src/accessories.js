export class CoordinatorAccessories {
  constructor(api, identity, runtime, cached = []) {
    this.api = api; this.runtime = runtime; this.identity = identity; this.cached = new Map(cached.map(a => [a.UUID, a])); this.active = new Map();
  }
  sync() {
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
          service.getCharacteristic(C.TargetDoorState).onGet(() => state().target === 'open' ? 0 : 1).onSet(v => command(v === 0 ? 'open' : 'close'));
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
  doorState(s) { return s.phase === 'opening' ? 2 : ['closing','bolting'].includes(s.phase) ? 3 : s.phase === 'closed' ? 1 : s.phase === 'open' ? 0 : 4; }
  update(id, state) {
    if (id === null) { this.sync(); return; }
    const C = this.api.hap.Characteristic;
    for (const v of this.active.values()) if (v.id === id) {
      const unavailable = !this.runtime.status(id).actuationEnabled || state.fault || state.unavailable;
      const failure = new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      if (v.kind === 'garage') {
        v.service.updateCharacteristic(C.ObstructionDetected, state.obstruction === true ? true : unavailable ? failure : false);
        v.service.updateCharacteristic(C.CurrentDoorState, unavailable ? failure : this.doorState(state));
        if (state.target) v.service.updateCharacteristic(C.TargetDoorState, state.target === 'open' ? 0 : 1);
      } else v.service.updateCharacteristic(C.LockCurrentState, unavailable ? failure : state.bolt === 'locked' ? 1 : state.bolt === 'unlocked' ? 0 : 3);
    }
  }
}
