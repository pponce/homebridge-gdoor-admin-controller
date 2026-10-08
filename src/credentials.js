import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Fault, requireValue } from './fault.js';

export async function readCredentials(storagePath) {
  let file;
  try {
    const root = await realpath(storagePath);
    const directory = path.join(root, 'gdoorandbolt-coordinator');
    const stat = await lstat(directory);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) &&
      (!process.getuid || stat.uid === process.getuid()), 'credentials_unavailable');
    file = await open(path.join(directory, 'credentials.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const meta = await file.stat();
    requireValue(meta.isFile() && meta.nlink === 1 && !(meta.mode & 0o077) && meta.size <= 16384 &&
      (!process.getuid || meta.uid === process.getuid()), 'credentials_unavailable');
    const raw = await file.readFile('utf8');
    requireValue(Buffer.byteLength(raw) <= 16384, 'credentials_unavailable');
    const value = JSON.parse(raw);
    requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length <= 64 && Object.entries(value).every(([key, secret]) =>
        /^[a-z][a-z0-9-]{0,47}$/.test(key) && typeof secret === 'string' && /^[\x21-\x7e]{1,256}$/.test(secret)),
    'credentials_unavailable');
    return value;
  } catch { throw new Fault('credentials_unavailable'); }
  finally { await file?.close(); }
}
