import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { requestJson } from './transport.js';
import { Fault, requireValue } from './fault.js';

const gid = v => typeof v === 'string' ? v.replaceAll(':', '').toUpperCase() : '';
const clockDefault = { now: () => performance.now(), wall: () => Date.now() };
export function deconzTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/.test(value)) return NaN;
  return Date.parse(value.endsWith('Z') ? value : value + 'Z');
}

export class DeconzInput {
  constructor(source, key, { request = requestJson } = {}) {
    requireValue(typeof key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(key), 'input_credential_invalid');
    this.source = structuredClone(source); this.key = key; this.request = request;
  }
  async get(path) {
    try { return await this.request({ url: this.source.baseUrl + '/api/' + this.key + path }); }
    catch { throw new Fault('input_read_failed'); }
  }
  async inspect() {
    const s = this.source; const gateway = await this.get('/config');
    requireValue(gid(gateway?.bridgeid) === gid(s.gatewayId), 'input_gateway_identity_mismatch');
    const sensor = await this.get('/sensors/' + s.resourceId);
    requireValue(sensor?.uniqueid === s.uniqueId && sensor?.type === s.resourceType &&
      sensor?.modelid === s.modelId && sensor?.manufacturername === s.manufacturer, 'input_resource_identity_mismatch');
    requireValue(sensor?.config?.reachable === true && sensor.config.on === true, 'input_unreachable');
    const stamp = deconzTimestamp(sensor?.state?.lastupdated);
    requireValue(Number.isFinite(stamp), 'input_state_invalid');
    let alarmDisarmed = false;
    if (s.kind === 'keypad') {
      requireValue(sensor.type === 'ZHAAncillaryControl' && Number.isInteger(sensor.config.enrolled) && sensor.config.enrolled > 0,
        'input_keypad_not_enrolled');
      const alarm = await this.get('/alarmsystems/' + s.alarmId);
      requireValue(alarm?.config?.configured === true && Object.hasOwn(alarm?.devices ?? {}, s.uniqueId), 'input_alarm_mapping_changed');
      requireValue(typeof sensor.state.action === 'string', 'input_state_invalid');
      alarmDisarmed = alarm?.state?.armstate === 'disarmed';
    } else requireValue(Number.isInteger(sensor.state.buttonevent), 'input_state_invalid');
    requireValue(Number.isInteger(gateway.websocketport) && gateway.websocketport > 0 && gateway.websocketport <= 65535, 'input_stream_unavailable');
    const endpoint = new URL(s.baseUrl); endpoint.protocol = 'ws:'; endpoint.port = String(gateway.websocketport);
    return { value: s.kind === 'keypad' ? sensor.state.action : sensor.state.buttonevent,
      stamp, alarmDisarmed, websocketUrl: endpoint.href };
  }
  event(raw) {
    const s = this.source;
    if (raw?.t !== 'event' || raw.e !== 'changed' || raw.r !== 'sensors' || raw.id !== s.resourceId ||
      raw.uniqueid !== undefined && raw.uniqueid !== s.uniqueId || !raw.state) return null;
    const occurredAt = deconzTimestamp(raw.state.lastupdated);
    const value = s.kind === 'keypad' ? ['disarmed', 'already_disarmed'].includes(raw.state.action) ? 'accepted-disarm' :
      raw.state.action === 'invalid_code' ? 'rejected' : null : raw.state.buttonevent;
    return Number.isFinite(occurredAt) && (s.kind === 'keypad' ? value !== null : Number.isInteger(value)) ? { value, occurredAt } : null;
  }
}

/** Live-only source adapter. Polling is used for identity/health and baselines,
 * never to manufacture a press from the last recorded state. No event queue.
 */
