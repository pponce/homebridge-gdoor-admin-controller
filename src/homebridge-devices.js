import net from 'node:net';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { requestJson } from './transport.js';
import { Fault, requireValue } from './fault.js';

const short = v => typeof v === 'string' ? v.toUpperCase().replace(/^0+/, '').replace(/-0000-1000-8000-0026BB765291$/, '') : '';
const types = { garage:'41', lock:'45', switch:'49', light:'43', button:'89' };
const clockDefault = { now: () => performance.now(), wall: () => Date.now() };
const characteristic = (s,type) => s.characteristics?.find(c => short(c.type) === type);
function accessoryIdentity(a) {
  const info = a.services?.find(s => short(s.type) === '3E');
  const values = ['20','21','30'].map(t => characteristic(info??{},t)?.value);
  requireValue(values.every(x => typeof x === 'string' && x.length), 'homebridge_identity_unavailable');
  requireValue(values[0] !== 'Garage Door and Bolt Coordinator', 'input_output_feedback_loop');
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
export async function discoverHomebridge(baseUrl, pin, { request = requestJson } = {}) {
  const url = new URL(baseUrl);
  requireValue(url.protocol === 'http:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'homebridge_endpoint_invalid');
  requireValue(typeof pin === 'string' && /^\d{3}-\d{2}-\d{3}$/.test(pin), 'homebridge_credential_invalid');
  let data;
  try { data = await request({ url: url.origin + '/accessories', headers: { Authorization: pin }, maxResponseBytes: 2097152 }); }
  catch { throw new Fault('homebridge_read_failed'); }
  requireValue(Array.isArray(data?.accessories) && data.accessories.length <= 1024, 'homebridge_response_invalid');
  const bridge = data.accessories.find(a => a.aid === 1); const info = bridge?.services?.find(s => short(s.type) === '3E');
  const bridgeId = characteristic(info??{},'30')?.value;
  requireValue(typeof bridgeId === 'string' && bridgeId.length > 0 && bridgeId.length <= 128, 'homebridge_bridge_identity_missing');
  const services=[];
  for (const a of data.accessories) {
    let identity;try { identity=accessoryIdentity(a); } catch { continue; }
    for (const s of a.services??[]) {
      const kind=Object.entries(types).find(([,type])=>short(s.type)===type)?.[0];if(!kind)continue;
      const name=characteristic(s,'23')?.value??characteristic(a.services.find(x=>short(x.type)==='3E')??{},'23')?.value??kind;
      services.push({bridgeId,serviceId:a.aid+'.'+s.iid,accessoryIdentity:identity,kind,name:String(name).slice(0,64),service:s,aid:a.aid});
    }
  }
  return {bridgeId,services};
}
export class HomebridgeService {
  constructor(config, pin, { request=requestJson, readOnly=true }={}) {
    requireValue(typeof config.baseUrl==='string' && /^[1-9][0-9]*\.[1-9][0-9]*$/.test(config.serviceId) &&
      /^[a-f0-9]{64}$/.test(config.accessoryIdentity), 'homebridge_identity_configuration_required');
    this.config=structuredClone(config);this.pin=pin;this.request=request;this.readOnly=readOnly;
  }
  async inspect(kind) {
    const data=await discoverHomebridge(this.config.baseUrl,this.pin,{request:this.request});
    requireValue(data.bridgeId.toLowerCase()===this.config.bridgeId.toLowerCase(),'homebridge_bridge_identity_mismatch');
    const rows=data.services.filter(s=>s.serviceId===this.config.serviceId);
    requireValue(rows.length===1 && rows[0].accessoryIdentity===this.config.accessoryIdentity &&
      (Array.isArray(kind)?kind.includes(rows[0].kind):rows[0].kind===kind),'homebridge_service_identity_mismatch');
    return rows[0];
  }
  async readCharacteristics(kind, wanted) {
    const row=await this.inspect(kind);const selected=wanted.map(type=>characteristic(row.service,type));
    requireValue(selected.every(c=>c && c.perms?.includes('pr')),'homebridge_characteristic_unavailable');
    let data;
    try { data=await this.request({url:this.config.baseUrl+'/characteristics?id='+selected.map(c=>row.aid+'.'+c.iid).join(','),headers:{Authorization:this.pin}}); }
    catch {throw new Fault('homebridge_read_failed');}
    requireValue(Array.isArray(data?.characteristics) && data.characteristics.length===selected.length,'homebridge_response_invalid');
    return selected.map(c=>{const found=data.characteristics.filter(v=>v.aid===row.aid && v.iid===c.iid);requireValue(found.length===1 && (found[0].status===undefined||found[0].status===0) && Object.hasOwn(found[0],'value'),'homebridge_state_unavailable');return found[0].value;});
  }
  async writeCharacteristic(kind,type,value) {
    requireValue(!this.readOnly,'actuation_disabled');const row=await this.inspect(kind);const c=characteristic(row.service,type);
    requireValue(c?.perms?.includes('pw'),'homebridge_characteristic_unavailable');
    let result;try{result=await this.request({url:this.config.baseUrl+'/characteristics',method:'PUT',headers:{Authorization:this.pin},
      body:{characteristics:[{aid:row.aid,iid:c.iid,value}]},allowEmpty:true});}catch{throw new Fault('homebridge_write_ambiguous');}
    requireValue(result===null || Array.isArray(result?.characteristics) && result.characteristics.length===1 &&
      result.characteristics[0].aid===row.aid && result.characteristics[0].iid===c.iid && result.characteristics[0].status===0,'homebridge_write_unconfirmed');
  }
}
export class HomebridgeDoor extends HomebridgeService {
  constructor(config,pin,options={}){super(config,pin,options);this.feedback=options.feedback;}
  async read(){const [current,obstruction]=await this.readCharacteristics('garage',['E','24']);
    requireValue(Number.isInteger(current)&&current>=0&&current<=4&&typeof obstruction==='boolean','homebridge_response_invalid');
    requireValue(current!==4,'door_position_requires_review');
    return {door:current===0?(this.feedback.opening==='sensor'?'open':'not-closed'):current===1?'closed':current===2?'opening':'closing',
      evidence:this.feedback.closing==='sensor'?'closed-sensor':'command',obstruction,blocked:false};}
  async write(command){requireValue(['open','close'].includes(command),'door_command_invalid');await this.read();return this.writeCharacteristic('garage','32',command==='open'?0:1);}
}
export class HomebridgeBolt extends HomebridgeService {
  constructor(config,pin,options={}){super(config,pin,options);this.feedback=options.feedback??'relay';}
  async read(){const kind=this.config.serviceType;const [v]=await this.readCharacteristics(kind,[kind==='lock'?'1D':'25']);
    requireValue(kind==='lock'?v===0||v===1:typeof v==='boolean','homebridge_bolt_state_unknown');
    return {locked:kind==='lock'?v===1:v===this.config.lockedValue,evidence:kind==='lock'?this.feedback:'relay'};}
  async write(locked){requireValue(typeof locked==='boolean','bolt_command_invalid');await this.read();const k=this.config.serviceType;
    return this.writeCharacteristic(k,k==='lock'?'1E':'25',k==='lock'?(locked?1:0):(locked?this.config.lockedValue:!this.config.lockedValue));}
}
export class HomebridgeMotorRelay extends HomebridgeService {
  constructor(config,pin,options){super(config,pin,options);this.capabilities={inactiveWriteIdempotent:true};}
  async read(){const [v]=await this.readCharacteristics(['switch','light'],['25']);requireValue(typeof v==='boolean','motor_relay_state_unknown');return {active:v===this.config.activeValue};}
  async write(active){requireValue(typeof active==='boolean','motor_command_invalid');await this.read();return this.writeCharacteristic(['switch','light'],'25',active?this.config.activeValue:!this.config.activeValue);}
}

// HAP insecure-mode event transport to one explicitly selected Homebridge. No
// pairing, network discovery, redirects or automatic retries of actuator writes.
export class HapSubscription extends EventEmitter {
  constructor(baseUrl,pin,aid,iid){super();this.url=new URL(baseUrl);this.pin=pin;this.aid=aid;this.iid=iid;this.buffer=Buffer.alloc(0);this.ready=false;}
  start(){
    const socket=net.createConnection({host:this.url.hostname,port:Number(this.url.port||80)});this.socket=socket;
    const timeout=setTimeout(()=>socket.destroy(),5000);
    socket.on('connect',()=>{const body=JSON.stringify({characteristics:[{aid:this.aid,iid:this.iid,ev:true}]});
      socket.write('PUT /characteristics HTTP/1.1\r\nHost: '+this.url.host+'\r\nAuthorization: '+this.pin+'\r\nContent-Type: application/hap+json\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: keep-alive\r\n\r\n'+body);});
    socket.on('data',chunk=>{try{
      if (!this.frameTimer) this.frameTimer = setTimeout(() => socket.destroy(), 1000);
      this.buffer=Buffer.concat([this.buffer,chunk]);requireValue(this.buffer.length<=262144,'homebridge_event_invalid');
      while(true){const split=this.buffer.indexOf('\r\n\r\n');if(split<0){requireValue(this.buffer.length<=8192,'homebridge_event_invalid');break;}
        const header=this.buffer.subarray(0,split).toString('latin1');const lengths=[...header.matchAll(/(?:^|\r\n)Content-Length:\s*(\d+)/gi)];
        requireValue(lengths.length<=1&&!/Transfer-Encoding:/i.test(header),'homebridge_event_invalid');const length=lengths.length?Number(lengths[0][1]):0;
        requireValue(length<=131072,'homebridge_event_invalid');if(this.buffer.length<split+4+length)break;
        const body=this.buffer.subarray(split+4,split+4+length);this.buffer=this.buffer.subarray(split+4+length);
        if(!this.ready){requireValue(/^HTTP\/1\.1 (200|204)\b/.test(header),'homebridge_subscription_rejected');
          if(body.length){const ack=JSON.parse(body);requireValue(ack.characteristics?.length===1&&ack.characteristics[0].status===0&&ack.characteristics[0].aid===this.aid&&ack.characteristics[0].iid===this.iid,'homebridge_subscription_rejected');}
          this.ready=true;clearTimeout(timeout);this.emit('ready');
        }else{requireValue(/^EVENT\/1\.0 200\b/.test(header)&&body.length>0,'homebridge_event_invalid');const event=JSON.parse(body);
          requireValue(Array.isArray(event.characteristics)&&event.characteristics.length<=128,'homebridge_event_invalid');
          for(const c of event.characteristics)if(c.aid===this.aid&&c.iid===this.iid){requireValue(c.status===undefined||c.status===0,'homebridge_event_invalid');this.emit('value',c.value);}}
      }
      if (!this.buffer.length) { clearTimeout(this.frameTimer); this.frameTimer = null; }
    }catch{socket.destroy();}});
    socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(timeout);clearTimeout(this.frameTimer);this.frameTimer=null;this.ready=false;this.emit('closed');});
  }
  stop(){this.socket?.destroy();}
}
export class HomebridgeInput extends HomebridgeService {
  async inspect(){const row=await super.inspect(this.config.kind);const c=characteristic(row.service,this.config.kind==='button'?'73':'25');
    requireValue(c?.perms?.includes('ev'),'homebridge_events_unavailable');return {row,characteristic:c,value:c.value};}
  subscription(inspected){return new HapSubscription(this.config.baseUrl,this.pin,inspected.row.aid,inspected.characteristic.iid);}
}
export class HomebridgeInputListener {
  constructor({profile,driver,router,clock=clockDefault,onState=()=>{}}){Object.assign(this,{profile,driver,router,clock,onState});this.running=false;this.sequence=0;this.generation=0;}
  context(){const c=this.router.context(this.profile.id);return JSON.stringify([c.epoch,c.eligible,c.mode]);}
  invalidate(){this.armed=false;this.router.disconnect(this.profile.id);}
  start(){if(this.running)return;this.running=true;this.timer=setInterval(()=>void this.tick(),100);this.timer.unref?.();void this.tick();}
  stop(){this.running=false;this.generation++;clearInterval(this.timer);this.stream?.stop();this.stream=null;this.invalidate();this.onState('stopped');}
  async tick(){if(!this.running||this.checking||this.handling)return;this.checking=true;const generation=this.generation;
    try{
      if(!this.stream){if(this.clock.now()<(this.retryAt??0))return;const inspected=await this.driver.inspect();if(!this.running||generation!==this.generation)return;
        const stream=this.driver.subscription(inspected);this.stream=stream;this.session=randomUUID();this.sequence=0;this.invalidate();
        stream.on('ready',()=>{if(this.stream===stream){this.contextKey=null;this.onState('rearming');}});
        stream.on('closed',()=>{if(this.stream===stream){this.stream=null;this.generation++;this.retryAt=this.clock.now()+2000;this.invalidate();this.onState('waiting-for-device');}});
        stream.on('value',value=>{if(this.stream===stream)void this.message(value);});stream.start();return;
      }
      if(!this.stream.ready)return;const key=this.context();if(key!==this.contextKey){this.contextKey=key;this.invalidate();}
      if(!this.armed||this.clock.now()>=this.verifyAt){const sequence=this.sequence;const snapshot=await this.driver.inspect();
        if(!this.running||generation!==this.generation||key!==this.context())return;this.verifyAt=this.clock.now()+5000;
        if(!this.armed&&sequence===this.sequence&&this.router.context(this.profile.id).eligible){this.router.arm(this.profile.id,{session:this.session,sequence:this.sequence,value:snapshot.value});this.armed=true;this.onState('ready');}}
    }catch{const stream=this.stream;this.stream=null;stream?.stop();this.generation++;this.retryAt=this.clock.now()+2000;this.invalidate();this.onState('waiting-for-device');}
    finally{this.checking=false;}}
  async message(value){const sequence=++this.sequence;const receivedAt=this.clock.now();if(!this.running||!this.armed||this.checking||this.handling||this.contextKey!==this.context())return;
    this.handling=true;const generation=this.generation;const receipt=this.router.capture(this.profile.id);
    try{await this.driver.inspect();if(!this.running||generation!==this.generation)return;
      this.router.offer(this.profile.id,{value,sequence,receivedAt,session:this.session,epoch:receipt.epoch,snapshot:false},receipt).catch(()=>this.onState('operation-held'));
    }catch{this.invalidate();this.onState('waiting-for-device');}finally{this.handling=false;}}
}
