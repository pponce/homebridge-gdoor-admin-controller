import { ConnectionEditor } from './connection-editor.js';
import { withConnections } from './connections.js';
import { ProfileEditor } from './editor.js';
import { ConfigurationSave, sameConfiguration } from './config-save.js';
const hb=window.homebridge;
const $=id=>document.getElementById(id);
const save=new ConfigurationSave(hb);
let editor, connectionEditor, loaded, blocks=[], busy=false, themeChoice, currentPage='general';
const connectionChecks=new Map();
const checkForms=new Map();let deletingKey=null;

function notice(message,error=false){$('notice').textContent=message;$('notice').dataset.error=String(error);hb?.fixScrollHeight?.();}
function toast(message,type='success'){hb?.toast?.[type]?.(message);}
function refresh(){
  const formDirty=!!connectionEditor?.dirty;
  const clean=save.canClose&&!busy&&!formDirty;
  if(clean)hb?.enableSaveButton?.();else hb?.disableSaveButton?.();
  $('workspace').disabled=busy;$('coordinator-ui').setAttribute('aria-busy',String(busy));
  $('editor-fields').disabled=!save.canEdit;if(connectionEditor)connectionEditor.fields.disabled=!save.canEdit;
  const labels={loading:['Loading settings','Please wait.'],setup:['Set up your garage door','Review your configuration before saving.'],
    dirty:['Unsaved changes','Review and save your changes to continue.'],review:['Ready to save','Check the summary, then save configuration.'],
    saved:['All changes saved','Use Homebridge’s Save button below to close these settings.'],
    'sync-pending':['Finish saving in Homebridge',save.connected?'Controller settings are saved. Retry the Homebridge save.':'Your reviewed setup is ready. Retry the Homebridge save.'],
    'save-uncertain':['Save needs checking','Reload saved settings before making more changes.']};
  const [title,hint]=labels[save.phase];
  $('save-state').textContent=busy?'Working…':title;$('save-state').dataset.state=save.phase;
  $('save-hint').textContent=formDirty?'Click Add connection or Update connection, or cancel the connection edit.':hint;
  if(formDirty&&!busy)$('save-state').textContent='Finish the connection form';
  $('review-button').hidden=['review','sync-pending','save-uncertain'].includes(save.phase);
  if(save.phase!=='review')$('review').hidden=true;
  $('review-button').disabled=save.phase==='saved'||!editor||formDirty;
  $('retry-save').hidden=save.phase!=='sync-pending';
  $('reload').textContent=save.canEdit?'Discard changes':'Reload saved settings';
  $('reload').disabled=['loading','sync-pending'].includes(save.phase)||save.phase==='saved'&&!formDirty;
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

function changed(configuration){
  save.changed(configuration);$('review').hidden=true;notice('');
  for(const [id,form] of checkForms){const profile=configuration.controllers.find(p=>p.id===id);if(!sameConfiguration(profile,form.profile)){checkForms.delete(id);connectionChecks.delete(id);}}
  refresh();
}
function buildEditor(configuration,position){
  editor=null;connectionEditor=null;
  editor=new ProfileEditor($('editor'),{configuration,credentials:loaded.credentials,changed,
    discoverHomebridge:body=>hb.request('/homebridge',body),discover:body=>hb.request('/deconz',body),error:message=>notice(message,true),
    renderCheckEnable:commissioning,viewChanged:refresh,getStatus:garageStatus,cardAction:garageAction,manageConnections:type=>{showPage('general');connectionEditor?.focus(type);}});
  if(position){editor.selected=Math.min(position.selected,Math.max(0,configuration.controllers.length-1));editor.step=position.step;editor.expandedGarage=position.expandedGarage;editor.render();}
  connectionEditor=new ConnectionEditor($('shared-connections'),{configuration:()=>editor.configuration,credentials:()=>loaded.credentials,
    request:(path,body)=>hb.request(path,body),run:action,changed:configuration=>{changed(configuration);editor.render();},refresh:()=>{if(connectionEditor?.dirty&&save.phase==='review')save.changed(editor.configuration);refresh();},message:notice,
    keyCreated:reference=>{if(!loaded.credentials.includes(reference))loaded.credentials.push(reference);editor.credentials=loaded.credentials;connectionKeys();}});

}
function commissioning(root,profile){
  const section=document.createElement('section');section.className='card-checks';section.setAttribute('aria-label','Checks for '+profile.name);
  const hint=document.createElement('p');hint.className='help';
  const fields=document.createElement('fieldset');fields.disabled=save.phase!=='saved'||!!connectionEditor?.dirty||!loaded?.connected;
  section.append(hint,fields);root.append(section);
  const row=loaded.controllers.find(row=>row.id===profile.id);
  hint.textContent=save.phase==='saved'&&!connectionEditor?.dirty?'Check connections here. Enabling takes effect immediately.':'Save or discard configuration changes before checking or changing enablement.';
  if(!loaded.connected||!row){const message=document.createElement('p');message.className='help';
    message.textContent=loaded.connected?'Save this garage door before checking its connections.':'Save your setup and restart the coordinator child bridge to check and enable this garage door.';
    fields.append(message);return;}
  let form=checkForms.get(profile.id);
  if(!form||!sameConfiguration(form.profile,profile)){form={profile:structuredClone(profile),ack:[false,false],result:''};checkForms.set(profile.id,form);}
  const panel=document.createElement('div');panel.className='commission-row';
  const active=row.status.actuationEnabled;
  const result=document.createElement('p');result.className='commission-result';result.setAttribute('role','status');
  result.textContent=form.result||(active?'Control is enabled. No additional save is needed.':row.status.held==='maintenance'?'Paused for maintenance.':'Control is disabled until you check and enable this garage door.');
  const check=document.createElement('button');check.textContent='Check connections';check.type='button';check.className='secondary';
  check.onclick=()=>action(async()=>{
    let value;try{value=await hb.request('/probe',{controller:row.id});}
    catch(error){connectionChecks.set(row.id,false);form.result='Connection check could not complete. Check the coordinator connection and try again.';throw error;}
    const p=value.probe;connectionChecks.set(row.id,p.compatible);
    const controls=p.controls??[];const issues=[p.door.error,p.bolt.error,...p.limitations,...controls.filter(r=>r.error).map(r=>r.name+': '+r.error)].filter(Boolean);
    form.result=p.compatible?'Connections verified. Door: '+p.door.state+' ('+p.door.feedback+'). Bolt: '+p.bolt.state+' ('+p.bolt.feedback+').'+(controls.length?' Motor relays and physical controls checked: '+controls.length+'.':''):'Connection needs attention: '+issues.join(', ');
  });panel.append(check,result);
  if(!active){
    const enable=document.createElement('button');enable.type='button';enable.className='primary';enable.textContent='Enable this garage door';enable.disabled=!form.ack.every(Boolean);
    ['The previous controller and its automatic inputs are stopped.','The door is physically closed, the bolt wiring is checked and the motor relay is released.'].forEach((text,index)=>{
      const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';input.checked=form.ack[index];
      input.onchange=()=>{form.ack[index]=input.checked;enable.disabled=!form.ack.every(Boolean);};label.append(input,document.createTextNode(text));panel.append(label);
    });
    enable.onclick=()=>action(async()=>{
      await hb.request('/commission',{controller:row.id,revision:loaded.settings.revision,previousControllerStopped:true,physicalSetupReviewed:true,recover:true});
      checkForms.delete(row.id);await load();notice('Garage door enabled. No additional review or save is needed.');toast('Garage door enabled.');
    });panel.append(enable);
  }
  fields.append(panel);
}
async function load(){
  if(!hb){notice('Open this screen from the coordinator’s Settings in Homebridge.',true);return;}
  hb.hideSchemaForm?.();
  themeChoice=await hb.userCurrentLightingMode?.();applyTheme();
  const position=editor&&{selected:editor.selected,step:editor.step,expandedGarage:editor.expandedGarage};
  blocks=await hb.getPluginConfig();loaded=await hb.request('/load');
  if(!loaded.connected&&blocks[0]?.controllers)loaded.settings.configuration.controllers=blocks[0].controllers;
  loaded.settings.configuration=withConnections(loaded.settings.configuration);
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
  const list=document.createElement('ul');list.className='review-list';for(const p of review.configuration.controllers){const li=document.createElement('li');li.textContent=p.name+' · '+p.door.type+' opener · '+p.bolt.type+' bolt · '+p.inputs.length+' physical controls';list.append(li);}for(const old of loaded.settings.configuration.controllers){if(!review.configuration.controllers.some(p=>p.id===old.id)){const li=document.createElement('li');li.textContent='Remove saved garage door: '+old.name;list.append(li);}}box.append(list);
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
    try{connectionChecks.clear();checkForms.clear();await load();}catch{notice(message+' Reopen settings to refresh connection status.');}
  },()=>save.phase==='sync-pending'?(save.connected?'Controller settings are saved, but the Homebridge save did not complete. Click Retry Homebridge save.':'The Homebridge save did not complete. Click Retry Homebridge save.'): 'Could not confirm the configuration save. Reload saved settings before trying again.');
}
$('retry-save').onclick=persist;
$('credential-form').onsubmit=event=>{event.preventDefault();void action(async()=>{
  const response=await hb.request('/credentials',{reference:$('credential-reference').value,secret:$('credential-secret').value,mode:$('credential-reference').readOnly?'replace':'create'});$('credential-secret').value='';
  if(!response.saved){notice('That name is already saved. Choose another name, or use Replace key below.',true);return;}
  if(!loaded.credentials.includes($('credential-reference').value))loaded.credentials.push($('credential-reference').value);
  resetKeyForm();connectionKeys();connectionEditor?.refreshKeys();
  editor.credentials=loaded.credentials;editor.render();
  // Key replacement can pause controls; refresh rows without discarding draft.
  try{const value=await hb.request('/load');loaded.controllers=value.controllers;checkForms.clear();editor.render();}catch{/* Check status on next reload. */}
  notice('Connection key saved privately. Your configuration draft is unchanged.');toast('Connection key saved.');
});};
function showPage(page){
  currentPage=page;
  for(const name of ['general','garages']){
    $(name+'-page').hidden=page!==name;
    if(page===name)$(name+'-tab').setAttribute('aria-current','page');else $(name+'-tab').removeAttribute('aria-current');
  }
  if(page==='general'){connectionEditor?.renderList();connectionEditor?.refreshKeys();connectionKeys();}
  hb?.fixScrollHeight?.();
}
function garageStatus(profile){
  const row=loaded?.controllers.find(row=>row.id===profile.id),status=row?.status;
  const savedProfile=loaded?.settings.configuration.controllers.find(p=>p.id===profile.id);
  const warning=(label,detail='')=>({tone:'attention',label,detail,action:'Review setup',disabled:!save.canEdit});
  if(!savedProfile)return warning('Setup needed','New garage door — not saved or enabled.');
  if(!sameConfiguration(profile,savedProfile))return warning('Unsaved changes',status?.actuationEnabled?'Your saved garage door remains enabled. Review and save to apply these edits.':'Review and save this garage door’s changes.');
  if(!loaded.connected)return warning('Setup needed','Start the coordinator child bridge to check connections.');
  if(!status)return warning('Setup needed');
  if(status.held==='maintenance')return warning('Maintenance paused');
  if(status.state?.fault||status.state?.unavailable||status.state?.obstruction||connectionChecks.get(profile.id)===false||
    status.held&&!['not-commissioned'].includes(status.held))return warning('Needs attention');
  const draft=save.phase!=='saved'||!!connectionEditor?.dirty,detail=draft?'Save or discard pending changes before changing enablement.':'';
  return status.actuationEnabled?{tone:'enabled',label:'Enabled',action:'Disable',disabled:!!status.state?.busy||draft||!save.canEdit,
    detail:status.state?.busy?'An operation is active. Wait for it to finish before disabling.':detail}:
    {tone:'disabled',label:'Disabled',action:'Enable',disabled:!save.canEdit,detail};
}
function openChecks(profile){
  editor.selected=editor.configuration.controllers.findIndex(p=>p.id===profile.id);editor.expandedGarage=profile.id;editor.render();showPage('garages');
}
function garageAction(profile,state){
  if(state.action!=='Disable'){openChecks(profile);return;}
  void action(async()=>{
    const row=loaded.controllers.find(row=>row.id===profile.id);
    await hb.request('/disable',{controller:profile.id,revision:loaded.settings.revision,bootId:row.status.bootId});
    checkForms.delete(profile.id);await load();notice('Garage door control disabled. No additional save is needed.');toast('Garage door control disabled.');
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
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Configure';button.setAttribute('aria-label','Configure '+profile.name);
    button.onclick=()=>{editor.selected=editor.configuration.controllers.findIndex(p=>p.id===profile.id);editor.render();showPage('garages');};
    item.append(details,button);list.append(item);
  }
  $('no-garages').hidden=editor.configuration.controllers.length>0;
}
function resetKeyForm(){
  $('credential-reference').value='';$('credential-reference').readOnly=false;$('credential-secret').value='';
  $('credential-save').textContent='Create connection key';$('credential-form-title').textContent='Create a new connection key';$('credential-cancel').hidden=true;
}
function usesKey(value,name){return !!value&&typeof value==='object'&&(value.credentialRef===name||Object.values(value).some(child=>usesKey(child,name)));}
function connectionKeys(){
  const list=$('saved-keys');list.replaceChildren();$('no-keys').hidden=loaded.credentials.length>0;
  for(const name of [...loaded.credentials].sort()){
    const row=document.createElement('div');row.className='saved-key';
    const label=document.createElement('strong');label.textContent=name;
    const mask=document.createElement('span');mask.className='key-mask';mask.textContent='••••••••';mask.setAttribute('aria-label','Value hidden');
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Replace key';button.setAttribute('aria-label','Replace key '+name);
    button.onclick=()=>{deletingKey=null;connectionKeys();$('credential-form-title').textContent='Replace saved key: '+name;$('credential-reference').value=name;$('credential-reference').readOnly=true;$('credential-secret').value='';$('credential-save').textContent='Replace connection key';$('credential-cancel').hidden=false;$('credential-secret').focus();};
    const controls=document.createElement('div');controls.className='actions';controls.append(button);
    const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='Delete';remove.setAttribute('aria-label','Delete key '+name);
    remove.onclick=()=>{deletingKey=name;connectionKeys();};controls.append(remove);row.append(label,mask,controls);
    if(deletingKey===name){
      const confirm=document.createElement('div');confirm.className='key-delete';
      const used=[...editor.configuration.controllers.filter(p=>usesKey(p,name)).map(p=>p.name),...(editor.configuration.connections??[]).filter(row=>row.credentialRef===name).map(row=>row.name+' connection')];
      const message=document.createElement('p');message.className='help';message.textContent=used.length?'Used by '+used.join(', ')+'. Change those connection or garage settings and save before deleting this key.':'Delete this saved key? This takes effect immediately.';
      confirm.append(message);
      if(!used.length){const accept=document.createElement('button');accept.type='button';accept.className='danger';accept.textContent='Delete saved key';accept.onclick=()=>action(async()=>{
        const result=await hb.request('/credentials/delete',{reference:name});
        if(!result.deleted){notice('This key is still used by saved garage settings. Change those settings and save before deleting it.',true);return;}
        loaded.credentials=loaded.credentials.filter(key=>key!==name);editor.credentials=loaded.credentials;deletingKey=null;
        if($('credential-reference').value===name)resetKeyForm();connectionKeys();connectionEditor?.refreshKeys();editor.render();notice('Connection key deleted. Your configuration draft is unchanged.');toast('Connection key deleted.');
      });confirm.append(accept);}
      const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Cancel deletion';cancel.onclick=()=>{deletingKey=null;connectionKeys();};confirm.append(cancel);row.append(confirm);
    }
    list.append(row);
  }
}
$('general-tab').onclick=()=>showPage('general');$('garages-tab').onclick=()=>showPage('garages');
$('configure-garages').onclick=()=>showPage('garages');$('credential-cancel').onclick=resetKeyForm;
void action(load);
