// Explicit export allowlist: never serialize raw configuration, inventory,
// errors, credential references, PINs, identities or network addresses.
import { faultCode } from './controller-faults.js';
const list=(value,max=200)=>Array.isArray(value)?value.slice(0,max):[];
const one=(value,allowed)=>allowed.includes(value)?value:null;
const num=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const bool=value=>typeof value==='boolean'?value:null;
const scalar=value=>typeof value==='boolean'||Number.isInteger(value)&&value>=0&&value<=4?value:null;
const version=value=>typeof value==='string'&&/^\d[0-9A-Za-z.+-]{0,63}$/.test(value)?value:null;
const client=value=>typeof value==='string'&&/^connection-[0-9]{1,5}$/.test(value)?value:null;
const field=value=>one(value,['doorCurrent','doorTarget','boltCurrent','boltTarget','obstruction','tailwindLockout','tailwindRestart']);
const stamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function debugReport({identity,controllers,reporting,activity},now=new Date()) {
  if(reporting?.schema!==1||typeof reporting.recording!=='boolean')throw Error('diagnostics_unavailable');
  const rows=list(controllers,32),labels=new Map(rows.map((r,i)=>[r.id,'Garage '+(i+1)]));
  if(rows.some(r=>r.status?.bootId&&reporting.bootId&&r.status.bootId!==reporting.bootId))throw Error('diagnostics_restarted');
  const garage=id=>labels.get(id)??null;
  const subscriber=v=>({id:client(v?.id),paired:bool(v?.paired)});
  const boundItem=(v,queued=false)=>({garage:garage(v.controllerId),field:field(v.field),...(queued?{value:scalar(v.value)}:{})});
  return {schema:1,capturedAt:now.toISOString(),
    versions:{plugin:version(identity?.pluginVersion),homebridge:version(reporting.homebridgeVersion),hap:version(reporting.hapVersion)},
    recording:reporting.recording,traceMode:one(reporting.traceMode,['full','events','subscribers','off']),
    publicationMode:one(reporting.publicationMode,['inline','deferred']),
    connectionInspection:one(reporting.connectionInspection,['available','unavailable']),truncated:bool(reporting.truncated),
    controllers:rows.map(r=>{const s=r.status??{},v=s.state??{};return {garage:garage(r.id),enabled:bool(s.enabled??s.actuationEnabled),actuationAvailable:bool(s.actuationEnabled),configurationValid:bool(s.configurationValid??s.commissioned),commissioned:bool(s.commissioned),
      held:!!s.held,phase:one(v.phase,['starting','position-unknown','stopped-estimated','unavailable','not-commissioned','closed','open','opening','closing','unknown','fault','stopped','unlocking','locking']),
      door:one(v.door,['closed','open','opening','closing','not-closed','unknown']),bolt:one(v.bolt,['locked','unlocked','locking','unlocking','unknown']),
      target:one(v.target,['closed','open']),busy:bool(v.busy),fault:!!v.fault,unavailable:!!v.unavailable,obstruction:bool(v.obstruction),
      heldReason:faultCode(s.held)??one(s.held,['waiting-for-devices','checking-devices','maintenance','not-commissioned']),
      faultReason:faultCode(v.fault),faultAt:stamp(v.faultAt),unavailableReason:faultCode(v.unavailable),reconciling:!!v.reconciling,
      previousFaultReason:faultCode(s.lastFault?.reason),previousFaultAt:stamp(s.lastFault?.at),
      openEstimated:bool(v.openEstimated),closeEstimated:bool(v.closeEstimated),externalUnlockOverride:bool(v.externalUnlockOverride)};}),
    tiles:list(reporting.tiles,64).filter(t=>garage(t.controllerId)).map(t=>({garage:garage(t.controllerId),kind:one(t.kind,['garage','bolt','lockout','restart']),available:bool(t.available),
      fields:list(t.fields,5).filter(v=>field(v.field)).map(v=>({field:field(v.field),reported:scalar(v.reported),cached:scalar(v.cached),status:num(v.status),supportsEvents:bool(v.supportsEvents),subscribers:list(v.subscribers,32).map(client).filter(Boolean)}))})),
    clients:list(reporting.clients,32).map(c=>({...subscriber(c),requestInProgress:bool(c.requestInProgress),writtenBytes:num(c.writtenBytes),socketWritable:bool(c.socketWritable),
      subscriptions:list(c.subscriptions,160).filter(v=>garage(v.controllerId)&&field(v.field)).map(v=>boundItem(v)),
      queued:list(c.queued,20).filter(v=>garage(v.controllerId)&&field(v.field)).map(v=>boundItem(v,true))})),
    events:list(reporting.events).filter(e=>garage(e.controllerId)&&field(e.field)).map(e=>({garage:garage(e.controllerId),sequence:num(e.sequence),at:num(e.at),monotonicMs:num(e.monotonicMs),
      kind:one(e.kind,['publish','get','get-error']),field:field(e.field),value:scalar(e.value),explicit:bool(e.explicit),client:subscriber(e.client),
      subscribers:Array.isArray(e.subscribers)?list(e.subscribers,32).map(subscriber):null})),
    activity:list(activity).filter(e=>e.controllerId===null||garage(e.controllerId)).map(e=>({garage:garage(e.controllerId),at:stamp(e.at),
      type:one(e.type,['restart-review-required','restart-observation','settings-applied','timings-applied','credentials-change-review','controller-disabled','controller-enabled','recovery-check','state-checked','tailwind-restart-requested','fault-recorded','recovery-confirmed','commissioned','held','unknown','complete','command-held','maintenance-completed']),
      command:one(e.detail,['open','close','toggle','lock','unlock'])}))};
}
