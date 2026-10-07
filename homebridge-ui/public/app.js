import { ProfileEditor } from './editor.js';
import { ConfigurationSave } from './config-save.js';
const hb=window.homebridge;
const $=id=>document.getElementById(id);
const save=new ConfigurationSave(hb);
let editor, loaded, blocks=[], busy=false, themeChoice;

function notice(message,error=false){$('notice').textContent=message;$('notice').dataset.error=String(error);hb?.fixScrollHeight?.();}
function toast(message,type='success'){hb?.toast?.[type]?.(message);}
function refresh(){
  const clean=save.canClose&&!busy;
  if(clean)hb?.enableSaveButton?.();else hb?.disableSaveButton?.();
  $('workspace').disabled=busy;$('coordinator-ui').setAttribute('aria-busy',String(busy));
  $('editor-fields').disabled=!save.canEdit;
  const labels={loading:['Loading settings','Please wait.'],setup:['Set up your garage door','Review your configuration before saving.'],
    dirty:['Unsaved changes','Review and save your changes to continue.'],review:['Ready to save','Check the summary, then save configuration.'],
    saved:['All changes saved','Use Homebridge’s Save button below to close these settings.'],
    'sync-pending':['Finish saving in Homebridge',save.connected?'Controller settings are saved. Retry the Homebridge save.':'Your reviewed setup is ready. Retry the Homebridge save.'],
    'save-uncertain':['Save needs checking','Reload saved settings before making more changes.']};
  const [title,hint]=labels[save.phase];
  $('save-state').textContent=busy?'Working…':title;$('save-state').dataset.state=save.phase;
  $('save-hint').textContent=hint;
  $('review-button').hidden=['review','sync-pending','save-uncertain'].includes(save.phase);
  if(save.phase!=='review')$('review').hidden=true;
  $('review-button').disabled=save.phase==='saved'||!editor;
  $('retry-save').hidden=save.phase!=='sync-pending';
  $('reload').textContent=save.canEdit?'Discard changes':'Reload saved settings';
  $('reload').disabled=['saved','loading','sync-pending'].includes(save.phase);
  $('commissioning-fields').disabled=save.phase!=='saved';
  $('commissioning-hint').textContent=save.phase==='saved'?'Check connections, then enable the garage door when you are ready. Enabling takes effect immediately.':'Save or discard configuration changes before checking and enabling a garage door.';
}
async function action(fn,errorMessage='Could not complete the request. Check the coordinator connection and try again.'){
  if(busy)return;busy=true;refresh();
  try{await fn();}catch{const message=typeof errorMessage==='function'?errorMessage():errorMessage;notice(message,true);toast(message,'error');}
  finally{busy=false;refresh();hb?.fixScrollHeight?.();}
}
function applyTheme(){
  const body=document.body;
  const dark=body.classList.contains('dark-mode')?true:[...body.classList].some(x=>x.startsWith('config-ui-x-'))?false:
    themeChoice?themeChoice==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme=dark?'dark':'light';
}
applyTheme();new MutationObserver(applyTheme).observe(document.body,{attributes:true,attributeFilter:['class']});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
new ResizeObserver(()=>hb?.fixScrollHeight?.()).observe(document.body);

