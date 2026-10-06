import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Fault, requireValue } from './fault.js';

const valid = value => value && Object.keys(value).sort().join() === 'fault,inProgress' &&
  typeof value.inProgress === 'boolean' && typeof value.fault === 'boolean';
const trusted = stat => stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) &&
  (!process.getuid || stat.uid === process.getuid()) && stat.size <= 1024;

// A crash record is a hold, never a request to replay an actuator command.
export class StateJournal {
  constructor(storagePath, controllerId) {
    requireValue(/^[a-z][a-z0-9-]{0,47}$/.test(controllerId), 'journal_invalid');
    this.storagePath = storagePath; this.controllerId = controllerId;
  }

  async directory() {
    const directory = path.join(await realpath(this.storagePath), 'gdoorandbolt-coordinator');
    const meta = await lstat(directory);
    requireValue(meta.isDirectory() && !meta.isSymbolicLink() && !(meta.mode & 0o077) &&
      (!process.getuid || meta.uid === process.getuid()), 'journal_invalid');
    return directory;
  }

  async read() {
    let file;
    try {
      const directory = await this.directory();
      try { file = await open(path.join(directory, this.controllerId + '.state.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if (error.code === 'ENOENT') return { inProgress: false, fault: false }; throw error; }
      requireValue(trusted(await file.stat()), 'journal_invalid');
      const value = JSON.parse(await file.readFile('utf8'));
      requireValue(valid(value), 'journal_invalid');
      return value;
    } catch { throw new Fault('journal_invalid'); }
    finally { await file?.close(); }
  }

  async write(value) {
    requireValue(valid(value), 'journal_invalid');
    let file; let directoryFd; let temporary;
    try {
      const directory = await this.directory();
      const target = path.join(directory, this.controllerId + '.state.json');
      try { requireValue(trusted(await lstat(target)), 'journal_invalid'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      temporary = path.join(directory, '.' + this.controllerId + '-' + randomBytes(12).toString('hex'));
      file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); await file.close(); file = null;
      await rename(temporary, target); temporary = null;
      directoryFd = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directoryFd.sync();
    } catch { throw new Fault('journal_write_failed'); }
    finally {
      await file?.close(); await directoryFd?.close();
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
}
