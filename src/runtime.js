import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { validateConfiguration, inventory, routingInventory } from './config.js';
import { PrivateStore } from './private-store.js';
import { StateJournal } from './journal.js';
import { readCredentials } from './credentials.js';
import { TailwindDoor, DeconzBolt } from './drivers.js';
import { RatgdoDoor } from './ratgdo.js';
import { DeconzMotorRelay, PulseMotor } from './pulse-motor.js';
import { MovementEngine } from './engine.js';
import { InputRouter } from './input-routing.js';
import { DeconzInput, DeconzInputListener } from './deconz-input.js';
import { HomebridgeDoor, HomebridgeBolt, HomebridgeMotorRelay, HomebridgeInput, HomebridgeInputListener } from './homebridge-devices.js';
import { requestJson } from './transport.js';
import { Fault, requireValue } from './fault.js';
import { controllerTimingValues, profileWithTimings } from './controller-timings.js';
import { controllerHealth, faultCode } from './controller-faults.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = value => validateConfiguration(value, { allowEmpty: true });
const stateValid = s => (s?.schema === 1 || s?.schema === 2 && s.enabled && s.faults) && Number.isSafeInteger(s.revision) && s.revision > 0 && s.configuration &&
  s.commissioned && typeof s.commissioned === 'object' && Array.isArray(s.requests) && s.requests.length <= 256 && Array.isArray(s.events) && s.events.length <= 200 &&
  (s.enabled === undefined || s.enabled && !Array.isArray(s.enabled) && typeof s.enabled === 'object' && Object.values(s.enabled).every(v => typeof v === 'boolean')) &&
  (s.faults === undefined || s.faults && !Array.isArray(s.faults) && typeof s.faults === 'object' && Object.values(s.faults).every(v => v && faultCode(v.reason) && (v.at === null || typeof v.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.at)))) &&
  (s.maintenance === null || typeof s.maintenance?.id === 'string');
const timing = p => ({ pollMs: p.timing.operationPollSeconds * 1000, boltTimeoutMs: p.timing.boltTimeoutSeconds * 1000,
  motionTimeoutMs: p.timing.motionTimeoutSeconds * 1000, openRetractSettleMs: p.timing.openRetractSettleSeconds * 1000,
  closeRetractSettleMs: p.timing.closeRetractSettleSeconds * 1000, closedStableMs: p.feedback.closedStableSeconds * 1000,
  boltSettleMs: p.feedback.boltSettleSeconds * 1000, openingMs: p.feedback.openingSeconds * 1000,
  closingMs: p.feedback.closingSeconds * 1000, interruptedOpenMarginMs: p.timing.interruptedOpenMarginSeconds * 1000 });

