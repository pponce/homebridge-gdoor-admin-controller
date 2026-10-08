import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadIdentity } from '../src/storage.js';
import { acquireOwnership } from '../src/ownership.js';
test('one process owns a storage directory and releasing ownership permits restart',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'coordinator-owner-'));t.after(()=>rm(folder,{recursive:true,force:true}));await loadIdentity(folder);
 const release=await acquireOwnership(folder);await assert.rejects(acquireOwnership(folder),/already_running/);
 const before=await readFile(path.join(folder,'gdoorandbolt-coordinator/owner.json'),'utf8');await assert.rejects(acquireOwnership(folder));assert.equal(await readFile(path.join(folder,'gdoorandbolt-coordinator/owner.json'),'utf8'),before);
 await release();const second=await acquireOwnership(folder);await release();await assert.rejects(acquireOwnership(folder));await second();
});