function changed(){save.changed();$('review').hidden=true;notice('');refresh();}
function buildEditor(configuration,position){
  editor=new ProfileEditor($('editor'),{configuration,credentials:loaded.credentials,changed,
    discoverHomebridge:body=>hb.request('/homebridge',body),discover:body=>hb.request('/deconz',body),error:message=>notice(message,true)});
  if(position){editor.selected=Math.min(position.selected,Math.max(0,configuration.controllers.length-1));editor.step=position.step;editor.render();}
}
function commissioning(){
  $('commissioning').hidden=!loaded.connected||!loaded.controllers.length;
  const rows=$('commissioning-rows');rows.replaceChildren();
  for(const row of loaded.controllers){
    const panel=document.createElement('div');panel.className='commission-row';const h=document.createElement('h3');h.textContent=row.name;panel.append(h);
    const result=document.createElement('p');result.className='commission-result';result.setAttribute('role','status');
    const active=row.status.actuationEnabled;result.textContent=active?'Control is enabled. No additional save is needed.':row.status.held==='maintenance'?'Paused for maintenance.':'Control is disabled until you check and enable this garage door.';
    const check=document.createElement('button');check.textContent='Check connections';check.type='button';check.className='secondary';check.onclick=()=>action(async()=>{const value=await hb.request('/probe',{controller:row.id});const p=value.probe;
      const controls=p.controls??[];const issues=[p.door.error,p.bolt.error,...p.limitations,...controls.filter(r=>r.error).map(r=>r.name+': '+r.error)].filter(Boolean);
      result.textContent=p.compatible?'Connections verified. Door: '+p.door.state+' ('+p.door.feedback+'). Bolt: '+p.bolt.state+' ('+p.bolt.feedback+').'+(controls.length?' Motor relays and physical controls checked: '+controls.length+'.':''):'Connection needs attention: '+issues.join(', ');
    });panel.append(check,result);
    if(!active){const checks=[];for(const text of ['The previous controller and its automatic inputs are stopped.','The door is physically closed, the bolt wiring is checked and the motor relay is released.']){
      const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';label.append(input,document.createTextNode(text));panel.append(label);checks.push(input);}
      const enable=document.createElement('button');enable.type='button';enable.className='primary';enable.textContent='Enable this garage door';enable.disabled=true;
      checks.forEach(c=>c.onchange=()=>{enable.disabled=!checks.every(c=>c.checked);});enable.onclick=()=>action(async()=>{
        await hb.request('/commission',{controller:row.id,revision:loaded.settings.revision,previousControllerStopped:true,physicalSetupReviewed:true,recover:true});
        await load();notice('Garage door enabled. No additional review or save is needed.');toast('Garage door enabled.');
      });panel.append(enable);
    }rows.append(panel);
  }
}
async function load(){
  if(!hb){notice('Open this screen from the coordinator’s Settings in Homebridge.',true);return;}
  hb.hideSchemaForm?.();
  themeChoice=await hb.userCurrentLightingMode?.();applyTheme();
  const position=editor&&{selected:editor.selected,step:editor.step};
  blocks=await hb.getPluginConfig();loaded=await hb.request('/load');
  if(!loaded.connected&&blocks[0]?.controllers)loaded.settings.configuration.controllers=blocks[0].controllers;
  let saved=loaded.connected;
  if(!loaded.connected&&Array.isArray(blocks[0]?.controllers)){
    try{await hb.request('/validate',{configuration:loaded.settings.configuration});saved=true;}catch{/* Incomplete drafts still need review. */}
  }
  // Stage only the already saved managed snapshot in the parent modal. This
  // does not save config.json or apply settings; it keeps the bottom Save in
  // sync after an administrator edit or an uncertain apply response.
  if(loaded.connected)await save.stage(loaded.settings.configuration);
  save.load({...loaded.settings,connected:loaded.connected,saved});
  $('admin-setup').hidden=!loaded.adminConnection;
  if(loaded.adminConnection){$('admin-address').value=loaded.adminConnection.baseUrl;$('admin-identity-file').value=loaded.adminConnection.identityFile;}
  $('connection').textContent=loaded.connected?'Coordinator connected':'Initial setup';
  $('connection').dataset.state=loaded.connected?'connected':'setup';
  buildEditor(loaded.settings.configuration,position);$('review').hidden=true;commissioning();
}
$('reload').onclick=()=>action(async()=>{await load();notice('Saved settings restored.');});
$('review-button').onclick=()=>action(async()=>{
  const invalid=$('editor').querySelector('input:invalid,select:invalid');if(invalid){invalid.reportValidity();return;}
  const review=await save.prepare(editor.configuration);
  const box=$('review');box.replaceChildren();box.hidden=false;
  const heading=document.createElement('h2');heading.textContent='Review configuration';const summary=document.createElement('p');
  const count=review.requiresCommissioning.length;
  summary.textContent=count?count+' garage door'+(count===1?'':'s')+' will need connection checks and enabling after saving.':'Existing enabled garage doors will stay enabled.';summary.className='subtle';box.append(heading,summary);
  const list=document.createElement('ul');list.className='review-list';for(const p of review.configuration.controllers){const li=document.createElement('li');li.textContent=p.name+' · '+p.door.type+' opener · '+p.bolt.type+' bolt · '+p.inputs.length+' physical controls';list.append(li);}box.append(list);
  const buttons=document.createElement('div');buttons.className='actions';const commit=document.createElement('button');commit.type='button';commit.className='primary';commit.textContent='Save configuration';commit.onclick=persist;
  const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Keep editing';cancel.onclick=()=>action(async()=>{await save.cancel();box.hidden=true;});buttons.append(commit,cancel);box.append(buttons);box.scrollIntoView({behavior:'smooth',block:'nearest'});
},'Could not review configuration. Check device addresses (including http://), selected devices and required fields.');
async function persist(){
  return action(async()=>{
    await save.save();
    // Confirm success before refreshing. Failed refresh is not a failed write.
    $('review').hidden=true;
    const connected=save.connected;
    const message=connected?'Configuration saved. Use Homebridge’s Save button below to close these settings.':'Setup saved. Click Homebridge’s Save button below, then restart the coordinator child bridge.';
    notice(message);toast('Configuration saved.');
    try{await load();}catch{notice(message+' Reopen settings to refresh connection status.');}
  },()=>save.phase==='sync-pending'?(save.connected?'Controller settings are saved, but the Homebridge save did not complete. Click Retry Homebridge save.':'The Homebridge save did not complete. Click Retry Homebridge save.'): 'Could not confirm the configuration save. Reload saved settings before trying again.');
}
$('retry-save').onclick=persist;
$('credential-form').onsubmit=event=>{event.preventDefault();void action(async()=>{
  await hb.request('/credentials',{reference:$('credential-reference').value,secret:$('credential-secret').value});$('credential-secret').value='';
  if(!loaded.credentials.includes($('credential-reference').value))loaded.credentials.push($('credential-reference').value);
  editor.credentials=loaded.credentials;editor.render();
  // Key replacement can pause controls; refresh rows without discarding draft.
  try{const value=await hb.request('/load');loaded.controllers=value.controllers;commissioning();}catch{/* Check status on next reload. */}
  notice('Connection key saved privately. Your configuration draft is unchanged.');toast('Connection key saved.');
});};
void action(load);
