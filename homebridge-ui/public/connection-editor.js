import { connectionTypes, connectionOrigin, validateConnections, connectionUsers, updateConnection } from './connections.js';
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const button=(text,fn,cls='secondary')=>{const node=el('button',text,cls);node.type='button';node.onclick=fn;return node;};
const id=()=> 'connection-'+Array.from(crypto.getRandomValues(new Uint8Array(5)),n=>n.toString(16).padStart(2,'0')).join('');
export class ConnectionEditor {
  constructor(root,{configuration,credentials,request,run,changed,refresh,message,keyCreated}){
    Object.assign(this,{root,configuration,credentials,request,run,changed,refresh,message,keyCreated});this.dirty=false;this.editing=null;
    root.replaceChildren(el('h2','Device connections'),el('p','Configure each gateway, controller or accessory bridge here. When you add a garage door, choose these saved connections under Devices and Inputs.','subtle'));
    const purposes=el('ul',undefined,'connection-purposes');
    for(const text of ['deCONZ — connects your bolt, optional opener relay, buttons and keypads to their gateway.','Tailwind — connects the opener and its door-state feedback. Each garage selects its door on this controller.','Homebridge accessories — connects devices exposed by another plugin. This is separate from the web admin interface.'])purposes.append(el('li',text));root.append(purposes);
    this.fields=el('fieldset');root.append(this.fields);this.list=el('div');this.list.className='connection-list';this.fields.append(this.list);
    this.title=el('h3','Add a device connection');this.fields.append(this.title);
    this.form=el('form');this.form.className='field-grid connection-form';this.fields.append(this.form);
    const field=(name,label,tag='input')=>{const wrap=el('label',label),node=el(tag);node.id='shared-'+name;node.setAttribute('aria-label',label);wrap.append(node);this.form.append(wrap);return node;};
    this.type=field('type','Connection type','select');for(const [value,label] of Object.entries(connectionTypes))this.type.append(Object.assign(el('option',label),{value}));
    this.name=field('name','Connection name');this.name.required=true;this.name.maxLength=64;this.name.placeholder='Garage deCONZ';
    this.address=field('address','Device address');this.address.required=true;this.address.placeholder='http://192.0.2.20:8080';
    this.key=field('key','Saved connection key','select');this.key.required=true;
    this.keyName=field('new-key-name','New key name');this.keyName.pattern='[a-z][a-z0-9-]{0,47}';this.keyName.autocomplete='off';
    this.secret=field('secret','New private key');this.secret.type='password';this.secret.autocomplete='new-password';
    this.count=field('door-count','Number of Tailwind doors','select');for(const [value,label] of [['','Not specified'],['1','1 door'],['2','2 doors'],['3','3 doors']])this.count.append(Object.assign(el('option',label),{value}));
    this.hint=el('p',undefined,'help wide');this.form.append(this.hint);
    this.submit=el('button','Add connection','primary');this.submit.type='submit';this.cancel=button('Cancel connection edit',()=>{this.reset();this.refresh();});
    const actions=el('div',undefined,'actions wide');actions.append(this.submit,this.cancel);this.form.append(actions);
    this.form.addEventListener('input',()=>{this.dirty=true;this.describe();this.refresh();});
    this.form.addEventListener('change',()=>{this.dirty=true;this.describe();this.refresh();});
    this.type.onchange=()=>this.describe();this.key.onchange=()=>this.describe();
    this.form.onsubmit=event=>{event.preventDefault();void this.run(async()=>{try{await this.commit();}catch(error){this.errorCode=error.message;throw error;}},()=>({
      duplicate_connection:'This address and saved key already have a connection. Select or edit that connection instead.',
      invalid_connection_address:'Enter a device address such as http://192.0.2.20:8080, with no path or embedded key.',
      invalid_connection_name:'Enter a connection name of 1–64 characters.',
      invalid_secret_reference:'Enter a key name using lowercase letters, numbers and hyphens.',
      tailwind_door_out_of_range:'That door count excludes a door already assigned to a garage. Change its door selection first.',
      invalid_tailwind_door_count:'Choose a Tailwind door count from 1 to 3, or Not specified.'
    }[this.errorCode]??'Could not save this connection. Check the coordinator connection and saved key.'));};
    this.reset();this.renderList();
  }
  refreshKeys(){
    const selected=this.key.value;this.key.replaceChildren(Object.assign(el('option','Choose a saved key'),{value:''}));
    for(const value of [...this.credentials()].sort())this.key.append(Object.assign(el('option',value),{value}));
    this.key.append(Object.assign(el('option','Create a new key here'),{value:'__new__'}));
    this.key.value=selected&&[...this.key.options].some(o=>o.value===selected)?selected:this.credentials().length===1?this.credentials()[0]:this.credentials().length===0?'__new__':'';
    this.describe();
  }
  describe(){
    const kind=this.type.value,newKey=this.key.value==='__new__';
    this.keyName.parentElement.hidden=!newKey;this.secret.parentElement.hidden=!newKey;this.keyName.required=newKey;this.secret.required=newKey;
    this.count.parentElement.hidden=kind!=='tailwind';
    const keyLabel=kind==='tailwind'?'Tailwind local control token':kind==='deconz'?'deCONZ API key':'HomeKit pairing PIN';this.secret.parentElement.firstChild.textContent=keyLabel;this.secret.setAttribute('aria-label',keyLabel);
    this.hint.textContent=kind==='homebridge'?'Use the accessory port of the bridge or child bridge exposing the device, and save its HomeKit pairing PIN as the key. This is separate from the Homebridge web UI and web admin interface. The source bridge must allow accessory control in insecure mode.':kind==='tailwind'?'Use the Tailwind local address and local control token. Door count is the number configured in the Tailwind app; leave Not specified until confirmed. Select the individual door in its garage settings.':'Use the deCONZ gateway address, including its port, and its API key. The connection can serve your bolt, motor relay and physical inputs.';
    if(newKey)this.hint.textContent+=' The new key is stored privately when you add or update this connection.';
    this.cancel.hidden=!this.editing&&!this.dirty;
  }
  reset(){
    this.editing=null;this.dirty=false;this.type.disabled=false;this.form.reset();this.type.value='deconz';this.secret.value='';this.keyName.value='';
    this.title.textContent='Add a device connection';this.submit.textContent='Add connection';this.refreshKeys();this.describe();
  }
  edit(row){
    if(this.dirty){this.message('Add, update or cancel the connection you are editing first.',true);return;}
    this.editing=row.id;this.type.value=row.type;this.type.disabled=true;this.name.value=row.name;this.address.value=row.baseUrl;this.refreshKeys();this.key.value=row.credentialRef;this.keyName.value='';this.secret.value='';this.count.value=row.doorCount??'';
    this.title.textContent='Edit connection';this.submit.textContent='Update connection';this.describe();this.name.focus();
  }
  focus(type){
    if(!this.dirty&&!this.editing){this.type.value=type;this.describe();}
    this.root.scrollIntoView({behavior:'smooth',block:'start'});
  }
  async commit(){
    const configuration=this.configuration(),isNewKey=this.key.value==='__new__';
    const row={id:this.editing??id(),type:this.type.value,name:this.name.value,baseUrl:connectionOrigin(this.address.value,{allowBare:true}),credentialRef:isNewKey?this.keyName.value:this.key.value,...(this.type.value==='tailwind'?{doorCount:this.count.value===''?null:Number(this.count.value)}:{})};
    const checked=validateConnections([row])[0];
    // Validate duplicates, all affected profiles and door count before storing a key.
    const draft=structuredClone(configuration);
    if(this.editing)updateConnection(draft,this.editing,checked);else draft.connections=validateConnections([...draft.connections,checked]);
    if(isNewKey){
      const response=await this.request('/credentials',{reference:checked.credentialRef,secret:this.secret.value,mode:'create'});this.secret.value='';
      if(!response.saved){this.message('That key name is already saved. Select it from Saved connection key or choose a different new name.',true);return;}
      this.keyCreated(checked.credentialRef);
    }else if(!this.credentials().includes(checked.credentialRef)){this.message('Choose an existing saved key, or create one here.',true);return;}
    configuration.connections=draft.connections;configuration.controllers=draft.controllers;
    this.reset();this.changed(configuration);this.renderList();
    this.message('Connection added to your configuration. Review and save to apply it.');
  }
  renderList(){
    this.list.replaceChildren();const configuration=this.configuration();
    for(const row of configuration.connections??[]){
      const card=el('div',undefined,'shared-connection');card.dataset.connection=row.id;
      const text=el('div');text.append(el('h3',row.name),el('p',connectionTypes[row.type]+' · '+row.baseUrl,'help'),el('p','Saved key: '+row.credentialRef+' · ••••••••','help'));
      if(row.type==='tailwind')text.append(el('p',row.doorCount==null?'Door count not specified':row.doorCount+' configured door'+(row.doorCount===1?'':'s'),'help'));
      const users=connectionUsers(configuration,row);text.append(el('p',users.length?'Used by '+users.map(p=>p.name).join(', '):'Not assigned to a garage door.','help'));
      const actions=el('div',undefined,'actions');const edit=button('Edit',()=>this.edit(row));edit.setAttribute('aria-label','Edit connection '+row.name);
      const remove=button('Remove',()=>{if(this.dirty){this.message('Finish or cancel the connection form first.',true);return;}configuration.connections=configuration.connections.filter(item=>item.id!==row.id);if(this.editing===row.id)this.reset();this.changed(configuration);this.renderList();this.message('Connection removed from your draft. Review and save to apply the removal.');},'danger');remove.setAttribute('aria-label','Remove connection '+row.name);remove.disabled=users.length>0;
      if(users.length)remove.title='Change the garage assignments before removing this connection.';
      actions.append(edit,remove);card.append(text,actions);this.list.append(card);
    }
    if(!configuration.connections?.length)this.list.append(el('p','No device connections yet. Add deCONZ or Tailwind below to get started.','help'));
  }
}
