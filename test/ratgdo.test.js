import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { RatgdoDoor, digestHeader, ratgdoRequest } from '../src/ratgdo.js';
import { MovementEngine } from '../src/engine.js';
import { validateConfiguration } from '../src/config.js';
import { readFile } from 'node:fs/promises';
const config = { type:'ratgdo-homekit', baseUrl:'http://example.invalid', macAddress:'02:00:00:00:00:01' };
const status = () => ({ macAddress:config.macAddress, garageDoorState:'Closed', garageObstructed:false, garageLockState:'Enabled', passwordRequired:false, upTime:50000 });
function fixture(options={}) {
  const row=status(), calls=[];
  const request=async args=>{calls.push(args); if(args.url.endsWith('/status.json'))return {status:200,text:JSON.stringify(row)};
    if(args.url.endsWith('/auth'))return {status:401,headers:{'www-authenticate':'Digest realm="ratgdo", nonce="synthetic", qop="auth", algorithm=MD5'}};
    return {status:200,text:'<p>Success.</p>'};};
  return {row,calls,driver:new RatgdoDoor(config,JSON.stringify({username:'example',password:'test-only'}),{request,readOnly:false,...options})};
}
test('ratgdo reads identity-pinned endpoints, direction, stopped and actual obstruction without writes',async()=>{
  const f=fixture();
  for(const [state,door] of [['Closed','closed'],['Open','open'],['Opening','opening'],['Closing','closing'],['Stopped','not-closed']]){
    f.row.garageDoorState=state;const sample=await f.driver.read();assert.equal(sample.door,door);assert.equal(sample.lockout,null);
  }
  f.row.garageObstructed=true;assert.equal((await f.driver.read()).obstruction,true);
  f.row.garageLockState='Disabled';assert.equal((await f.driver.read()).blocked,true);
  assert.ok(f.calls.every(c=>!c.method));assert.equal(f.driver.capabilities.directional,false);
});
test('ratgdo rejects unknown state, malformed feedback and wrong identity',async()=>{
  for(const changes of [{garageDoorState:'Unknown'},{garageObstructed:0},{garageLockState:'Unknown'},{macAddress:'02:00:00:00:00:02'},{upTime:null}]){
    const f=fixture();Object.assign(f.row,changes);await assert.rejects(f.driver.read(),/door_response_invalid/);
  }
});
test('ratgdo open/close uses one documented form POST, retains before-write ordering',async()=>{
  for(const [start,command,body] of [['Closed','open','garageDoorState=1'],['Open','close','garageDoorState=0']]){
    const f=fixture();f.row.garageDoorState=start;let gated=false;
    await f.driver.write(command,{beforeWrite:()=>{assert.equal(f.calls.filter(c=>c.method==='POST').length,0);gated=true;}});
    assert.equal(gated,true);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls.at(-1).body,body);
  }
});
test('ratgdo refuses obstruction, remote lock, partial position and read-only writes',async()=>{
  for(const changes of [{garageObstructed:true},{garageLockState:'Disabled'},{garageDoorState:'Stopped'},{garageDoorState:'Opening'}]){
    const f=fixture();Object.assign(f.row,changes);await assert.rejects(f.driver.write('open'));assert.ok(f.calls.every(c=>c.method!=='POST'));
  }
  const f=fixture({readOnly:true});await assert.rejects(f.driver.write('open'),/actuation_disabled/);assert.equal(f.calls.length,0);
});
test('ratgdo authenticates before POST and never retries an uncertain write',async()=>{
  const f=fixture();f.row.passwordRequired=true;await f.driver.write('open');
  assert.match(f.calls.at(-1).headers.Authorization,/^Digest /);assert.ok(!f.calls.at(-1).headers.Authorization.includes('test-only'));
  const g=fixture();const read=g.driver.request;g.driver.request=async args=>{if(args.method==='POST'){g.calls.push(args);throw Error('secret endpoint');}return read(args);};
  await assert.rejects(g.driver.write('open'),/^Fault: door_write_ambiguous$/);assert.equal(g.calls.filter(c=>c.method==='POST').length,1);
});
test('digest response matches MD5 auth formula and rejects unsupported challenge',()=>{
  const header=digestHeader('Digest realm="r", nonce="n", qop="auth", algorithm=MD5',{username:'u',password:'p'},'POST','/setgdo');
  const fields=Object.fromEntries([...header.matchAll(/(\w+)=(?:"([^"]*)"|([^, ]+))/g)].map(m=>[m[1],m[2]??m[3]]));
  const md5=s=>createHash('md5').update(s).digest('hex');
  assert.equal(fields.response,md5(`${md5('u:r:p')}:n:00000001:${fields.cnonce}:auth:${md5('POST:/setgdo')}`));
  assert.throws(()=>digestHeader('Basic realm="r"',{},'POST','/setgdo'));
});
test('scoped ratgdo transport sends form data and does not follow redirects',async t=>{
  const seen=[];const server=http.createServer((req,res)=>{seen.push(req.url);let data='';req.on('data',c=>data+=c);req.on('end',()=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'/other'});res.end();return;}
    assert.equal(req.headers['content-type'],'application/x-www-form-urlencoded');assert.equal(data,'garageDoorState=1');res.end('<p>Success.</p>');
  });});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await ratgdoRequest({url:url+'/setgdo',method:'POST',body:'garageDoorState=1'})).text,'<p>Success.</p>');
  assert.equal((await ratgdoRequest({url:url+'/redirect'})).status,302);assert.deepEqual(seen,['/setgdo','/redirect']);
});

test('ratgdo configuration pins identity and prevents duplicate ownership',async()=>{
  const example=JSON.parse(await readFile(new URL('../examples/development-config.json',import.meta.url)));
  example.controllers[0].door=config;assert.equal(validateConfiguration(example).controllers[0].door.type,'ratgdo-homekit');
  example.controllers[0].door={...config,macAddress:'unknown'};assert.throws(()=>validateConfiguration(example),/invalid_ratgdo_identity/);
});

test('coordinator uses ratgdo feedback and sequences bolt before open and after confirmed close',async()=>{
  const f=fixture();let locked=true,now=0;const writes=[];const original=f.driver.request;
  f.driver.request=async args=>{const reply=await original(args);if(args.method==='POST'){writes.push(args.body);f.row.garageDoorState=args.body.endsWith('=1')?'Open':'Closed';}return reply;};
  const engine=new MovementEngine({door:f.driver,bolt:{read:async()=>({locked,evidence:'relay'}),write:async value=>{writes.push(value?'bolt-lock':'bolt-unlock');locked=value;}},
    journal:{read:async()=>({inProgress:false,fault:false}),write:async()=>{}},clock:{now:()=>now,sleep:async ms=>{now+=ms;}},
    feedback:{opening:'sensor',closing:'sensor',bolt:'relay',allowEstimatedBolting:false},
    timing:{openRetractSettleMs:0,closeRetractSettleMs:0,closedStableMs:0,boltSettleMs:0,pollMs:1}});
  await engine.initialize();assert.deepEqual(writes,[]);
  assert.equal((await engine.execute('open')).phase,'open');
  assert.equal((await engine.execute('close')).phase,'closed');
  assert.deepEqual(writes,['bolt-unlock','garageDoorState=1','garageDoorState=0','bolt-lock']);
});