export class DeconzInputListener {
  constructor({ profile, driver, router, socketFactory = url => new WebSocket(url), clock = clockDefault, onState = () => {} }) {
    this.profile = profile; this.driver = driver; this.router = router; this.socketFactory = socketFactory; this.clock = clock; this.onState = onState;
    this.running = false; this.ready = false; this.checking = false; this.handling = false; this.sequence = 0; this.generation = 0;
    this.highWater = -Infinity; this.contextKey = null;
  }
  context() { const c = this.router.context(this.profile.id); return JSON.stringify([c.epoch, c.eligible, c.mode]); }
  invalidate(state) { this.ready = false; this.router.disconnect(this.profile.id); this.onState(state); }
  start() { if (this.running) return; this.running = true; this.timer = setInterval(() => { void this.tick(); }, 100); this.timer.unref?.(); void this.tick(); }
  stop() { this.running = false; this.generation++; clearInterval(this.timer); this.socket?.close(); this.socket = null; this.invalidate('stopped'); }
  async tick() {
    if (!this.running || this.checking || this.handling) return;
    this.checking = true; const generation = this.generation;
    try {
      if (!this.socket) {
        if (this.clock.now() < (this.retryAt ?? 0)) return;
        const inspection = await this.driver.inspect();
        if (!this.running || generation !== this.generation) return;
        this.session = randomUUID(); this.sequence = 0; this.highWater = inspection.stamp;
        const socket = this.socketFactory(inspection.websocketUrl); this.socket = socket; this.opened = false;
        this.connectDeadline = this.clock.now() + 5000;
        socket.addEventListener('open', () => { if (this.socket === socket) { this.opened = true; this.contextKey = null; } });
        socket.addEventListener('message', event => { if (this.socket === socket) void this.message(event.data); });
        const ended = () => { if (this.socket === socket) { this.socket = null; this.generation++; this.retryAt = this.clock.now() + 2000; this.invalidate('waiting-for-device'); } };
        socket.addEventListener('close', ended); socket.addEventListener('error', () => { ended(); socket.close(); });
        this.invalidate('connecting'); return;
      }
      if (!this.opened) { requireValue(this.clock.now() < this.connectDeadline, 'input_stream_unavailable'); return; }
      const key = this.context();
      if (key !== this.contextKey) { this.contextKey = key; this.invalidate('rearming'); this.verifyAt = 0; }
      if (!this.ready || this.clock.now() >= this.verifyAt) {
        const initialSequence = this.sequence;
        const inspection = await this.driver.inspect();
        if (!this.running || generation !== this.generation || key !== this.context()) return;
        this.verifyAt = this.clock.now() + 5000;
        // Never move a live high-water mark backwards after an older GET.
        this.highWater = Math.max(this.highWater, inspection.stamp);
        if (!this.ready && this.router.context(this.profile.id).eligible && initialSequence === this.sequence) {
          this.router.arm(this.profile.id, { session: this.session, sequence: this.sequence, value: inspection.value });
          this.ready = true; this.onState('ready');
        }
      }
    } catch { const socket = this.socket; this.socket = null; socket?.close(); this.generation++; this.retryAt = this.clock.now() + 2000; this.invalidate('waiting-for-device'); }
    finally { this.checking = false; }
  }
  async message(data) {
    const receivedAt = this.clock.now(); let event;
    try { if (typeof data !== 'string' || Buffer.byteLength(data) > 65536) return; event = this.driver.event(JSON.parse(data)); } catch { return; }
    if (!event) return;
    const sequence = ++this.sequence;
    if (event.occurredAt <= this.highWater) return;
    this.highWater = event.occurredAt;
    if (!this.ready || !this.running || this.handling || this.checking || this.contextKey !== this.context()) return;
    this.handling = true; const generation = this.generation; const receipt = this.router.capture(this.profile.id);
    try {
      const fresh = await this.driver.inspect(); // Pin source identity/enrollment again before admission.
      if (!this.running || generation !== this.generation || fresh.stamp > event.occurredAt) return;
      if (this.profile.source.kind === 'button' && fresh.value !== event.value || this.profile.source.kind === 'keypad' &&
        (event.value === 'accepted-disarm' ? !['disarmed', 'already_disarmed'].includes(fresh.value) : fresh.value !== 'invalid_code')) return;
      const operation = this.router.offer(this.profile.id, { ...event, sequence, session: this.session,
        receivedAt, epoch: receipt.epoch, snapshot: false }, receipt, { alarmDisarmed: fresh.alarmDisarmed });
      // The worker owns movement; the listener remains available for a fresh
      // eligible interruption. It never queues work behind that operation.
      operation.catch(() => this.onState('operation-held'));
    } catch { this.invalidate('waiting-for-device'); }
    finally { this.handling = false; }
  }
}
