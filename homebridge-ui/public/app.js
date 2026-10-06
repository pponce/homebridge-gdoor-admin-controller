import { ProfileEditor } from './editor.js';
const hb = window.homebridge;
const $ = id => document.getElementById(id);
let editor, loaded, blocks = [], reviewToken = null, busy = false;
function notice(message, error=false){$('notice').textContent=message;$('notice').dataset.error=String(error);hb?.fixScrollHeight?.();}
async function action(fn){if(busy)return;busy=true;try{await fn();}catch{notice('Could not complete the request. Check the selected devices, required fields and coordinator connection.',true);}finally{busy=false;hb?.fixScrollHeight?.();}}
new ResizeObserver(()=>hb?.fixScrollHeight?.()).observe(document.body);
function changed(){reviewToken=null;$('review').hidden=true;$('save-hint').textContent='Unsaved changes';}
async function load(){
  if(!hb){notice('Open this screen from the coordinator’s Settings in Homebridge.',true);$('review-button').disabled=true;return;}
  hb.hideSchemaForm?.();hb.disableSaveButton?.();
  const theme=await hb.userCurrentLightingMode?.();document.documentElement.dataset.theme=theme==='dark'?'dark':'light';
  blocks=await hb.getPluginConfig(); loaded=await hb.request('/load');
  // Unsaved bootstrap configuration belongs to Homebridge until its first start.
  if(!loaded.connected&&blocks[0]?.controllers)loaded.settings.configuration.controllers=blocks[0].controllers;
  $('admin-setup').hidden=!loaded.adminConnection;if(loaded.adminConnection){$('admin-address').value=loaded.adminConnection.baseUrl;$('admin-identity-file').value=loaded.adminConnection.identityFile;}
  $('connection').textContent=loaded.connected?'Connected':'Initial setup';
  editor=new ProfileEditor($('editor'),{configuration:loaded.settings.configuration,credentials:loaded.credentials,changed,
    discoverHomebridge:body=>hb.request('/homebridge',body),discover:body=>hb.request('/deconz',body),error:message=>notice(message,true)});
  $('save-hint').textContent=loaded.connected?'Changes are saved after review.':'Save the setup, then restart this child bridge.';
  $('review').hidden=true;$('commissioning').hidden=!loaded.connected||!loaded.controllers.length;
  const rows=$('commissioning-rows');rows.replaceChildren();
  for(const row of loaded.controllers){
    const panel=document.createElement('div');panel.className='commission-row';const h=document.createElement('h3');h.textContent=row.name;panel.append(h);
    const result=document.createElement('p');result.className='commission-result';result.setAttribute('role','status');
    const active=row.status.actuationEnabled;result.textContent=active?'Control is enabled.':row.status.held==='maintenance'?'Paused for maintenance.':'Control is disabled until you check and enable this garage.';
    const check=document.createElement('button');check.textContent='Check connections';check.type='button';check.onclick=()=>action(async()=>{const value=await hb.request('/probe',{controller:row.id});const p=value.probe;
      const controls=p.controls??[];const issues=[p.door.error,p.bolt.error,...p.limitations,
        ...controls.filter(row=>row.error).map(row=>row.name+': '+row.error)].filter(Boolean);
      result.textContent=p.compatible?'Connections verified. Door: '+p.door.state+' ('+p.door.feedback+'). Bolt: '+p.bolt.state+' ('+p.bolt.feedback+').'+(controls.length?' Motor relays and physical controls checked: '+controls.length+'.':''):
        'Connection needs attention: '+issues.join(', ');});panel.append(check,result);
    if(!active){const checks=[];for(const text of ['The previous controller and its automatic inputs are stopped.','The door is physically closed, the bolt wiring is checked and the motor relay is released.']){
      const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';label.append(input,document.createTextNode(text));panel.append(label);checks.push(input);}
      const enable=document.createElement('button');enable.type='button';enable.className='primary';enable.textContent='Enable this garage';enable.disabled=true;
      checks.forEach(c=>c.onchange=()=>{enable.disabled=!checks.every(c=>c.checked);});enable.onclick=()=>action(async()=>{
        await hb.request('/commission',{controller:row.id,revision:loaded.settings.revision,previousControllerStopped:true,physicalSetupReviewed:true,recover:true});await load();notice('Garage enabled. You can begin supervised testing.');});panel.append(enable);
    }rows.append(panel);
  }
}
$('reload').onclick=()=>action(async()=>{await load();notice('Saved settings restored.');});
$('review-button').onclick=()=>action(async()=>{
  const configuration=await hb.request('/validate',{configuration:editor.configuration});
  const review=loaded.connected?(await hb.request('/review',{configuration,revision:loaded.settings.revision})).review:{configuration,requiresCommissioning:configuration.controllers.map(p=>p.id)};
  reviewToken=review.token??null;const box=$('review');box.replaceChildren();box.hidden=false;
  const heading=document.createElement('h2');heading.textContent='Review your changes';const summary=document.createElement('p');summary.textContent=review.configuration.controllers.length+' garage(s). '+review.requiresCommissioning.length+' will need connection checks and enabling after saving.';summary.className='subtle';box.append(heading,summary);
  const list=document.createElement('ul');list.className='review-list';for(const p of review.configuration.controllers){const li=document.createElement('li');li.textContent=p.name+' · '+p.door.type+' opener · '+p.bolt.type+' bolt · '+p.inputs.length+' physical controls';list.append(li);}box.append(list);
  const buttons=document.createElement('div');buttons.className='actions';const save=document.createElement('button');save.type='button';save.className='primary';save.textContent='Save reviewed settings';save.onclick=()=>action(async()=>{
    if(loaded.connected){if(!reviewToken)throw Error('review_expired');await hb.request('/apply',{token:reviewToken});}
    else{const block={...(blocks[0]??{}),platform:'GDoorAndBoltCoordinator',name:'Garage Door and Bolt',managementPort:review.configuration.managementPort,controllers:review.configuration.controllers};await hb.updatePluginConfig([block]);await hb.savePluginConfig();}
    await load();notice(loaded.connected?'Settings saved. Changed garages remain disabled until you check and enable them.':'Setup saved. Restart the coordinator child bridge, then reopen these settings.');});
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Keep editing';cancel.onclick=()=>action(async()=>{if(reviewToken)await hb.request('/cancel',{token:reviewToken});reviewToken=null;box.hidden=true;});buttons.append(save,cancel);box.append(buttons);box.scrollIntoView({behavior:'smooth',block:'nearest'});
});
$('credential-form').onsubmit=event=>{event.preventDefault();void action(async()=>{await hb.request('/credentials',{reference:$('credential-reference').value,secret:$('credential-secret').value});$('credential-secret').value='';notice('Connection key saved privately. Your unsaved setup is still here.');});};
void action(load);
