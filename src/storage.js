import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ownerMatches = (stat) => !process.getuid || stat.uid === process.getuid();
export async function loadIdentity(homebridgeStoragePath) {
  const root = await realpath(homebridgeStoragePath);
  const directory = path.join(root, 'gdoorandbolt-coordinator');
  await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || !ownerMatches(directoryStat) || (directoryStat.mode & 0o077)) throw new Error('untrusted_storage_directory');
  const filename = path.join(directory, 'identity.json');
  let writer;
  try {
    writer = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const value = { schema: 1, instanceId: randomUUID(), token: randomBytes(32).toString('hex') };
    await writer.writeFile(JSON.stringify(value) + '\n');
    await writer.sync();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally { await writer?.close(); }
  // Interrupted creation stays invalid and requires review; never rotate silently.
  const reader = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await reader.stat();
    if (!stat.isFile() || stat.nlink !== 1 || !ownerMatches(stat) || (stat.mode & 0o077) || stat.size > 1024) throw new Error('untrusted_identity_file');
    const value = JSON.parse(await reader.readFile('utf8'));
    if (Object.keys(value).sort().join(',') !== 'instanceId,schema,token' || value.schema !== 1 || !UUID.test(value.instanceId) || !/^[0-9a-f]{64}$/.test(value.token)) throw new Error('invalid_identity_file');
    return value;
  } finally { await reader.close(); }
}
