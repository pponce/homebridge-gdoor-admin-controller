import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Fault, requireValue } from './fault.js';

// Homebridge-owned private, atomic, durable JSON storage. A malformed or shared
// file is held for review, never silently replaced by an empty configuration.
export class PrivateStore {
  constructor(storagePath, name, validate) {
    requireValue(/^[a-z][a-z0-9-]*\.json$/.test(name), 'storage_name_invalid');
    this.storagePath = storagePath; this.name = name; this.validate = validate;
  }
  async directory() {
    const directory = path.join(await realpath(this.storagePath), 'gdoorandbolt-coordinator');
    const m = await lstat(directory);
    requireValue(m.isDirectory() && !m.isSymbolicLink() && !(m.mode & 0o077) && (!process.getuid || m.uid === process.getuid()), 'private_storage_invalid');
    return directory;
  }
  trusted(m) { return m.isFile() && m.nlink === 1 && !(m.mode & 0o077) && m.size <= 524288 && (!process.getuid || m.uid === process.getuid()); }
  async read() {
    let f;
    try {
      const dir = await this.directory();
      try { f = await open(path.join(dir, this.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      requireValue(this.trusted(await f.stat()), 'private_storage_invalid');
      const raw = await f.readFile('utf8'); requireValue(Buffer.byteLength(raw) <= 524288, 'private_storage_invalid');
      const value = JSON.parse(raw); requireValue(this.validate(value), 'private_storage_invalid'); return value;
    } catch { throw new Fault('private_storage_invalid'); } finally { await f?.close(); }
  }
  async write(value) {
    requireValue(this.validate(value), 'private_storage_invalid');
    const raw = JSON.stringify(value) + '\n'; requireValue(Buffer.byteLength(raw) <= 524288, 'private_storage_too_large');
    let file, temp, folder;
    try {
      const dir = await this.directory(); const target = path.join(dir, this.name);
      try { requireValue(this.trusted(await lstat(target)), 'private_storage_invalid'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      temp = path.join(dir, '.' + this.name + '-' + randomBytes(12).toString('hex'));
      file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await file.writeFile(raw); await file.sync(); await file.close(); file = null;
      await rename(temp, target); temp = null;
      folder = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); await folder.sync();
    } catch { throw new Fault('private_storage_write_failed'); }
    finally { await file?.close(); await folder?.close(); if (temp) await unlink(temp).catch(() => {}); }
  }
}
