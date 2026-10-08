// Private optional-server settings; independent of controller profiles.
import { isIP } from 'node:net';
import { WebAdminFiles } from './web-admin-files.js';
import { requireWeb, exact, integer } from './web-admin-common.js';
import { WebAdminError } from './web-admin-auth.js';

export const defaultWebSettings = () => ({ enabled: false, bind: '127.0.0.1', port: 9443,
  origin: 'https://localhost:9443', publicUrl: 'https://localhost:9443', connectionIds: [], accessMode: 'manage' });
export function webOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new WebAdminError('web_origin_invalid'); }
  requireWeb(typeof value === 'string' && value.length <= 512 && url.protocol === 'https:' && url.origin === value && !url.username && !url.password &&
    (isIP(url.hostname.replace(/^\[|\]$/g, '')) || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname)), 'web_origin_invalid');
  return url;
}
export function validateWebSettings(value) {
  requireWeb(exact(value, ['enabled', 'bind', 'port', 'origin', 'publicUrl', 'connectionIds', 'accessMode']) && typeof value.enabled === 'boolean' &&
    typeof value.bind === 'string' && !!isIP(value.bind) && integer(value.port, 1024, 65535) && ['manage', 'observe'].includes(value.accessMode), 'web_settings_invalid');
  const origin = webOrigin(value.origin); webOrigin(value.publicUrl);
  requireWeb(Number(origin.port || 443) === value.port, 'web_backend_port_mismatch');
  requireWeb(Array.isArray(value.connectionIds) && value.connectionIds.length <= 16 && new Set(value.connectionIds).size === value.connectionIds.length &&
    value.connectionIds.every(id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id)) && (!value.enabled || value.connectionIds.length > 0), 'web_connections_required');
  return value;
}
function validate(row) {
  requireWeb(exact(row, ['schema', 'revision', 'settings', 'identities']) && row.schema === 1 && integer(row.revision, 1, Number.MAX_SAFE_INTEGER) &&
    row.identities && typeof row.identities === 'object' && !Array.isArray(row.identities) && Object.entries(row.identities).every(([id, identity]) =>
      /^[a-z][a-z0-9-]{0,47}$/.test(id) && typeof identity === 'string' && /^[0-9A-F]{16}$/.test(identity)), 'web_settings_invalid');
  validateWebSettings(row.settings); return row;
}
export class WebAdminSettings {
  constructor(storagePath) { this.files = new WebAdminFiles(storagePath); this.pending = Promise.resolve(); }
  async read() { return await this.files.read('web-settings.json', validate) ?? { schema: 1, revision: 0, settings: defaultWebSettings(), identities: {} }; }
  save(expectedRevision, settings, identities) {
    const copy = structuredClone({ settings, identities }); validateWebSettings(copy.settings);
    const result = this.pending.then(async () => {
      const current = await this.read(); requireWeb(current.revision === expectedRevision, 'web_settings_changed');
      const row = validate({ schema: 1, revision: current.revision + 1, ...copy });
      await this.files.write('web-settings.json', row, validate); return row;
    }); this.pending = result.catch(() => {}); return result;
  }
}
