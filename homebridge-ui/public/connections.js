// Shared, DOM-free configuration model used by the editor and server validator.
// Device profiles retain their fully resolved settings so commissioning hashes
// and older administrator editors do not depend on catalog IDs or display names.
export const connectionTypes={deconz:'deCONZ',tailwind:'Tailwind',homebridge:'Homebridge accessories'};
const identifier=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(value);
const fail=code=>{throw Error(code);};
export function connectionOrigin(value,{allowBare=false}={}){
  if(typeof value!=='string'||!value.trim()||value.length>512)fail('invalid_connection_address');
  let text=value.trim();if(allowBare&&!/^[a-z][a-z0-9+.-]*:\/\//i.test(text))text='http://'+text;
  let url;try{url=new URL(text);}catch{fail('invalid_connection_address');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')fail('invalid_connection_address');
  return url.origin;
}
export function sameConnection(a,b){
  if(!a||!b||(a.type??'deconz')!==(b.type??'deconz')||a.credentialRef!==b.credentialRef)return false;
  try{return connectionOrigin(a.baseUrl)===connectionOrigin(b.baseUrl);}catch{return false;}
}
export function endpoints(configuration){
  return (configuration.controllers??[]).flatMap(controller=>[
    {controller,connection:controller.door,kind:'opener'},
    {controller,connection:controller.bolt,kind:'bolt'},
    ...(controller.motorPaths??[]).map(path=>({controller,connection:path.connection,kind:'motor'})),
    ...(controller.inputs??[]).map(input=>({controller,connection:input.source,kind:'input'})),
    ...(controller.keypad?[{controller,connection:controller.keypad,kind:'virtual-keypad'}]:[])
  ]).filter(row=>row.connection);
}
export function validateConnections(value=[]){
  if(!Array.isArray(value)||value.length>128)fail('invalid_connections');
  const ids=new Set(),result=[];
  for(const row of value){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['id','name','type','baseUrl','credentialRef','doorCount'].includes(k)))fail('invalid_connection');
    if(!identifier(row.id)||ids.has(row.id))fail('invalid_connection_id');ids.add(row.id);
    if(typeof row.name!=='string'||!row.name.trim()||row.name.length>64||/[\x00-\x1f]/.test(row.name))fail('invalid_connection_name');
    if(!Object.hasOwn(connectionTypes,row.type))fail('invalid_connection_type');
    if(!identifier(row.credentialRef))fail('invalid_secret_reference');
    const item={id:row.id,name:row.name.trim(),type:row.type,baseUrl:connectionOrigin(row.baseUrl),credentialRef:row.credentialRef};
    if(row.type==='tailwind'){
      if(row.doorCount!=null&&(!Number.isInteger(row.doorCount)||row.doorCount<1||row.doorCount>3))fail('invalid_tailwind_door_count');
      item.doorCount=row.doorCount??null;
    }else if(row.doorCount!==undefined)fail('invalid_tailwind_door_count');
    if(result.some(other=>sameConnection(item,other)))fail('duplicate_connection');
    result.push(item);
  }
  return result;
}
export function withConnections(configuration){
  const result=structuredClone(configuration),catalog=validateConnections(result.connections??[]);
  for(const {connection} of endpoints(result)){
    const type=connection.type??'deconz';
    // Incomplete initial drafts, including legacy Homebridge declarations with
    // no usable address, remain editable and are not guessed into a connection.
    if(!Object.hasOwn(connectionTypes,type)||!identifier(connection.credentialRef))continue;
    let baseUrl;try{baseUrl=connectionOrigin(connection.baseUrl);}catch{continue;}
    if(catalog.some(row=>sameConnection(row,connection)))continue;
    let n=1;while(catalog.some(row=>row.id==='connection-'+type+'-'+n))n++;
    catalog.push({id:'connection-'+type+'-'+n,name:connectionTypes[type]+' '+n,type,baseUrl,credentialRef:connection.credentialRef,...(type==='tailwind'?{doorCount:null}:{})});
  }
  result.connections=validateConnections(catalog);
  for(const {connection} of endpoints(result)){
    if(connection.type!=='tailwind')continue;
    const shared=result.connections.find(row=>sameConnection(row,connection));
    if(shared?.doorCount!=null&&connection.doorIndex>=shared.doorCount)fail('tailwind_door_out_of_range');
  }
  return result;
}
export function connectionUsers(configuration,shared){
  return [...new Map(endpoints(configuration).filter(row=>sameConnection(row.connection,shared)).map(row=>[row.controller.id,row.controller])).values()];
}
export function updateConnection(configuration,id,next){
  const old=configuration.connections.find(row=>row.id===id);if(!old)fail('connection_not_found');
  if(next.id!==id||next.type!==old.type)fail('connection_type_changed');
  const checked=validateConnections(configuration.connections.map(row=>row.id===id?next:row));
  // Validate the entire proposed change before touching the caller's draft.
  const draft=structuredClone(configuration);draft.connections=checked;const replacement=checked.find(row=>row.id===id);
  for(const {connection} of endpoints(draft))if(sameConnection(connection,old))Object.assign(connection,{baseUrl:replacement.baseUrl,credentialRef:replacement.credentialRef});
  const result=withConnections(draft);
  configuration.connections=result.connections;configuration.controllers=result.controllers;
}
export function selectConnection(connection,shared){
  if((connection.type??'deconz')!==shared.type)fail('connection_type_changed');
  if(!sameConnection(connection,shared)&&connection.baseUrl&&connection.baseUrl!==shared.baseUrl){
    // Another gateway/bridge requires discovery of its own pinned identities.
    for(const key of ['gatewayId','resourceId','uniqueId','resourceType','modelId','manufacturer','bridgeId','serviceId','accessoryIdentity'])delete connection[key];
  }
  connection.baseUrl=shared.baseUrl;connection.credentialRef=shared.credentialRef;
}