export class CoordinatorRuntime {
  constructor({ storagePath, configuration, publish = () => {}, drivers, credentials, clock }) {
    this.storagePath = storagePath; this.bootstrap = normalize(configuration); this.publish = publish; this.driverFactory = drivers;
    this.credentials = credentials ?? (() => readCredentials(storagePath)); this.clock = clock;
    this.store = new PrivateStore(storagePath, 'profiles.json', stateValid); this.entries = new Map();
    this.bootId = randomUUID(); this.stopped = false; this.changing = false; this.tickets = new Map(); this.reviews = new Map();
    this.pendingWrites = Promise.resolve(); this.tailwindRestarts = new Map();
  }
  async save() { const snapshot = structuredClone(this.state); this.pendingWrites = this.pendingWrites.then(() => this.store.write(snapshot));
    try { await this.pendingWrites; } catch (error) { this.storageFault = true; for (const e of this.entries.values()) { e.ready = false; e.engine?.stop(); } throw error; } }
  event(controllerId, type, detail = null) {
    this.state.events.push({ at: new Date().toISOString(), controllerId, type, detail }); this.state.events = this.state.events.slice(-200);
  }
  async start() {
    const saved = await this.store.read();
    this.state = saved ?? { schema: 1, revision: 1, configuration: this.bootstrap, commissioned: {}, maintenance: null, events: [], requests: [] };
    this.state.configuration = normalize(this.state.configuration);
    // Preserve the pre-permission release's physical pulse exception only for
    // persisted installations. New configurations and newly added rows default off.
    if (saved && this.state.lockoutPermissionsVersion !== 1) {
      for (const profile of this.state.configuration.controllers) {
        const approved = this.state.commissioned[profile.id] === hash(profile);
        for (const motor of profile.motorPaths) motor.allowDuringOpenerLockout ??= true;
        for (const input of profile.inputs) input.allowDuringOpenerLockout ??=
          ['button', 'keypad'].includes(input.source.kind) && input.motorPath !== 'primary';
        if (approved) this.state.commissioned[profile.id] = hash(normalize({ controllers: [profile] }).controllers[0]);
      }
      this.state.configuration = normalize(this.state.configuration);
    }
    this.state.lockoutPermissionsVersion = 1;
    // Migrate saved approval once. A runtime fault never changes this choice.
    this.state.enabled ??= Object.fromEntries(this.configuration.controllers.map(p => [p.id, this.state.commissioned[p.id] === hash(p)]));
    this.state.faults ??= {};
    this.state.schema = 2; // Older releases must refuse this state, not re-enable a disabled controller.
    for (const request of this.state.requests) if (request.status === 'pending') {
      request.status = 'unknown'; this.event(request.controllerId, 'restart-observation');
    }
    await this.save(); await this.build();
  }
  get configuration() { return this.state.configuration; }
  async makeDrivers(profile, readOnly = false) {
    if (this.driverFactory) return this.driverFactory(profile, readOnly);
    const keys = await this.credentials();
    const key = ref => { requireValue(typeof keys[ref] === 'string', 'credential_reference_missing'); return keys[ref]; };
    const door = profile.door.type === 'ratgdo-homekit'
      ? new RatgdoDoor(profile.door, profile.door.credentialRef ? key(profile.door.credentialRef) : undefined, { readOnly })
      : new (profile.door.type === 'tailwind' ? TailwindDoor : HomebridgeDoor)(profile.door, key(profile.door.credentialRef), { readOnly, feedback: profile.feedback });
    const bolt = new (profile.bolt.type === 'deconz' ? DeconzBolt : HomebridgeBolt)(profile.bolt, key(profile.bolt.credentialRef), { readOnly, feedback: profile.feedback.bolt });
    const motorPaths = {};
    for (const p of profile.motorPaths) {
      motorPaths[p.id] = new PulseMotor({ relay: new (p.connection.type === 'deconz' ? DeconzMotorRelay : HomebridgeMotorRelay)(p.connection, key(p.connection.credentialRef), { readOnly }),
        openPulseMs: p.openPulseSeconds * 1000, closePulseMs: p.closePulseSeconds * 1000, readOnly,
        interruption: p.interruption === 'stop-opening-reverse-closing' });
    }
    return { door, bolt, motorPaths, inputDrivers: new Map(profile.inputs.filter(i => i.enabled).map(i => {
      return [i.id, new (i.source.type === 'deconz' ? DeconzInput : HomebridgeInput)(i.source, key(i.source.credentialRef))];
    })) };
  }
  async build(onlyId = null, acknowledge = false) {
    for (const e of this.entries.values()) if (!onlyId || e.profile.id === onlyId) { clearTimeout(e.timer); e.engine?.stop(); for (const l of e.listeners ?? []) l.stop(); }
    if (onlyId) this.entries.delete(onlyId); else this.entries.clear();
    for (const p of this.configuration.controllers.filter(p => !onlyId || p.id === onlyId)) {
      const entry = { profile: p, ready: false, held: 'not-commissioned', listeners: [], inputStates: {}, job: null };
      this.entries.set(p.id, entry);
      if (this.state.enabled[p.id] !== true || this.state.commissioned[p.id] !== hash(p) || this.state.maintenance) continue;
      entry.held = 'checking-devices'; this.publish(p.id, this.status(p.id).state);
      try {
        const hw = await this.makeDrivers(p);
        const engine = new MovementEngine({ ...hw, lockoutMotorPaths: p.motorPaths.filter(m => m.allowDuringOpenerLockout === true).map(m => m.id), journal: new StateJournal(this.storagePath, p.id), feedback: p.feedback, timing: timing(p),
          ...(this.clock ? { clock: this.clock } : {}), publish: snapshot => this.publish(p.id, snapshot) });
        engine.recordFault = async fault => {
          const previous = this.state.faults[p.id];
          if (previous?.reason === fault.reason && previous?.at === fault.at) return;
          this.state.faults[p.id] = fault; this.event(p.id, 'fault-recorded', fault.reason); await this.save();
        };
        entry.engine = engine; entry.hardware = hw; entry.router = new InputRouter(engine, p.inputs, this.clock);
        entry.router.inhibited = () => this.stopped || this.changing || Boolean(this.state.maintenance) || Boolean(entry.job) || Date.now() < (entry.restartingUntil ?? 0);
        await this.initializeEntry(entry, acknowledge);
        this.schedule(entry);
      } catch (error) { entry.held = error instanceof Fault ? error.message : 'controller_unavailable'; }
    }
    this.publish(null, null);
  }
  current(entry) {
    return !this.stopped && !this.storageFault && !this.state.maintenance &&
      this.entries.get(entry.profile.id) === entry && !entry.engine?.stopped &&
      this.state.enabled[entry.profile.id] === true && this.state.commissioned[entry.profile.id] === hash(entry.profile);
  }
  async initializeEntry(entry, acknowledge = false) {
    if (!this.current(entry) || entry.initializing) return;
    const task = (async () => {
      await entry.engine.initialize({ acknowledge });
      if (!this.current(entry)) return;
      entry.ready = entry.engine.initialized || Boolean(entry.engine.state.fault);
      entry.held = entry.ready ? null : entry.engine.startupRetry ? 'waiting-for-devices' : 'controller_requires_review';
      if (entry.ready) for (const input of entry.profile.inputs.filter(i => i.enabled)) {
        const listener = new (input.source.type === 'deconz' ? DeconzInputListener : HomebridgeInputListener)({
          profile: input, driver: entry.hardware.inputDrivers.get(input.id), router: entry.router,
          ...(this.clock ? { clock: this.clock } : {}), onState: value => { entry.inputStates[input.id] = value; } });
        entry.listeners.push(listener); listener.start();
      }
    })();
    entry.initializing = task;
    try { await task; }
    finally { entry.initializing = null; if (this.current(entry)) this.publish(entry.profile.id, entry.engine.snapshot()); }
  }
  schedule(entry) {
    clearTimeout(entry.timer);
    if (!this.current(entry) || !entry.ready && !entry.engine?.startupRetry) return;
    entry.timer = setTimeout(async () => {
      try {
        if (!this.current(entry)) return;
        if (!this.changing && !entry.ready && entry.engine.startupRetry) {
          await this.initializeEntry(entry); return;
        }
        if (!this.changing && !this.state.maintenance && !entry.job && !entry.engine.busy && !entry.engine.observation && Date.now() >= (entry.restartingUntil ?? 0) && (entry.engine.initialized || entry.engine.state.fault)) {
          await entry.engine.observe();
          if (!this.changing && !this.state.maintenance && !entry.job && !entry.engine.busy && entry.profile.autoBolt && entry.engine.autoClosePending && !entry.engine.snapshot().externalUnlockOverride && entry.engine.initialized) {
            await this.submit(entry.profile.id, { command: 'observed-close', requestId: randomUUID(), issuedAt: Date.now(), bootId: this.bootId }, 'automatic');
          }
        }
      } catch { /* Current engine status carries fixed faults; never retry movement. */ }
      finally { this.schedule(entry); }
    }, entry.engine?.startupRetry ? 5000 : entry.engine?.state.reconciling ? 1000 : entry.profile.timing.idlePollSeconds * 1000); entry.timer.unref?.();
  }
  entry(id) { const e = this.entries.get(id); requireValue(e, 'controller_not_found'); return e; }
  status(id) {
    const e = this.entry(id); const sample = e.engine?.snapshot();
    if (sample) sample.busy = sample.busy || Boolean(e.job) || e.router?.activeInput != null;
    const enabled = this.state.enabled[id] === true, configurationValid = this.state.commissioned[id] === hash(e.profile);
    const status = { controllerId: id, bootId: this.bootId, commissioned: enabled && configurationValid,
      enabled, configurationValid, lastFault: this.state.faults[id] ?? null,
      actuationEnabled: enabled && configurationValid && Date.now() >= (e.restartingUntil ?? 0) && e.ready && Boolean(e.engine?.initialized) && !sample?.fault && !sample?.blocked && !sample?.unavailable && !this.storageFault && !this.state.maintenance && !this.changing && !this.stopped,
      observationEnabled: enabled && configurationValid && e.ready && Boolean(e.engine) && !this.storageFault && !this.state.maintenance && !this.changing && !this.stopped && Date.now() >= (e.restartingUntil ?? 0),
      tailwind: e.profile.door.type === 'tailwind',
      restarting: Date.now() < (e.restartingUntil ?? 0),
      held: this.state.maintenance ? 'maintenance' : this.storageFault ? 'private_storage_write_failed' : e.held, inputStates: { ...e.inputStates },
      state: sample ?? { phase: 'not-commissioned', door: 'unknown', bolt: 'unknown', busy: false, fault: null },
      revision: this.state.revision };
    status.canRecover = enabled && configurationValid && !this.stopped && !this.storageFault && !this.changing && !this.state.maintenance &&
      !sample?.busy && !e.initializing && Boolean(sample?.fault || sample?.unavailable || e.held && e.held !== 'checking-devices');
    status.health = controllerHealth(status); return status;
  }
  inventory() { return inventory(this.configuration).map(row => ({ ...row, status: this.status(row.id) })); }
  routing(id) { const e = this.entry(id); return { ...routingInventory(e.profile), runtimeEnabled: this.status(id).actuationEnabled }; }
  settings() { return { revision: this.state.revision, configuration: structuredClone(this.configuration) }; }
  async applyTimings(id, values, revision) {
    requireValue(revision === this.state.revision, 'settings_revision_conflict');
    const current = this.entry(id), draft = structuredClone(this.configuration);
    draft.controllers = draft.controllers.map(profile => profile.id === id ? profileWithTimings(profile, values) : profile);
    const configuration = normalize(draft), profile = configuration.controllers.find(value => value.id === id);
    this.assertIdle(); this.guard();
    requireValue([...this.entries.values()].every(entry => entry.router?.activeInput == null && !entry.engine?.partialOwner &&
      ![...(entry.engine?.motorPaths.values() ?? [])].some(motor => motor.busy)), 'controller_busy');
    const commissioned = this.state.commissioned[id] === hash(current.profile);
    this.changing = true;
    try {
      this.state.configuration = configuration; this.state.revision++;
      if (commissioned) this.state.commissioned[id] = hash(profile);
      this.reviews.clear(); this.tickets.clear();
      this.event(id, 'timings-applied'); await this.save();
      current.profile = profile;
      // Keep the same engine, journal, overrides, fault state and live subscriptions.
      if (current.engine) {
        current.engine.lockoutMotorPaths = new Set(profile.motorPaths.filter(m => m.allowDuringOpenerLockout === true).map(m => m.id));
        Object.assign(current.engine.timing, timing(profile));
        Object.assign(current.engine.feedback, profile.feedback);
        for (const motor of profile.motorPaths) {
          const driver = current.engine.motorPaths.get(motor.id);
          driver.openPulseMs = motor.openPulseSeconds * 1000; driver.closePulseMs = motor.closePulseSeconds * 1000;
        }
      }
      if (current.router) {
        current.router.epoch++;
        for (const input of profile.inputs) {
          current.router.profiles.set(input.id, structuredClone(input));
          current.router.gates.get(input.id).profile = structuredClone(input);
        }
      }
      for (const listener of current.listeners) listener.profile = profile.inputs.find(input => input.id === listener.profile.id);
      this.schedule(current);
      return this.settings();
    } finally { this.changing = false; this.publishStates(); }
  }
  retainsCommissioning(profile) {
    const current = this.configuration.controllers.find(p => p.id === profile.id);
    // Names and the same validated timing fields editable on the web page do
    // not change the approved device mapping or feedback/actuation policy.
    if (!current || this.state.commissioned[profile.id] !== hash(current)) return false;
    try {
      const candidate = profileWithTimings(current, controllerTimingValues(profile));
      candidate.name = profile.name;
      for (const key of ['exposeTailwindLockout', 'exposeTailwindRestart']) {
        if (Object.hasOwn(profile, key)) candidate[key] = profile[key]; else delete candidate[key];
      }
      for (const group of ['inputs', 'motorPaths']) for (const item of candidate[group]) item.name = profile[group].find(p => p.id === item.id)?.name;
      return hash(candidate) === hash(profile);
    } catch { return false; }
  }
  async review(value, revision) {
    requireValue(revision === this.state.revision, 'settings_revision_conflict'); const configuration = normalize(value);
    const token = randomBytes(24).toString('hex'); this.reviews.clear();
    this.reviews.set(token, { revision, configuration, expires: performance.now() + 300000 });
    return { token, revision, configuration, requiresCommissioning: configuration.controllers.filter(p => !this.retainsCommissioning(p)).map(p => p.id) };
  }
  assertIdle() { requireValue(!this.stopped && !this.storageFault && !this.changing && [...this.entries.values()].every(e => !e.job && !e.engine?.busy && !e.engine?.observation && Date.now() >= (e.restartingUntil ?? 0)), 'controller_busy'); }
  cancelReview(token) { this.reviews.delete(token); return { cancelled: true }; }
  async apply(token) {
    const review = this.reviews.get(token);
    requireValue(review && review.expires >= performance.now() && review.revision === this.state.revision, 'settings_review_expired');
    this.assertIdle(); requireValue(!this.state.maintenance, 'maintenance_held'); this.changing = true;
    this.reviews.delete(token);
    try {
      const retained = review.configuration.controllers.filter(p => this.retainsCommissioning(p));
      this.state.commissioned = Object.fromEntries(retained.map(p => [p.id, hash(p)]));
      this.state.enabled = Object.fromEntries(review.configuration.controllers.map(p => [p.id, this.state.enabled[p.id] === true]));
      this.state.faults = Object.fromEntries(Object.entries(this.state.faults).filter(([id]) => review.configuration.controllers.some(p => p.id === id)));
      this.state.configuration = review.configuration; this.state.revision++; this.tickets.clear();
      this.event(null, 'settings-applied'); await this.save(); await this.build(); return this.settings();
    } finally { this.changing = false; this.publishStates(); }
  }
  async resetCommissioning() {
    this.assertIdle(); requireValue(!this.state.maintenance, 'maintenance_held'); this.changing = true;
    try { this.state.commissioned = {}; this.tickets.clear(); this.event(null, 'credentials-change-review'); await this.save(); await this.build(); return { reset: true }; }
    finally { this.changing = false; this.publishStates(); }
  }
  async disable(id, { revision, bootId }) {
    this.assertIdle(); requireValue(!this.state.maintenance, 'maintenance_held');
    requireValue(revision === this.state.revision && bootId === this.bootId, 'settings_revision_conflict');
    const e = this.entry(id);
    requireValue(e.router?.activeInput == null, 'controller_busy');
    this.changing = true;
    try {
      this.state.enabled[id] = false;
      for (const [token, ticket] of this.tickets) if (ticket.id === id) this.tickets.delete(token);
      e.ready = false; e.held = 'not-commissioned'; clearTimeout(e.timer);
      e.engine?.stop(); for (const listener of e.listeners) listener.stop();
      e.listeners = []; e.inputStates = {};
      this.event(id, 'controller-disabled'); await this.save();
      this.changing = false; return this.status(id);
    } finally { this.changing = false; this.publishStates(); }
  }
  async enable(id, { revision, bootId }) {
    this.assertIdle(); this.guard();
    requireValue(revision === this.state.revision && bootId === this.bootId, 'settings_revision_conflict');
    const e = this.entry(id);
    requireValue(this.state.commissioned[id] === hash(e.profile), 'setup_review_required');
    this.changing = true;
    try {
      this.state.enabled[id] = true; this.event(id, 'controller-enabled'); await this.save();
      await this.build(id); this.changing = false; return this.status(id);
    } finally { this.changing = false; this.publishStates(); }
  }
  async checkStateNow(id, { revision, bootId }) {
    this.assertIdle(); this.guard();
    requireValue(revision === this.state.revision && bootId === this.bootId, 'settings_revision_conflict');
    const e = this.entry(id);
    requireValue(this.current(e) && e.engine && Date.now() >= (e.restartingUntil ?? 0), 'controller_not_enabled');
    requireValue(e.router?.activeInput == null, 'controller_busy');
    this.changing = true;
    try {
      if (e.engine.startupRetry) await this.initializeEntry(e);
      else await e.engine.observe();
      e.engine.autoClosePending = false;
      this.event(id, 'state-checked'); await this.save();
    } finally { this.changing = false; this.publishStates(); }
    return this.status(id);
  }
  async restartTailwind(id, { revision, bootId }, source = 'admin') {
    this.assertIdle(); this.guard();
    requireValue(revision === this.state.revision && bootId === this.bootId, 'settings_revision_conflict');
    const e = this.entry(id);
    requireValue(this.current(e) && e.profile.door.type === 'tailwind' && typeof e.hardware?.door.restart === 'function', 'tailwind_restart_unavailable');
    requireValue(source !== 'homekit' || e.profile.exposeTailwindRestart === true, 'tailwind_restart_unavailable');
    const affected = [...this.entries.values()].filter(row => row.profile.door.type === 'tailwind' && row.profile.door.baseUrl === e.profile.door.baseUrl);
    requireValue(affected.every(row => !row.router?.activeInput && !row.engine?.partialOwner && !['opening', 'closing'].includes(row.engine?.state.door)), 'controller_busy');
    const key = e.profile.door.baseUrl;
    requireValue(Date.now() - (this.tailwindRestarts.get(key) ?? 0) >= 30000, 'tailwind_restart_cooldown');
    this.changing = true;
    try {
      this.event(id, 'tailwind-restart-requested'); await this.save();
      this.tailwindRestarts.set(key, Date.now());
      for (const row of affected) {
        row.restartingUntil = Date.now() + 10000;
        if (row.engine) {
          row.engine.observedAt = 0; row.engine.recoveryClosedSince = null;
          row.engine.update({ unavailable: 'door_read_failed', closedObservedDuringFault: false });
        }
      }
      await e.hardware.door.restart(); // One attempt, never replay an uncertain restart.
    } finally { this.changing = false; this.publishStates(); }
    return this.status(id);
  }
  async recover(id, { revision, bootId }) {
    this.assertIdle(); this.guard();
    requireValue(revision === this.state.revision && bootId === this.bootId, 'settings_revision_conflict');
    const e = this.entry(id);
    requireValue(this.state.enabled[id] === true && this.state.commissioned[id] === hash(e.profile), 'controller_not_enabled');
    requireValue(e.router?.activeInput == null, 'controller_busy');
    this.changing = true;
    try {
      this.event(id, 'recovery-check'); await this.save();
      // Rebuild only this controller. Fresh read-only checks decide readiness;
      // the saved enablement and configuration approval are never rewritten.
      await this.build(id, true); this.changing = false; return this.status(id);
    } finally { this.changing = false; this.publishStates(); }
  }
  async commission(id, { revision, previousControllerStopped, physicalSetupReviewed, recover = false }) {
    this.assertIdle(); requireValue(!this.state.maintenance, 'maintenance_held');
    requireValue(revision === this.state.revision && previousControllerStopped === true && physicalSetupReviewed === true, 'commissioning_confirmation_required');
    const e = this.entry(id); this.changing = true;
    try {
      const hw = await this.makeDrivers(e.profile, true);
      const [door, bolt] = await Promise.all([hw.door.read(), hw.bolt.read()]);
      requireValue(door.door === 'closed' && (door.evidence === 'closed-sensor' || e.profile.feedback.closing === 'timed') && !door.blocked && !door.obstruction, 'commissioning_requires_closed_sensor');
      requireValue(bolt.evidence === e.profile.feedback.bolt, 'bolt_feedback_mismatch');
      for (const motor of Object.values(hw.motorPaths)) await motor.verifyIdle();
      for (const driver of hw.inputDrivers.values()) await driver.inspect();
      const journal = new StateJournal(this.storagePath, id); const previous = await journal.read();
      requireValue(recover === true || !previous.fault && !previous.inProgress, 'recovery_confirmation_required');
      await journal.write({ inProgress: false, fault: false });
      this.state.enabled[id] = true; this.state.commissioned[id] = hash(e.profile); this.tickets.clear(); this.event(id, recover ? 'recovery-confirmed' : 'commissioned');
      await this.save(); await this.build(); this.changing = false; return this.status(id);
    } finally { this.changing = false; this.publishStates(); }
  }
  publishStates() {
    // build() reports while settings changes still hold actuation. Publish the
    // final availability transition as soon as that hold ends, without waiting
    // for an idle hardware poll or making GET derive a different snapshot.
    for (const id of this.entries.keys()) this.publish(id, this.status(id).state);
  }
  async submit(id, body, source = 'admin') {
    const e = this.entry(id);
    requireValue(body.bootId === this.bootId && typeof body.requestId === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(body.requestId), 'command_request_invalid');
    const duplicate = this.state.requests.find(r => r.requestId === body.requestId);
    if (duplicate) { requireValue(duplicate.controllerId === id && duplicate.command === body.command, 'command_request_conflict'); return { accepted: false, duplicate: true, requestId: body.requestId, status: duplicate.status }; }
    requireValue(Number.isFinite(body.issuedAt) && Math.abs(Date.now() - body.issuedAt) <= 15000, 'command_request_expired');
    requireValue(['open', 'close', 'lock', 'unlock', ...(source === 'automatic' ? ['observed-close'] : [])].includes(body.command), 'command_invalid');
    requireValue(!this.stopped && !this.storageFault && !this.changing && !this.state.maintenance && Date.now() >= (e.restartingUntil ?? 0) && e.ready && e.engine.initialized && !e.engine.state.fault && !e.engine.state.unavailable, 'controller_held');
    requireValue(e.engine.acceptsFreshCommand(body.command), 'controller_observing_movement');
    requireValue(!e.job && !e.engine.busy && e.router.activeInput === null, 'controller_busy');
    e.job = true;
    try {
      this.state.requests = this.state.requests.filter(r => r.status === 'pending' || Date.now() - r.issuedAt < 30000);
      requireValue(this.state.requests.length < 256, 'command_capacity');
      const record = { controllerId: id, requestId: body.requestId, command: body.command, issuedAt: body.issuedAt, status: 'pending' };
      this.state.requests.push(record); await this.save();
      requireValue(!this.stopped && !this.state.maintenance, 'controller_held');
      const operation = ['open', 'close'].includes(body.command) ? e.router.builtin(source === 'virtual-keypad' ? source : 'homekit', body.command) : e.engine.execute(body.command);
      e.job = Promise.resolve(operation).then(result => { record.status = e.engine.state.reconciling ? 'unknown' : e.engine.state.fault || result?.accepted === false ? 'held' : 'complete'; this.event(id, record.status, body.command); return result; }, () => { record.status = 'held'; this.event(id, 'command-held'); })
        .finally(async () => { try { await this.save(); } finally { e.job = null; this.publish(id, e.engine.snapshot()); } }).catch(() => { e.ready = false; e.held = 'private_storage_write_failed'; });
      return { accepted: true, duplicate: false, requestId: body.requestId, status: 'pending' };
    } catch (error) { e.job = null; throw error; }
  }
  guard() { requireValue(!this.stopped && !this.storageFault && !this.changing && !this.state.maintenance, 'maintenance_held'); return true; }
  async stationary() {
    for (const p of this.configuration.controllers.filter(p => this.state.enabled[p.id] === true && this.state.commissioned[p.id] === hash(p))) {
      const hw = await this.makeDrivers(p, true); const [door, bolt] = await Promise.all([hw.door.read(), hw.bolt.read()]);
      requireValue(door.door === 'closed' && door.evidence === 'closed-sensor' && !door.blocked && !door.obstruction && bolt.locked,
        'physical_stationary_confirmation_required');
      for (const motor of Object.values(hw.motorPaths)) await motor.verifyIdle();
    }
  }
  async prepareMaintenance(gateway, confirmedClosed) {
    this.assertIdle(); this.guard(); requireValue(confirmedClosed === true && typeof gateway === 'string', 'physical_confirmation_required');
    await this.stationary(); this.preparedMaintenance = { gateway, expires: performance.now() + 600000 }; return { prepared: true, expires_seconds: 600 };
  }
  async confirmMaintenance(kind, token, confirmed) {
    const tx = this.state.maintenance;
    requireValue(tx && tx.token === token && confirmed === true, 'physical_confirmation_required');
    requireValue(kind === 'bolt' && tx.stage === 'awaiting-bolt' || kind === 'still' && tx.stage === 'awaiting-still', 'maintenance_stage_conflict');
    await this.stationary(); tx.stage = kind === 'bolt' ? 'bolt-confirmed' : 'verified'; await this.save(); return true;
  }
  async maintenance(action, id, { physicalCheck = false, gateway = null } = {}) {
    requireValue(typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id), 'maintenance_request_invalid');
    if (action === 'preflight') {
      this.assertIdle(); this.guard();
      if (physicalCheck) { requireValue(this.preparedMaintenance?.gateway === gateway && this.preparedMaintenance.expires >= performance.now(), 'physical_preparation_required'); await this.stationary(); }
      return true;
    }
    if (action === 'pause') {
      this.assertIdle(); requireValue(!this.state.maintenance || this.state.maintenance.id === id, 'maintenance_transaction_conflict');
      if (this.state.maintenance?.id === id) return true;
      if (physicalCheck) requireValue(this.preparedMaintenance?.gateway === gateway && this.preparedMaintenance.expires >= performance.now(), 'physical_preparation_required');
      this.state.maintenance ??= { id, stage: 'paused', physicalCheck, gateway, token: randomBytes(24).toString('hex') };
      this.preparedMaintenance = null; this.tickets.clear(); await this.save(); await this.build(); return true;
    }
    if (action === 'complete' && !this.state.maintenance && this.state.lastMaintenanceId === id) return true;
    requireValue(this.state.maintenance?.id === id, 'maintenance_transaction_conflict');
    if (action === 'verify') { requireValue([...this.entries.values()].every(e => !e.job && !e.engine?.busy), 'controller_busy'); return true; }
    if (action === 'resume') {
      const tx = this.state.maintenance;
      if (tx.stage === 'verified') return true;
      if (tx.physicalCheck) {
        if (tx.stage === 'paused') { tx.stage = 'awaiting-bolt'; await this.save(); }
        requireValue(tx.stage === 'bolt-confirmed', 'physical_confirmation_required');
        await this.stationary(); tx.stage = 'awaiting-still'; await this.save();
        throw new Fault('physical_confirmation_required');
      }
      // Validate every commissioned assembly without moving anything. Keep the
      // durable pause until complete, even after a successful read-only verify.
      for (const p of this.configuration.controllers.filter(p => this.state.enabled[p.id] === true && this.state.commissioned[p.id] === hash(p))) {
        const hw = await this.makeDrivers(p, true); const [door, bolt] = await Promise.all([hw.door.read(), hw.bolt.read()]);
        requireValue(!door.blocked && !door.obstruction && (door.door === 'closed' || !bolt.locked), 'maintenance_devices_require_review');
        for (const m of Object.values(hw.motorPaths)) await m.verifyIdle();
        for (const driver of hw.inputDrivers.values()) await driver.inspect();
      }
      this.state.maintenance.stage = 'verified'; await this.save(); return true;
    }
    if (action === 'complete') {
      requireValue(this.state.maintenance.stage === 'verified', 'maintenance_verification_required');
      this.state.lastMaintenanceId = id; this.state.maintenance = null; this.event(null, 'maintenance-completed'); await this.save(); await this.build(); return true;
    }
    throw new Fault('maintenance_request_invalid');
  }
  keypadBegin(id, scope) {
    const e = this.entry(id); const k = e.profile.keypad;
    requireValue(k && scope.gatewayId === k.gatewayId && scope.alarmId === k.alarmId, 'keypad_scope_mismatch');
    this.guard();
    for (const [token,t] of this.tickets) if (performance.now() - t.at > 2000) this.tickets.delete(token);
    requireValue(this.tickets.size < 128, 'keypad_busy'); const token = randomBytes(24).toString('hex');
    this.tickets.set(token, { id, at: performance.now(), epoch: e.router?.epoch, eligible: this.status(id).actuationEnabled &&
      !e.job && e.engine?.initialized && !e.engine?.busy && !e.engine?.state.fault && ['open','closed'].includes(e.engine?.state.phase) });
    return { token };
  }
  async keypadAfter(token, outcome, mode, elapsed) {
    const t = this.tickets.get(token); this.tickets.delete(token);
    requireValue(t, 'keypad_receipt_invalid'); const e = this.entry(t.id);
    const ignored = { note: 'Ignored: controller busy, unavailable or outcome expired' };
    if (!t.eligible || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 2 || performance.now() - t.at > 2000 || t.epoch !== e.router?.epoch) return ignored;
    const command = outcome === 'rejected' ? 'close' : outcome === 'accepted' && mode === 'disarm' ? 'open' : null;
    if (!command) return { note: 'No controller request' };
    if (command === 'open') {
      const k = e.profile.keypad; const keys = await this.credentials();
      requireValue(typeof keys[k.credentialRef] === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(keys[k.credentialRef]), 'keypad_credential_invalid');
      const config = await requestJson({ url: k.baseUrl + '/api/' + keys[k.credentialRef] + '/config' });
      requireValue(config?.bridgeid?.replaceAll(':','').toLowerCase() === k.gatewayId.replaceAll(':','').toLowerCase(), 'keypad_gateway_mismatch');
      const alarm = await requestJson({ url: k.baseUrl + '/api/' + keys[k.credentialRef] + '/alarmsystems/' + k.alarmId });
      if (alarm?.state?.armstate !== 'disarmed') return ignored;
    }
    if (performance.now() - t.at > 2000 || t.epoch !== e.router.epoch || e.job || e.engine.busy || !['open','closed'].includes(e.engine.state.phase)) return ignored;
    await this.submit(t.id, { command, requestId: randomUUID(), issuedAt: Date.now(), bootId: this.bootId }, 'virtual-keypad');
    return { note: command === 'open' ? 'Open requested; completion not confirmed' : 'Close requested; completion not confirmed' };
  }
  async stop() {
    this.stopped = true; this.tickets.clear();
    for (const e of this.entries.values()) { clearTimeout(e.timer); for (const l of e.listeners) l.stop(); e.engine?.stop(); }
    await Promise.allSettled([...this.entries.values()].flatMap(e => [e.initializing, e.job, e.router?.operation, e.engine?.observation]).filter(x => x && x !== true)); await this.pendingWrites;
  }
}
