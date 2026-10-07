import { ProfileEditor } from './editor.js';
import { ConfigurationSave } from './config-save.js';
const hb=window.homebridge;
const $=id=>document.getElementById(id);
const save=new ConfigurationSave(hb);
let editor, loaded, blocks=[], busy=false, themeChoice, currentPage='general';
const connectionChecks=new Map();

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
  if($('commissioning-fields'))$('commissioning-fields').disabled=save.phase!=='saved'||!loaded?.connected;
  if($('commissioning-hint'))$('commissioning-hint').textContent=save.phase==='saved'?'Check connections, then enable this garage door when you are ready. Enabling takes effect immediately.':'Save or discard configuration changes before checking and enabling this garage door.';
  editor?.refreshCards();garageOverview();
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
  editor=null;
  editor=new ProfileEditor($('editor'),{configuration,credentials:loaded.credentials,changed,
    discoverHomebridge:body=>hb.request('/homebridge',body),discover:body=>hb.request('/deconz',body),error:message=>notice(message,true),
    renderCheckEnable:commissioning,viewChanged:refresh,getStatus:garageStatus,cardAction:garageAction});
  if(position){editor.selected=Math.min(position.selected,Math.max(0,configuration.controllers.length-1));editor.step=position.step;editor.render();}
}
function commissioning(root,profile){
  const section=document.createElement('section');section.id='commissioning';section.className='device-block';
  const heading=document.createElement('h2');heading.textContent='Check & Enable';
  const hint=document.createElement('p');hint.id='commissioning-hint';hint.className='subtle';
  const fields=document.createElement('fieldset');fields.id='commissioning-fields';section.append(heading,hint,fields);root.append(section);
  const row=loaded.controllers.find(row=>row.id===profile.id);
  if(!loaded.connected||!row){const message=document.createElement('p');message.className='help';
    message.textContent=loaded.connected?'Save this garage door before checking its connections.':'Save your setup and restart the coordinator child bridge to check and enable this garage door.';
    fields.append(message);return;}
  {
    const panel=document.createElement('div');panel.className='commission-row';const h=document.createElement('h3');h.textContent=row.name;panel.append(h);
    const result=document.createElement('p');result.className='commission-result';result.setAttribute('role','status');
    const active=row.status.actuationEnabled;result.textContent=active?'Control is enabled. No additional save is needed.':row.status.held==='maintenance'?'Paused for maintenance.':'Control is disabled until you check and enable this garage door.';
    const check=document.createElement('button');check.textContent='Check connections';check.type='button';check.className='secondary';check.onclick=()=>action(async()=>{const value=await hb.request('/probe',{controller:row.id});const p=value.probe;connectionChecks.set(row.id,p.compatible);
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
    }fields.append(panel);
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
  $('admin-connection-details').hidden=!loaded.adminConnection;
  $('admin-unavailable').hidden=!!loaded.adminConnection;
  if(loaded.adminConnection){$('admin-address').value=loaded.adminConnection.baseUrl;$('admin-identity-file').value=loaded.adminConnection.identityFile;}
  $('connection').textContent=loaded.connected?'Coordinator connected':'Initial setup';
  $('connection').dataset.state=loaded.connected?'connected':'setup';
  buildEditor(loaded.settings.configuration,position);$('review').hidden=true;connectionKeys();showPage(currentPage);
}
$('reload').onclick=()=>action(async()=>{await load();notice('Saved settings restored.');});
$('review-button').onclick=()=>action(async()=>{
  const invalid=$('editor').querySelector('input:invalid,select:invalid');if(invalid){showPage('garages');invalid.reportValidity();return;}
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
    try{connectionChecks.clear();await load();}catch{notice(message+' Reopen settings to refresh connection status.');}
  },()=>save.phase==='sync-pending'?(save.connected?'Controller settings are saved, but the Homebridge save did not complete. Click Retry Homebridge save.':'The Homebridge save did not complete. Click Retry Homebridge save.'): 'Could not confirm the configuration save. Reload saved settings before trying again.');
}
$('retry-save').onclick=persist;
$('credential-form').onsubmit=event=>{event.preventDefault();void action(async()=>{
  await hb.request('/credentials',{reference:$('credential-reference').value,secret:$('credential-secret').value});$('credential-secret').value='';
  if(!loaded.credentials.includes($('credential-reference').value))loaded.credentials.push($('credential-reference').value);
  resetKeyForm();connectionKeys();
  editor.credentials=loaded.credentials;editor.render();
  // Key replacement can pause controls; refresh rows without discarding draft.
  try{const value=await hb.request('/load');loaded.controllers=value.controllers;if(editor.step===3)editor.render();}catch{/* Check status on next reload. */}
  notice('Connection key saved privately. Your configuration draft is unchanged.');toast('Connection key saved.');
});};
function showPage(page){
  currentPage=page;
  for(const name of ['general','garages']){
    $(name+'-page').hidden=page!==name;
    if(page===name)$(name+'-tab').setAttribute('aria-current','page');else $(name+'-tab').removeAttribute('aria-current');
  }
  hb?.fixScrollHeight?.();
}
function garageStatus(profile){
  const row=loaded?.controllers.find(row=>row.id===profile.id),status=row?.status;
  const warning=(label,detail='')=>({tone:'attention',label,detail,action:'Review setup',disabled:!save.canEdit});
  if(save.phase!=='saved')return warning('Unsaved changes','Save configuration before changing enablement.');
  if(!loaded.connected)return warning('Setup needed','Start the coordinator child bridge to check connections.');
  if(!status)return warning('Setup needed');
  if(status.held==='maintenance')return warning('Maintenance paused');
  if(status.state?.fault||status.state?.unavailable||status.state?.obstruction||connectionChecks.get(profile.id)===false||
    status.held&&!['not-commissioned'].includes(status.held))return warning('Needs attention');
  return status.actuationEnabled?{tone:'enabled',label:'Enabled',action:'Disable',disabled:!!status.state?.busy||!save.canEdit,
    detail:status.state?.busy?'An operation is active. Wait for it to finish before disabling.':''}:
    {tone:'disabled',label:'Disabled',action:'Enable',disabled:!save.canEdit};
}
function openChecks(profile){
  editor.selected=editor.configuration.controllers.findIndex(p=>p.id===profile.id);editor.step=3;editor.render();showPage('garages');
}
function garageAction(profile,state){
  if(state.action!=='Disable'){openChecks(profile);return;}
  void action(async()=>{
    const row=loaded.controllers.find(row=>row.id===profile.id);
    await hb.request('/disable',{controller:profile.id,revision:loaded.settings.revision,bootId:row.status.bootId});
    await load();notice('Garage door control disabled. No additional save is needed.');toast('Garage door control disabled.');
  },'Could not disable this garage door. Wait until operations finish, then reload settings and try again.');
}
function garageOverview(){
  const list=$('garage-overview');if(!editor||!loaded||!list)return;list.replaceChildren();
  for(const profile of editor.configuration.controllers){
    const state=garageStatus(profile);
    const item=document.createElement('div');item.className='overview-row';item.dataset.state=state.tone;
    const details=document.createElement('div');const name=document.createElement('h3');name.textContent=profile.name;
    const status=document.createElement('p');status.className='garage-status';status.textContent=state.label;
    details.append(name,status);
    if(state.detail){const hint=document.createElement('p');hint.className='help';hint.textContent=state.detail;details.append(hint);}
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=state.action;button.setAttribute('aria-label',state.action+' '+profile.name);
    button.disabled=state.disabled;button.onclick=()=>garageAction(profile,state);
    const controls=document.createElement('div');controls.className='actions';
    const settings=document.createElement('button');settings.type='button';settings.className='secondary';settings.textContent='Checks';settings.setAttribute('aria-label','Check & Enable '+profile.name);settings.disabled=!save.canEdit;settings.onclick=()=>openChecks(profile);
    controls.append(button,settings);item.append(details,controls);list.append(item);
  }
  $('no-garages').hidden=editor.configuration.controllers.length>0;
}
function resetKeyForm(){
  $('credential-reference').value='';$('credential-reference').readOnly=false;$('credential-secret').value='';
  $('credential-save').textContent='Save connection key';$('credential-cancel').hidden=true;
}
function connectionKeys(){
  const list=$('saved-keys');list.replaceChildren();$('no-keys').hidden=loaded.credentials.length>0;
  for(const name of [...loaded.credentials].sort()){
    const row=document.createElement('div');row.className='saved-key';
    const label=document.createElement('strong');label.textContent=name;
    const mask=document.createElement('span');mask.className='key-mask';mask.textContent='••••••••';mask.setAttribute('aria-label','Value hidden');
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Replace key';button.setAttribute('aria-label','Replace key '+name);
    button.onclick=()=>{$('credential-reference').value=name;$('credential-reference').readOnly=true;$('credential-secret').value='';$('credential-save').textContent='Replace connection key';$('credential-cancel').hidden=false;$('credential-secret').focus();};
    row.append(label,mask,button);list.append(row);
  }
}
$('general-tab').onclick=()=>showPage('general');$('garages-tab').onclick=()=>showPage('garages');
$('configure-garages').onclick=()=>showPage('garages');$('credential-cancel').onclick=resetKeyForm;
void action(load);
