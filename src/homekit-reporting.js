// Read-only diagnostics. Never invoke GET/SET, subscribe a client, replace a HAP
// method, or change a connection. Keep only bounded, non-identifying summaries.
const fieldName = (kind, field) => field === 'obstruction' ? 'obstruction' :
  (kind === 'garage' ? 'door' : 'bolt') + (field === 'current' ? 'Current' : 'Target');
const scalar = value => typeof value === 'boolean' || Number.isInteger(value) && value >= 0 && value <= 4 ? value : null;
const version = value => typeof value === 'string' && /^[0-9][0-9A-Za-z.+-]{0,63}$/.test(value) ? value : null;
export const TRACE_MODES = Object.freeze(['full', 'events', 'subscribers', 'off']);

export class HomekitReporting {
  constructor(publisher) {
    this.publisher = publisher; this.events = []; this.sequence = 0;
    this.clients = new WeakMap(); this.nextClient = 0;
    this.recording = true; this.recordingRevision = 0; this.traceMode = 'full';
  }
  setRecording(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('invalid_recording');
    this.setMode(enabled ? 'full' : 'off');
    return { recording: this.recording, recordingRevision: this.recordingRevision };
  }
  setMode(mode) {
    if (!TRACE_MODES.includes(mode)) throw new TypeError('invalid_trace_mode');
    if (this.traceMode !== mode) { this.traceMode = mode; this.recording = mode !== 'off'; this.recordingRevision++; }
  }
  client(connection) {
    if (!connection || typeof connection !== 'object') return null;
    if (!this.clients.has(connection)) this.clients.set(connection, 'connection-' + ++this.nextClient);
    return { id: this.clients.get(connection), paired: Boolean(connection.username) };
  }
  subscribers(tile, field) {
    try {
      const accessory = tile.accessory?._associatedHAPAccessory ?? tile.accessory;
      const c = tile.characteristics?.get(field);
      const connections = accessory?.getPrimaryAccessory?.()?._server?.httpServer?.connections;
      if (!(connections instanceof Set) || !Number.isInteger(accessory?.aid) || !Number.isInteger(c?.iid)) return null;
      const result = [];
      for (const connection of connections) {
        if (typeof connection.hasEventNotifications !== 'function') return null;
        if (connection.hasEventNotifications(accessory.aid, c.iid)) result.push(this.client(connection));
        if (result.length >= 32) break;
      }
      return result;
    } catch { return null; }
  }
  record(kind, tile, field, value, connection, explicit = false) {
    if (!this.recording) return;
    // Diagnostic failures must never change a HAP callback/publication result.
    try {
      if (this.traceMode === 'subscribers') {
        if (kind === 'publish') this.subscribers(tile, field);
        return; // No timestamps, event objects, history or GET-client labelling.
      }
      this.events.push({ sequence: ++this.sequence, at: Date.now(), monotonicMs: performance.now(), kind,
        controllerId: tile.id, field: fieldName(tile.kind, field), value: scalar(value),
        ...(kind === 'publish' ? { explicit, subscribers: this.traceMode === 'full' ? this.subscribers(tile, field) : null } : { client: this.client(connection) }) });
      if (this.events.length > 200) this.events.shift();
    } catch { /* Observation only. */ }
  }
  snapshot() {
    const tiles = []; const servers = new Map(); const fieldsById = new Map();
    const inspected = new Map();
    for (const tile of this.publisher.active.values()) {
      const accessory = tile.accessory?._associatedHAPAccessory ?? tile.accessory;
      let server;
      try { server = accessory?.getPrimaryAccessory?.()?._server?.httpServer; } catch { /* Unsupported HAP version. */ }
      if (server) servers.set(server, true);
      const fields = [];
      for (const [field] of this.publisher.fields(tile)) {
        const c = tile.characteristics?.get(field);
        if (!c) continue; // Never create a missing characteristic for inspection.
        const row = { field: fieldName(tile.kind, field), aid: accessory?.aid ?? null, iid: c.iid ?? null,
          reported: scalar(tile.report?.[field]), cached: scalar(c.value),
          status: Number.isInteger(c.statusCode) ? c.statusCode : null,
          supportsEvents: Array.isArray(c.props?.perms) ? c.props.perms.includes('ev') : null,
          subscribers: [] };
        fields.push(row);
        if (Number.isInteger(row.aid) && Number.isInteger(row.iid) && server) {
          if (!fieldsById.has(server)) fieldsById.set(server, new Map());
          fieldsById.get(server).set(row.aid + '.' + row.iid, { row, controllerId: tile.id });
        }
      }
      tiles.push({ controllerId: tile.id, kind: tile.kind, available: Boolean(tile.report?.available), fields });
    }
    let connectionInspection = servers.size ? 'available' : 'unavailable';
    let truncated = false;
    for (const server of servers.keys()) {
      // HAP exposes no public subscription inventory. These guarded reads are
      // isolated here; unsupported internals disable only this diagnostic.
      if (!(server.connections instanceof Set)) { connectionInspection = 'unavailable'; continue; }
      for (const connection of server.connections) {
        if (inspected.size >= 32) { truncated = true; break; }
        const summary = { ...this.client(connection), subscriptions: [], queued: [],
          requestInProgress: typeof connection.handlingRequest === 'boolean' ? connection.handlingRequest : null,
          writtenBytes: Number.isSafeInteger(connection.tcpSocket?.bytesWritten) ? connection.tcpSocket.bytesWritten : null,
          socketWritable: typeof connection.tcpSocket?.writable === 'boolean' ? connection.tcpSocket.writable : null };
        if (typeof connection.hasEventNotifications !== 'function') { connectionInspection = 'unavailable'; continue; }
        const own = fieldsById.get(server) ?? new Map();
        for (const { row, controllerId } of own.values()) {
          if (!connection.hasEventNotifications(row.aid, row.iid)) continue;
          row.subscribers.push(summary.id);
          summary.subscriptions.push({ controllerId, field: row.field });
        }
        if (Array.isArray(connection.queuedEvents)) {
          for (const event of connection.queuedEvents) {
            const match = own.get(event.aid + '.' + event.iid);
            if (!match) continue;
            if (summary.queued.length >= 20) { truncated = true; break; }
            summary.queued.push({ controllerId: match.controllerId, field: match.row.field, value: scalar(event.value) });
          }
        }
        inspected.set(connection, summary);
      }
    }
    let hapVersion = null;
    try { hapVersion = version(this.publisher.api.hap.HAPLibraryVersion?.()); } catch { /* Optional metadata. */ }
    return { schema: 1, bootId: this.publisher.runtime?.bootId ?? null,
      recording: this.recording, recordingRevision: this.recordingRevision,
      traceMode: this.traceMode, publicationMode: this.publisher.publicationMode ?? 'inline',
      publicationRevision: this.publisher.publicationRevision ?? 0,
      homebridgeVersion: version(this.publisher.api.serverVersion), hapVersion,
      connectionInspection, truncated, tiles, clients: [...inspected.values()], events: this.events.map(e => ({ ...e })) };
  }
}
