import http from 'node:http';
import https from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { Fault, requireValue } from './fault.js';

// Scoped transport for homekit-ratgdo's documented form/HTML API. No redirects,
// proxies or retries. Authentication is established with GET before any POST.
export function ratgdoRequest({ url, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    let req, timer, finished = false;
    const finish = (error, value) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (error) { req?.destroy(); reject(new Fault('device_request_failed')); }
      else resolve(value);
    };
    try {
      const endpoint = new URL(url);
      requireValue(['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.hash, 'invalid_device_url');
      req = (endpoint.protocol === 'https:' ? https : http).request(endpoint, {
        method, agent: false, maxHeaderSize: 8192,
        headers: { ...headers, Connection: 'close', ...(body === undefined ? {} : {
          'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body),
        }) },
      }, res => {
        const chunks = []; let size = 0;
        res.on('error', () => finish(true)); res.on('aborted', () => finish(true));
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 65536) { res.destroy(); finish(true); } else chunks.push(chunk);
        });
        res.on('end', () => finish(false, { status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', () => finish(true)); timer = setTimeout(() => finish(true), 8000); req.end(body);
    } catch { finish(true); }
  });
}
const md5 = text => createHash('md5').update(text).digest('hex');
const quoted = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
export function digestHeader(challenge, credentials, method, uri) {
  requireValue(typeof challenge === 'string' && /^Digest /i.test(challenge), 'ratgdo_auth_unsupported');
  const fields = Object.fromEntries([...challenge.slice(7).matchAll(/(\w+)=(?:"([^"\r\n]*)"|([^,\s]+))/g)].map(m => [m[1].toLowerCase(), m[2] ?? m[3]]));
  requireValue(fields.realm && fields.nonce && (fields.algorithm ?? 'MD5').toUpperCase() === 'MD5' && fields.qop?.split(',').map(v => v.trim()).includes('auth'), 'ratgdo_auth_unsupported');
  const { username, password } = credentials;
  const cnonce = randomBytes(16).toString('hex'), nc = '00000001';
  const response = md5(`${md5(`${username}:${fields.realm}:${password}`)}:${fields.nonce}:${nc}:${cnonce}:auth:${md5(`${method}:${uri}`)}`);
  return 'Digest ' + Object.entries({ username, realm: fields.realm, nonce: fields.nonce, uri, response, qop: 'auth', nc, cnonce,
    ...(fields.opaque ? { opaque: fields.opaque } : {}) }).map(([k,v]) => `${k}=${['qop','nc'].includes(k) ? v : quoted(v)}`).join(', ');
}

/** Experimental: homekit-ratgdo firmware only, NOT ESPHome or MQTT firmware. */
export class RatgdoDoor {
  constructor(configuration, secret, { request = ratgdoRequest, readOnly = true } = {}) {
    this.config = structuredClone(configuration); this.request = request; this.readOnly = readOnly;
    this.capabilities = Object.freeze({ directional: false }); // Do not promise a safe close from uncertain/partial position.
    if (secret !== undefined) {
      try { this.credentials = JSON.parse(secret); } catch { throw new Fault('ratgdo_credential_invalid'); }
      requireValue(this.credentials && ['username','password'].every(k => typeof this.credentials[k] === 'string' && this.credentials[k].length > 0 && this.credentials[k].length <= 256 && !/[\x00-\x1f]/.test(this.credentials[k])), 'ratgdo_credential_invalid');
    }
  }
  async call(path, options = {}) {
    return this.request({ url: this.config.baseUrl + path, ...options });
  }
  async read() {
    let row;
    try {
      const response = await this.call('/status.json');
      requireValue(response.status === 200, 'door_read_failed'); row = JSON.parse(response.text);
    } catch { throw new Fault('door_read_failed'); }
    requireValue(row && typeof row.macAddress === 'string' && row.macAddress.toLowerCase() === this.config.macAddress.toLowerCase(), 'door_response_invalid');
    const states = { Open: 'open', Closed: 'closed', Opening: 'opening', Closing: 'closing', Stopped: 'not-closed' };
    requireValue(Object.hasOwn(states, row.garageDoorState) && typeof row.garageObstructed === 'boolean' &&
      ['Enabled','Disabled'].includes(row.garageLockState) && typeof row.passwordRequired === 'boolean' &&
      Number.isFinite(row.upTime) && row.upTime >= 0, 'door_response_invalid');
    this.passwordRequired = row.passwordRequired;
    requireValue(!row.passwordRequired || this.credentials, 'credential_reference_missing');
    // This flag locks OEM remotes; it is NOT Tailwind's failed-attempt lockout.
    // Conservatively hold commands when remotes are disabled. Never unlock them.
    const disabled = row.garageLockState === 'Disabled';
    return { door: states[row.garageDoorState], evidence: 'closed-sensor', obstruction: row.garageObstructed,
      blocked: disabled, disabled, lockout: null };
  }
  async write(command, { beforeWrite } = {}) {
    requireValue(!this.readOnly, 'actuation_disabled');
    requireValue(['open','close'].includes(command), 'door_command_invalid');
    const sample = await this.read();
    requireValue(!sample.blocked, 'door_blocked'); requireValue(!sample.obstruction, 'obstruction');
    requireValue(['open','closed'].includes(sample.door), 'door_position_requires_review');
    if (sample.door === (command === 'close' ? 'closed' : 'open')) return;
    const headers = {};
    if (this.passwordRequired) {
      requireValue(this.credentials, 'credential_reference_missing');
      let challenge;
      try { challenge = await this.call('/auth'); } catch { throw new Fault('door_read_failed'); }
      requireValue(challenge.status === 401, 'ratgdo_auth_unsupported');
      headers.Authorization = digestHeader(challenge.headers['www-authenticate'], this.credentials, 'POST', '/setgdo');
    }
    // Recheck after the authentication round trip. Never send stop/toggle,
    // change safety settings, unlock remotes or retry an ambiguous POST.
    const fresh = await this.read();
    requireValue(fresh.door === sample.door && !fresh.blocked && !fresh.obstruction, 'door_position_requires_review');
    await beforeWrite?.();
    let result;
    try { result = await this.call('/setgdo', { method: 'POST', headers, body: 'garageDoorState=' + (command === 'open' ? '1' : '0') }); }
    catch { throw new Fault('door_write_ambiguous'); }
    requireValue(result.status === 200 && result.text.trim() === '<p>Success.</p>', 'door_write_unconfirmed');
  }
}
