// Resolve the actual built-in API when needed, without a Node major whitelist.
// Importing this helper does not load SQLite or open/create any database.
import { WebAdminError } from './web-admin-auth.js';

export async function webAdminDatabase() {
  try {
    const sqlite = await import('node:sqlite');
    // New runtimes use Database; older supported runtimes use DatabaseSync.
    const Database = sqlite.Database ?? sqlite.DatabaseSync;
    if (typeof Database !== 'function') throw new Error('SQLite constructor unavailable');
    return Database;
  } catch {
    throw new WebAdminError('web_admin_sqlite_unavailable');
  }
}
