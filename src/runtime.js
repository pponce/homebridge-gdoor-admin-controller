import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { validateConfiguration, inventory, routingInventory } from './config.js';
import { PrivateStore } from './private-store.js';
import { StateJournal } from './journal.js';
import { readCredentials } from './credentials.js';
import { TailwindDoor, DeconzBolt } from './drivers.js';
import { DeconzMotorRelay, PulseMotor } from './pulse-motor.js';
import { MovementEngine } from './engine.js';
import { InputRouter } from './input-routing.js';
import { DeconzInput, DeconzInputListener } from './deconz-input.js';
import { HomebridgeDoor, HomebridgeBolt, HomebridgeMotorRelay, HomebridgeInput, HomebridgeInputListener } from './homebridge-devices.js';
import { requestJson } from './transport.js';
import { Fault, requireValue } from './fault.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = value => validateConfiguration(value, { allowEmpty: true });
const stateValid = s => s?.schema === 1 && Number.isSafeInteger(s.revision) && s.revision > 0 && s.configuration &&
  s.commissioned && typeof s.commissioned === 'object' && Array.isArray(s.requests) && s.requests.length <= 256 && Array.isArray(s.events) && s.events.length <= 200 &&
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
    this.pendingWrites = Promise.resolve();
  }
  async save() { const snapshot = structuredClone(this.state); this.pendingWrites = this.pendingWrites.then(() => this.store.write(snapshot));
    try { await this.pendingWrites; } catch (error) { this.storageFault = true; for (const e of this.entries.values()) { e.enabled = false; e.engine?.stop(); } throw error; } }
  event(controllerId, type, detail = null) {
    this.state.events.push({ at: new Date().toISOString(), controllerId, type, detail }); this.state.events = this.state.events.slice(-200);
  }
  async start() {
    this.state = await this.store.read() ?? { schema: 1, revision: 1, configuration: this.bootstrap, commissioned: {}, maintenance: null, events: [], requests: [] };
    this.state.configuration = normalize(this.state.configuration);
    for (const request of this.state.requests) if (request.status === 'pending') {
      request.status = 'unknown'; delete this.state.commissioned[request.controllerId]; this.event(request.controllerId, 'restart-review-required');
    }
    await this.save(); await this.build();
  }
  get configuration() { return this.state.configuration; }
  async makeDrivers(profile, readOnly = false) {
    if (this.driverFactory) return this.driverFactory(profile, readOnly);
    const keys = await this.credentials();
    const key = ref => { requireValue(typeof keys[ref] === 'string', 'credential_reference_missing'); return keys[ref]; };
    const door = new (profile.door.type === 'tailwind' ? TailwindDoor : HomebridgeDoor)(profile.door, key(profile.door.credentialRef), { readOnly, feedback: profile.feedback });
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
  async build() {
    for (const e of this.entries.values()) { clearTimeout(e.timer); e.engine?.stop(); for (const l of e.listeners ?? []) l.stop(); }
    this.entries.clear();
    for (const p of this.configuration.controllers) {
      const entry = { profile: p, enabled: false, held: 'not-commissioned', listeners: [], inputStates: {}, job: null };
      this.entries.set(p.id, entry);
      if (this.state.commissioned[p.id] !== hash(p) || this.state.maintenance) continue;
      try {
        const hw = await this.makeDrivers(p);
        const engine = new MovementEngine({ ...hw, journal: new StateJournal(this.storagePath, p.id), feedback: p.feedback, timing: timing(p),
          ...(this.clock ? { clock: this.clock } : {}), publish: snapshot => this.publish(p.id, snapshot) });
        entry.engine = engine; entry.router = new InputRouter(engine, p.inputs, this.clock);
        entry.router.inhibited = () => this.stopped || this.changing || Boolean(this.state.maintenance) || Boolean(entry.job);
        await engine.initialize(); requireValue(engine.initialized, 'controller_requires_review');
        entry.enabled = true; entry.held = null;
        for (const input of p.inputs.filter(i => i.enabled)) {
          const listener = new (input.source.type === 'deconz' ? DeconzInputListener : HomebridgeInputListener)({ profile: input, driver: hw.inputDrivers.get(input.id), router: entry.router, ...(this.clock ? { clock: this.clock } : {}),
            onState: value => { entry.inputStates[input.id] = value; } });
          entry.listeners.push(listener); listener.start();
        }
        this.schedule(entry);
      } catch (error) { entry.held = error instanceof Fault ? error.message : 'controller_unavailable'; }
    }
    this.publish(null, null);
  }
  schedule(entry) {
    clearTimeout(entry.timer);
    if (this.stopped || !entry.enabled) return;
    entry.timer = setTimeout(async () => {
      try {
        if (!this.changing && !this.state.maintenance && !entry.job && !entry.engine.busy && entry.engine.initialized) {
          await entry.engine.observe();
          if (entry.profile.autoBolt && entry.engine.autoClosePending && !entry.engine.snapshot().externalUnlockOverride && entry.engine.initialized) {
            await this.submit(entry.profile.id, { command: 'observed-close', requestId: randomUUID(), issuedAt: Date.now(), bootId: this.bootId }, 'automatic');
          }
        }
      } catch { /* Current engine status carries fixed faults; never retry movement. */ }
      finally { this.schedule(entry); }
    }, entry.profile.timing.idlePollSeconds * 1000); entry.timer.unref?.();
  }
  entry(id) { const e = this.entries.get(id); requireValue(e, 'controller_not_found'); return e; }
  status(id) {
    const e = this.entry(id); const sample = e.engine?.snapshot();
    if (sample) sample.busy = sample.busy || Boolean(e.job) || e.router?.activeInput !== null;
    return { controllerId: id, bootId: this.bootId, commissioned: this.state.commissioned[id] === hash(e.profile),
      actuationEnabled: e.enabled && !this.storageFault && !this.state.maintenance && !this.changing && !this.stopped,
      held: this.state.maintenance ? 'maintenance' : e.held, inputStates: { ...e.inputStates },
      state: sample ?? { phase: 'not-commissioned', door: 'unknown', bolt: 'unknown', busy: false, fault: null },
      revision: this.state.revision };
  }
  inventory() { return inventory(this.configuration).map(row => ({ ...row, status: this.status(row.id) })); }
  routing(id) { const e = this.entry(id); return { ...routingInventory(e.profile), runtimeEnabled: this.status(id).actuationEnabled }; }
  settings() { return { revision: this.state.revision, configuration: structuredClone(this.configuration) }; }
  async review(value, revision) {
    requireValue(revision === this.state.revision, 'settings_revision_conflict'); const configuration = normalize(value);
    const token = randomBytes(24).toString('hex'); this.reviews.clear();
    this.reviews.set(token, { revision, configuration, expires: performance.now() + 300000 });
    return { token, revision, configuration, requiresCommissioning: configuration.controllers.filter(p => this.state.commissioned[p.id] !== hash(p)).map(p => p.id) };
  }
  assertIdle() { requireValue(!this.stopped && !this.storageFault && !this.changing && [...this.entries.values()].every(e => !e.job && !e.engine?.busy), 'controller_busy'); }
  cancelReview(token) { this.reviews.delete(token); return { cancelled: true }; }
  async apply(token) {
    const review = this.reviews.get(token);
    requireValue(review && review.expires >= performance.now() && review.revision === this.state.revision, 'settings_review_expired');
    this.assertIdle(); requireValue(!this.state.maintenance, 'maintenance_held'); this.changing = true;
    this.reviews.delete(token);
    try {
      this.state.configuration = review.configuration; this.state.revision++; this.tickets.clear();
      for (const id of Object.keys(this.state.commissioned)) if (!review.configuration.controllers.some(p => p.id === id && hash(p) === this.state.commissioned[id])) delete this.state.commissioned[id];
      this.event(null, 'settings-applied'); await this.save(); await this.build(); return this.settings();
    } finally { this.changing = false; }
  }
  async resetCommissioning() {
    this.assertIdle(); requireValue(!this.state.maintenance, 'maintenance_held'); this.changing = true;
    try { this.state.commissioned = {}; this.tickets.clear(); this.event(null, 'credentials-change-review'); await this.save(); await this.build(); return { reset: true }; }
    finally { this.changing = false; }
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
      this.state.commissioned[id] = hash(e.profile); this.tickets.clear(); this.event(id, recover ? 'recovery-confirmed' : 'commissioned');
      await this.save(); await this.build(); this.changing = false; return this.status(id);
    } finally { this.changing = false; }
  }
  async submit(id, body, source = 'admin') {
    const e = this.entry(id);
    requireValue(body.bootId === this.bootId && typeof body.requestId === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(body.requestId), 'command_request_invalid');
    const duplicate = this.state.requests.find(r => r.requestId === body.requestId);
    if (duplicate) { requireValue(duplicate.controllerId === id && duplicate.command === body.command, 'command_request_conflict'); return { accepted: false, duplicate: true, requestId: body.requestId, status: duplicate.status }; }
    requireValue(Number.isFinite(body.issuedAt) && Math.abs(Date.now() - body.issuedAt) <= 15000, 'command_request_expired');
    requireValue(['open', 'close', 'lock', 'unlock', ...(source === 'automatic' ? ['observed-close'] : [])].includes(body.command), 'command_invalid');
    requireValue(!this.stopped && !this.storageFault && !this.changing && !this.state.maintenance && e.enabled && e.engine.initialized && !e.engine.state.fault, 'controller_held');
    requireValue(!e.job && !e.engine.busy && e.router.activeInput === null, 'controller_busy');
    e.job = true;
    try {
      this.state.requests = this.state.requests.filter(r => r.status === 'pending' || Date.now() - r.issuedAt < 30000);
      requireValue(this.state.requests.length < 256, 'command_capacity');
      const record = { controllerId: id, requestId: body.requestId, command: body.command, issuedAt: body.issuedAt, status: 'pending' };
      this.state.requests.push(record); await this.save();
      requireValue(!this.stopped && !this.state.maintenance, 'controller_held');
      const operation = ['open', 'close'].includes(body.command) ? e.router.builtin(source === 'virtual-keypad' ? source : 'homekit', body.command) : e.engine.execute(body.command);
      e.job = Promise.resolve(operation).then(result => { record.status = e.engine.state.fault || result?.accepted === false ? 'held' : 'complete'; this.event(id, record.status, body.command); return result; }, () => { record.status = 'held'; this.event(id, 'command-held'); })
        .finally(async () => { try { await this.save(); } finally { e.job = null; this.publish(id, e.engine.snapshot()); } }).catch(() => { e.enabled = false; e.held = 'private_storage_write_failed'; });
      return { accepted: true, duplicate: false, requestId: body.requestId, status: 'pending' };
    } catch (error) { e.job = null; throw error; }
  }
  guard() { requireValue(!this.stopped && !this.storageFault && !this.changing && !this.state.maintenance, 'maintenance_held'); return true; }
  async stationary() {
    for (const p of this.configuration.controllers.filter(p => this.state.commissioned[p.id] === hash(p))) {
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
      for (const p of this.configuration.controllers.filter(p => this.state.commissioned[p.id] === hash(p))) {
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
    await Promise.allSettled([...this.entries.values()].flatMap(e => [e.job, e.router?.operation]).filter(x => x && x !== true)); await this.pendingWrites;
  }
}
