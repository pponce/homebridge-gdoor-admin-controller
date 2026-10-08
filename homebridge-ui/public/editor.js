import { sameConnection, selectConnection, connectionTypes, withConnections } from './connections.js';
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const freshId = prefix => prefix + '-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), byte=>byte.toString(16).padStart(2,'0')).join('');
export function newGarage() {
  const id = freshId('garage');
  return { id, name: 'My garage', exposeBoltLock: true, autoBolt: true,
    door: { type:'tailwind', baseUrl:'', doorIndex:0, credentialRef:'garage-tailwind' },
    bolt: { type:'deconz', baseUrl:'', gatewayId:'', resourceId:'', uniqueId:'', resourceType:'On/Off output', modelId:'', manufacturer:'', credentialRef:'garage-deconz', lockedValue:true },
    feedback: { closing:'sensor', opening:'timed', bolt:'relay', openingSeconds:20, closingSeconds:20, closedStableSeconds:2, boltSettleSeconds:2, allowEstimatedBolting:false },
    timing: { operationPollSeconds:.5, idlePollSeconds:2, openRetractSettleSeconds:2, closeRetractSettleSeconds:2, boltTimeoutSeconds:10, motionTimeoutSeconds:45, interruptedOpenMarginSeconds:1 },
    motorPaths:[], inputs:[], keypad:null };
}
export class ProfileEditor {
  constructor(root, { configuration, credentials = [], discover, discoverHomebridge, changed = () => {}, error = () => {}, renderCheckEnable, viewChanged = () => {}, getStatus, cardAction, manageConnections }) {
    this.root=root; this.configuration=withConnections(configuration); this.credentials=credentials; this.discover=discover; this.discoverHomebridge=discoverHomebridge; this.changed=changed; this.error=error;
    this.renderCheckEnable=renderCheckEnable;this.viewChanged=viewChanged;this.getStatus=getStatus;this.cardAction=cardAction;
    this.manageConnections=manageConnections;this.manualKeypad=new Set();this.expandedGarage=null;
    this.selectedInputs=new Map();this.selected=0; this.step=0; this.render();
  }
  change() { this.changed(this.configuration); }
  button(text, action, cls='secondary') { const b=el('button',text,cls);b.type='button';b.addEventListener('click',action);return b; }
  input(grid, label, obj, key, { type='text', help, min, max, step, options, rerender=false, emptyUnset=false }={}) {
    const wrap=el('label',label); const field=el(options?'select':'input'); field.dataset.field=key;field.setAttribute('aria-label',label);
    if(options) for(const [value,label,disabled] of options){ const o=el('option',label);o.value=String(value);o.disabled=!!disabled;field.append(o); }
    else { field.type=type; if(min!==undefined)field.min=min;if(max!==undefined)field.max=max;if(step!==undefined)field.step=step; }
    if(type==='checkbox'){wrap.className='check';field.checked=!!obj[key];wrap.prepend(field);}
    else {field.value=obj[key]??'';wrap.append(field);}
    if(help){const description=el('span',help,'help');description.id=freshId('help');field.setAttribute('aria-describedby',description.id);wrap.append(description);}
    const update=()=>{
      const value=type==='checkbox'?field.checked:type==='number'?(emptyUnset&&field.value===''?undefined:Number(field.value)):field.value;
      // Input already committed this edit. Rebuilding cards again on blur can
      // detach the button between pointer-down and click, losing the action.
      if(Object.is(obj[key],value))return;
      if(value===undefined)delete obj[key];else obj[key]=value;this.change();
    };
    if(!options&&type!=='checkbox')field.addEventListener('input',update);
    field.addEventListener('change',()=>{update();if(rerender)this.render();});
    grid.append(wrap);return field;
  }
  grid(parent){const g=el('div',undefined,'field-grid');parent.append(g);return g;}
  panel(parent,title,subtitle){const p=el('section',undefined,'device-block');p.append(el('h3',title));if(subtitle)p.append(el('p',subtitle,'subtle small'));parent.append(p);return p;}
  sharedConnection(parent,connection){
    const type=connection.type??'deconz';const choices=this.configuration.connections.filter(row=>row.type===type);
    const matched=choices.find(row=>sameConnection(row,connection));
    const label=el('label',connectionTypes[type]+' connection');const select=el('select');select.setAttribute('aria-label',connectionTypes[type]+' connection');select.required=true;
    select.append(Object.assign(el('option','Choose a saved connection'),{value:'',disabled:true}));
    for(const row of choices)select.append(Object.assign(el('option',row.name),{value:row.id}));select.value=matched?.id??'';label.append(select);const row=this.grid(parent);row.classList.add('connection-picker-row');row.append(label);
    if(this.manageConnections)row.append(this.button('Manage connections',()=>this.manageConnections(type)));
    select.onchange=()=>{const shared=choices.find(row=>row.id===select.value);if(!shared)return;selectConnection(connection,shared);this.change();this.render();};
    if(matched)parent.append(el('p',matched.baseUrl+' · Saved key: '+matched.credentialRef,'help connection-summary'));
    else parent.append(el('p','Create a '+connectionTypes[type]+' connection in General, then select it here.','help'));
    return matched;
  }
  connection(parent, obj, key, kind) {
    const current=obj[key];const types=kind==='garage'?[['tailwind','Tailwind local API'],['homebridge','Existing Homebridge garage']]:[['deconz','deCONZ directly'],['homebridge','Existing Homebridge device']];
    const choice=this.input(this.grid(parent),'Connection',current,'type',{options:types});
    choice.addEventListener('change',()=>{
      obj[key]={type:current.type,baseUrl:'',credentialRef:'garage-'+current.type,...(kind==='garage'&&current.type==='tailwind'?{doorIndex:0}:{}),
        ...(kind==='bolt'?{lockedValue:true,...(current.type==='homebridge'?{serviceType:'switch'}:{})}:{}),...(kind==='motor'?{activeValue:true}:{}),
        ...(['button','keypad','switch'].includes(kind)?{kind:current.type==='homebridge'&&kind==='keypad'?'button':kind}: {})};
      this.change();this.render();
    });
  }
  bridgeDevice(parent,connection,kind){
    this.sharedConnection(parent,connection);
    parent.append(el('p','Save this bridge’s pairing PIN as a private connection key. The selected Homebridge must allow unpaired accessory control (insecure mode). Native HomeKit accessories are not supported.','help'));
    const output=el('div',undefined,'discovery-results');parent.append(this.button('Find Homebridge devices',async()=>{
      if(!this.discoverHomebridge)return this.error('Discover Homebridge devices in the Homebridge plugin settings.');
      try {output.textContent='Finding devices…';const data=await this.discoverHomebridge({baseUrl:connection.baseUrl,credentialRef:connection.credentialRef});
        const allowed=kind==='garage'?['garage']:kind==='bolt'?['lock','switch','light']:kind==='motor'?['switch','light']:['button','switch'];
        const rows=data.services.filter(x=>allowed.includes(x.kind));const pick=el('select');pick.setAttribute('aria-label','Discovered Homebridge '+kind);pick.append(Object.assign(el('option','Choose a device'),{value:''}));
        rows.forEach((row,i)=>pick.append(Object.assign(el('option',row.name+' · '+row.kind),{value:String(i)})));
        pick.addEventListener('change',()=>{if(pick.value==='')return;const row=rows[Number(pick.value)];Object.assign(connection,{bridgeId:row.bridgeId,serviceId:row.serviceId,accessoryIdentity:row.accessoryIdentity});
          if(kind==='bolt'){connection.serviceType=row.kind;if(row.kind==='lock')delete connection.lockedValue;else connection.lockedValue??=true;}
          if(['button','keypad','switch'].includes(kind)){connection.kind=row.kind;const input=this.configuration.controllers.flatMap(p=>p.inputs??[]).find(i=>i.source===connection);if(input)input.trigger=row.kind==='switch'?'on':0;}
          this.change();this.render();});output.replaceChildren(pick);if(!rows.length)output.textContent='No compatible services found on this bridge.';
      }catch{output.textContent='Could not read this bridge. Check its accessory port, saved PIN and insecure-mode setting.';}
    }));parent.append(output);
    if(connection.serviceId)parent.append(el('p','Selected service '+connection.serviceId+' · '+connection.bridgeId,'route-note'));
    const details=el('details');details.append(el('summary','Pinned device identity'));const g=this.grid(details);for(const [key,label]of [['bridgeId','Bridge identity'],['serviceId','Accessory / service ID'],['accessoryIdentity','Accessory identity fingerprint']])this.input(g,label,connection,key);parent.append(details);
  }
  device(parent,connection,kind){
    if(connection.type==='homebridge')return this.bridgeDevice(parent,connection,kind);
    this.sharedConnection(parent,connection);
    const output=el('p','Choose a device to pin its identity.','help');
    parent.append(this.button('Find devices',async()=>{
      if(!this.discover)return this.error('Use Homebridge settings to discover and connect devices.');
      try{
        output.textContent='Finding devices…';const data=await this.discover({baseUrl:connection.baseUrl,credentialRef:connection.credentialRef});
        connection.gatewayId=data.gatewayId;
        const rows=kind==='bolt'||kind==='motor'?data.lights:data.sensors.filter(row=>kind==='keypad'?row.resourceType==='ZHAAncillaryControl':row.resourceType!=='ZHAAncillaryControl');
        const pick=el('select');pick.setAttribute('aria-label','Discovered '+kind);pick.append(Object.assign(el('option','Choose a '+kind),{value:''}));
        rows.forEach((row,index)=>pick.append(Object.assign(el('option',row.name+' · '+row.modelId),{value:String(index)})));
        pick.addEventListener('change',()=>{if(pick.value==='')return;const {name,...identity}=rows[Number(pick.value)];Object.assign(connection,identity);this.change();this.render();});
        output.replaceChildren(pick);if(!rows.length)output.textContent='No compatible devices found on this gateway.';
      }catch{output.textContent='Could not read devices. Check the address and saved connection key.';}
    }));parent.append(output);
    if(connection.resourceId)parent.append(el('p','Selected: '+(connection.modelId||'Device')+' · resource '+connection.resourceId,'route-note'));
    const detail=el('details');detail.append(el('summary','Device identity and manual connection'));const fields=this.grid(detail);
    for(const [key,label] of [['gatewayId','Gateway identity'],['resourceId','Resource number'],['uniqueId','Endpoint identity'],['resourceType','Resource type'],['modelId','Model'],['manufacturer','Manufacturer']])this.input(fields,label,connection,key);
    parent.append(detail);
  }
  garageList(){
    const list=el('div',undefined,'garage-list');
    this.configuration.controllers.forEach((p,index)=>{
      const card=el('div',undefined,'garage-card');card.dataset.selected=String(index===this.selected);card.dataset.controller=p.id;card.dataset.expanded=String(this.expandedGarage===p.id);
      const select=this.button('',()=>{this.selected=index;this.render();},'garage-select');select.setAttribute('aria-pressed',String(index===this.selected));
      select.append(el('strong',p.name),el('span',(p.inputs?.length??0)+' physical controls · '+(p.exposeBoltLock?'Garage + lock tiles':'Garage tile')));card.append(select);
      const state=this.getStatus?.(p);
      if(state){card.dataset.state=state.tone;const footer=el('div',undefined,'garage-card-footer');
        footer.append(el('span',state.label,'garage-status'));
        const action=this.button(state.action,()=>this.cardAction(p,state),'card-action');action.disabled=state.disabled;action.setAttribute('aria-label',state.action+' '+p.name);
        footer.append(action);
        if(state.action==='Disable'){const checks=this.button('Check connections',()=>this.cardAction(p,{...state,action:'Checks'}),'card-action');checks.setAttribute('aria-label','Check connections '+p.name);footer.append(checks);}
        card.append(footer);if(state.detail)card.append(el('p',state.detail,'help card-help'));
        if(this.expandedGarage===p.id&&this.renderCheckEnable){this.renderCheckEnable(card,p);const hide=this.button('Hide checks',()=>{this.expandedGarage=null;this.refreshCards();},'card-hide');card.append(hide);}
      }list.append(card);
    });
    list.append(this.button('Add a garage door',()=>{this.configuration.controllers.push(newGarage());this.selected=this.configuration.controllers.length-1;this.step=0;this.change();this.render();},'add-garage'));
    return list;
  }
  refreshCards(){const current=this.root.querySelector('.garage-list');if(current)current.replaceWith(this.garageList());}
  render(){
    this.root.replaceChildren();this.root.append(this.garageList());
    const p=this.configuration.controllers[this.selected];if(!p){const empty=el('section',undefined,'panel empty');empty.append(el('h2','No garage doors yet'),el('p','Use Add a garage door to connect an opener and its separate bolt.','subtle'));this.root.append(empty);this.viewChanged();return;}
    p.motorPaths??=[];p.inputs??=[];p.timing??={};
    const names=['Devices','Controls','Behavior'];
    const steps=el('nav',undefined,'steps');steps.setAttribute('aria-label','Garage setup');names.forEach((name,index)=>{const b=this.button(String(index+1).padStart(2,'0')+'  '+name,()=>{this.step=index;this.render();});if(index===this.step)b.setAttribute('aria-current','step');steps.append(b);});this.root.append(steps);
    const content=el('div',undefined,'step-content');this.root.append(content);
    if(this.step===0)this.devices(content,p);else if(this.step===1)this.inputs(content,p);else this.behavior(content,p);
    this.viewChanged();
  }
  devices(root,p){
    root.append(el('p','Devices operate or report on one part of your garage: the door or the bolt. Controls request a coordinated operation; the coordinator handles the door and bolt sequence.','help setup-model'));
    const identity=this.panel(root,'Garage details');const grid=this.grid(identity);this.input(grid,'Garage name',p,'name');identity.append(el('p','Controller ID: '+p.id+' · Use this to link the standalone administrator.','help'));this.input(grid,'Show a separate bolt Lock tile',p,'exposeBoltLock',{type:'checkbox'});
    const opener=this.panel(root,'Garage opener','The default opener connection and source of door position feedback. HomeKit and the virtual keypad use this device; other controls can choose it or an opener relay.');
    this.connection(opener,p,'door','garage');
    if(p.door.type==='homebridge')this.bridgeDevice(opener,p.door,'garage');else {
      const shared=this.sharedConnection(opener,p.door),dg=this.grid(opener);
      const door=this.input(dg,'Tailwind door',p.door,'doorIndex',{type:'number',options:Array.from({length:shared?.doorCount??3},(_,index)=>[index,'Door '+(index+1)]),help:shared?.doorCount?'Choose which door on this Tailwind controller to use.':'Set the number of doors in General to narrow this list. Door 1 uses API index 0.'});door.required=true;
      const link=el('a','How to get a Tailwind local control key');link.href='https://gotailwind.zendesk.com/hc/en-us/articles/42573968819725-How-do-I-get-my-local-control-key-for-my-Tailwind-garage-door-controller';link.target='_blank';link.rel='noreferrer';opener.append(link);
    }
    opener.append(el('p','During movement: stop / reverse is unavailable through this garage opener connection. Use a compatible opener relay for that behavior.','help'));
    const bolt=this.panel(root,'Separate bolt / lock','This is the output that retracts and extends the bolt.');this.connection(bolt,p,'bolt','bolt');this.device(bolt,p.bolt,'bolt');if(p.bolt.serviceType!=='lock')this.input(this.grid(bolt),'Relay ON means bolt extended',p.bolt,'lockedValue',{type:'checkbox',help:'Choose the mapping that matches your wiring. A relay report does not prove physical bolt position.'});
    this.openerRelays(root,p);
    root.append(this.button('Remove this garage door',()=>{
      const index=this.configuration.controllers.findIndex(profile=>profile.id===p.id);if(index<0)return;
      this.configuration.controllers.splice(index,1);this.selected=Math.max(0,index-1);
      if(this.expandedGarage===p.id)this.expandedGarage=null;
      this.change();this.render();
    },'danger'));
    root.append(el('p','Removes this garage door from your draft. Saved garage doors keep running until you review and save the removal. Discard changes restores saved garage doors.','help'));
  }
  applyDeviceBehavior(p,path){
    const enabled=path.interruption==='stop-opening-reverse-closing';
    for(const input of p.inputs.filter(input=>input.motorPath===path.id)){
      if(input.action==='toggle')input.busyBehavior=enabled?'interrupt':'drop';
      else if(!enabled)input.busyBehavior='drop';
    }
  }
  openerRelays(root,p){
    const paths=this.panel(root,'Additional opener devices','Optional opener relays, connected directly through deCONZ or mapped to an existing Homebridge switch. Each operates the door; the bolt has its own device.');
    p.motorPaths.forEach((path,index)=>{
      const card=this.panel(paths,path.name);const g=this.grid(card);this.input(g,'Device name',path,'name');this.connection(card,path,'connection','motor');this.device(card,path.connection,'motor');this.input(this.grid(card),'Relay ON activates the opener',path.connection,'activeValue',{type:'checkbox'});if(path.connection.type==='homebridge')this.input(this.grid(card),'I verified OFF always releases this output, including repeated OFF commands',path.connection,'inactiveWriteIdempotent',{type:'checkbox',help:'A toggle-only switch cannot be used as the motor relay.'});
      const times=this.grid(card);for(const [k,l] of [['openPulseSeconds','Opening pulse (seconds)'],['closePulseSeconds','Closing pulse (seconds)']])this.input(times,l,path,k,{type:'number',min:.1,max:2,step:.1});
      this.input(times,'During movement',path,'interruption',{options:[['disabled','No stop / reverse'],['stop-opening-reverse-closing','Stop opening / reverse closing']],help:'Enable only for a relay and opener verified to support this sequence. Applies to toggle buttons and switches using this device; keypad authorization is configured under Controls.'}).addEventListener('change',()=>{this.applyDeviceBehavior(p,path);this.change();this.render();});
      const mismatched=p.inputs.filter(input=>input.motorPath===path.id&&input.action==='toggle'&&input.busyBehavior!==(path.interruption==='stop-opening-reverse-closing'?'interrupt':'drop'));
      if(mismatched.length){card.append(el('p','Saved controls with different movement behavior: '+mismatched.map(input=>input.name).join(', ')+'. Existing behavior is preserved until you apply the device setting.','help'));card.append(this.button('Apply device behavior to linked controls',()=>{this.applyDeviceBehavior(p,path);this.change();this.render();}));}
      card.append(this.button('Remove opener device',()=>{p.motorPaths.splice(index,1);this.change();this.render();},'danger'));
    });
    paths.append(this.button('Add opener relay',()=>{p.motorPaths.push({id:freshId('motor'),name:'Opener relay',type:'pulse-relay',connection:{type:'deconz',baseUrl:p.bolt.type==='deconz'?p.bolt.baseUrl:'',credentialRef:p.bolt.type==='deconz'?p.bolt.credentialRef:'garage-deconz',activeValue:true},openPulseSeconds:1,closePulseSeconds:1,interruption:'disabled'});delete p.motorPaths.at(-1).connection.lockedValue;p.motorPaths.at(-1).connection.resourceId='';p.motorPaths.at(-1).connection.uniqueId='';this.change();this.render();}));
  }
  inputs(root,p){
    root.append(el('p','Controls request coordinated garage and bolt operation. A button, keypad or Homebridge switch is a control when we listen to it. Choose which opener device carries out its requests; the coordinator handles the bolt automatically.','help setup-model'));
    root.append(el('div','HomeKit + virtual keypad → '+(p.door.type==='tailwind'?'Tailwind API':'Garage opener (Homebridge)'),'route-note'));
    const inputs=this.panel(root,'Your controls','Select a control to edit its source, action and opener device.');
    const openerLabel='Garage opener ('+(p.door.type==='tailwind'?'Tailwind':'Homebridge')+')';
    const routeLabel=input=>input.motorPath==='primary'?openerLabel:'Relay: '+(p.motorPaths.find(path=>path.id===input.motorPath)?.name??'Missing relay');
    const selector=el('div',undefined,'input-selector');selector.setAttribute('role','group');selector.setAttribute('aria-label','Select a control');inputs.append(selector);
    if(!p.inputs.some(input=>input.id===this.selectedInputs.get(p.id)))this.selectedInputs.set(p.id,p.inputs[0]?.id);
    const refreshSelector=()=>{
      selector.replaceChildren();
      for(const input of p.inputs){
        const choice=this.button('',()=>{this.selectedInputs.set(p.id,input.id);this.render();this.root.querySelector('.input-choice[aria-pressed="true"]')?.focus();},'secondary input-choice');
        choice.dataset.inputId=input.id;choice.setAttribute('aria-pressed',String(input.id===this.selectedInputs.get(p.id)));
        choice.append(el('strong',input.name||'Unnamed control'),el('span',(input.source.kind==='keypad'?'Keypad':input.source.kind==='switch'?'Switch':'Button')+' · '+routeLabel(input)+(input.enabled?'':' · Disabled'),'small'));
        selector.append(choice);
      }
    };
    refreshSelector();
    if(!p.inputs.length)inputs.append(el('p','No controls yet. Add a button, keypad or Homebridge switch.','help'));
    p.inputs.forEach((input,index)=>{
      if(input.id!==this.selectedInputs.get(p.id))return;
      const card=this.panel(inputs,input.name);card.classList.add('input-profile');const g=this.grid(card);
      this.input(g,'Control name',input,'name').addEventListener('input',()=>{refreshSelector();card.querySelector('h3').textContent=input.name||'Unnamed control';});this.input(g,'Use this control',input,'enabled',{type:'checkbox'}).addEventListener('change',refreshSelector);
      this.connection(card,input,'source',input.source.kind);
      if(input.source.type==='deconz')this.input(g,'Control type',input.source,'kind',{options:[['button','deCONZ button'],['keypad','Physical deCONZ keypad']],rerender:true});
      if(input.source.kind==='keypad'){if(input.action!=='keypad')input.busyBehavior='drop';input.action='keypad';input.trigger='native-outcome';input.source.alarmId??=1;}
      else {delete input.source.alarmId;if(input.action==='keypad')input.action='toggle';if(input.trigger==='native-outcome'||input.source.type==='homebridge'&&input.source.kind==='button'&&input.trigger>2)input.trigger=input.source.type==='homebridge'?0:1002;if(input.source.kind==='switch'&&typeof input.trigger!=='string')input.trigger='on';}
      this.device(card,input.source,input.source.kind);const actions=this.grid(card);
      if(input.source.kind==='keypad')this.input(actions,'Alarm system number',input.source,'alarmId',{type:'number',min:1,max:255,step:1});
      else {if(input.source.kind==='switch')this.input(actions,'Switch transition',input,'trigger',{options:[['on','Turns on'],['off','Turns off'],['either','Either transition']]});else this.input(actions,'Button event',input,'trigger',{type:'number',min:0,max:input.source.type==='homebridge'?2:65535,step:1,help:input.source.type==='homebridge'?'0: single press, 1: double press, 2: long press.':'For example, 1002 is the usual single press on many deCONZ buttons.'});this.input(actions,'Action',input,'action',{options:[['toggle','Open / close toggle'],['open','Open'],['close','Close']]}).addEventListener('change',()=>{input.busyBehavior=input.action==='toggle'&&p.motorPaths.find(path=>path.id===input.motorPath)?.interruption==='stop-opening-reverse-closing'?'interrupt':'drop';this.change();this.render();});}
      this.input(actions,'Operate garage through',input,'motorPath',{options:[['primary',openerLabel],...p.motorPaths.map(path=>[path.id,'Relay: '+path.name])],help:'Choose whether this control sends commands through the garage opener connection or pulses a relay.'}).addEventListener('change',()=>{const supported=p.motorPaths.find(path=>path.id===input.motorPath)?.interruption==='stop-opening-reverse-closing';input.busyBehavior=input.action==='toggle'&&supported?'interrupt':input.source.kind==='keypad'&&supported?input.busyBehavior:'drop';this.change();this.render();});
      const canInterrupt=p.motorPaths.find(path=>path.id===input.motorPath)?.interruption==='stop-opening-reverse-closing';
      if(input.source.kind==='keypad')this.input(actions,'PIN behavior',input,'busyBehavior',{options:[['drop','Correct PIN opens; incorrect PIN closes'],['interrupt','Correct PIN to open; either PIN to stop, reverse or close',!canInterrupt]],help:'The second option requires a compatible opener relay. It can interrupt only movement started by this keypad. An incorrect PIN never opens a closed door, but can reverse a closing door.'});
      else card.append(el('p',input.action==='toggle'?(input.busyBehavior==='interrupt'?'Movement behavior: stop opening / reverse closing, using the selected opener device.':'Movement behavior: ignore presses during movement. Configure the opener device under Devices.'):'Open-only and close-only controls ignore requests during movement. Use a toggle control for device stop / reverse behavior.','help control-movement'));
      this.input(actions,'Rearm delay (seconds)',input,'rearmSeconds',{type:'number',min:0,max:10,step:.1});
      const advanced=el('details');advanced.append(el('summary','Timing for this control'));const tg=this.grid(advanced);input.timing??={};
      for(const [key,label] of [['openRetractSettleSeconds','Retract before opening'],['closeRetractSettleSeconds','Retract before closing'],['openingSeconds','Estimated opening travel'],['closingSeconds','Estimated closing travel']]){
        const help='Leave blank to use the garage default.'+(key==='closeRetractSettleSeconds'?' 0 starts closing after any needed unlock command is acknowledged; retraction is monitored during travel. Above 0 waits for unlocked feedback, then this settling time.':'');
        this.input(tg,label+' (seconds)',input.timing,key,{type:'number',min:key.includes('Retract')?0:1,max:300,step:.1,help,emptyUnset:true});
      }card.append(advanced);card.append(this.button('Remove control',()=>{p.inputs.splice(index,1);this.selectedInputs.set(p.id,p.inputs[Math.min(index,p.inputs.length-1)]?.id);this.change();this.render();},'danger'));
    });
    inputs.append(this.button('Add control',()=>{p.inputs.push({id:freshId('input'),name:'Indoor button',enabled:true,source:{type:'deconz',kind:'button',baseUrl:p.bolt.baseUrl,gatewayId:p.bolt.gatewayId,resourceId:'',uniqueId:'',resourceType:'ZHASwitch',modelId:'',manufacturer:'',credentialRef:p.bolt.credentialRef},trigger:1002,action:'toggle',motorPath:p.motorPaths[0]?.id??'primary',busyBehavior:p.motorPaths[0]?.interruption==='stop-opening-reverse-closing'?'interrupt':'drop',rearmSeconds:1.5,timing:{}});this.selectedInputs.set(p.id,p.inputs.at(-1).id);this.change();this.render();}));
    this.virtualKeypad(root,p);
  }
  virtualKeypad(root,p){
    const virtual=this.panel(root,'Web admin virtual keypad','Optional. Requires the separate web admin interface. Your physical keypad works without this.');virtual.dataset.section='virtual-keypad';
    const keys=['baseUrl','gatewayId','credentialRef','alarmId'];
    const physical=p.inputs.filter(input=>input.source.type==='deconz'&&input.source.kind==='keypad');
    const matched=p.keypad&&physical.find(input=>keys.every(key=>input.source[key]===p.keypad[key]));
    const choice={alarm:!p.keypad?'off':matched&&!this.manualKeypad.has(p.id)?'physical:'+matched.id:'manual'};
    const select=this.input(this.grid(virtual),'Virtual keypad alarm',choice,'alarm',{options:[['off','Not used'],
      ...physical.map(input=>['physical:'+input.id,'Use alarm from '+input.name]),['manual','Enter alarm details manually']],
      help:'Choose the deCONZ alarm used by the web admin keypad. This does not arm or disarm it.'});
    select.addEventListener('change',()=>{
      if(choice.alarm==='manual')this.manualKeypad.add(p.id);else this.manualKeypad.delete(p.id);
      if(choice.alarm==='off')p.keypad=null;
      else if(choice.alarm==='manual')p.keypad??={baseUrl:p.bolt.type==='deconz'?p.bolt.baseUrl:'',gatewayId:p.bolt.type==='deconz'?p.bolt.gatewayId:'',credentialRef:p.bolt.type==='deconz'?p.bolt.credentialRef:'garage-deconz',alarmId:1};
      else{const source=physical.find(input=>'physical:'+input.id===choice.alarm)?.source;if(!source)return;p.keypad=Object.fromEntries(keys.map(key=>[key,source[key]]));}
      this.change();this.render();
    });
    if(!p.keypad)return;
    const note=el('p','Use the same gateway and alarm when linking this garage in the web admin interface. Opening and closing use '+(p.door.type==='tailwind'?'Tailwind':'the garage opener (Homebridge)')+'.','help');virtual.append(note);
    // A physical selection copies the alarm scope. It is not a live binding to
    // the physical input, and rendering must never rewrite an existing scope.
    this.sharedConnection(virtual,p.keypad);const g=this.grid(virtual);this.input(g,'Gateway identity',p.keypad,'gatewayId');this.input(g,'Alarm number',p.keypad,'alarmId',{type:'number',min:1,max:255,step:1});
    virtual.append(el('p','Selecting a physical keypad copies its alarm details. Later changes to that physical control do not change this saved connection.','help'));
  }
  behavior(root,p){
    const feedback=this.panel(root,'What does your hardware actually report?','The coordinator uses this to decide when it may move or bolt the door.');const g=this.grid(feedback);
    this.input(g,'Closed means…',p.feedback,'closing',{options:[['sensor','A door sensor confirms closed'],['timed','A command / estimate only']],help:'Tailwind provides a closed sensor. Use that feedback for your installation.',rerender:true});
    this.input(g,'Open means…',p.feedback,'opening',{options:[['timed','Not closed; estimate full travel'],['sensor','A sensor confirms fully open']],help:'Tailwind reports not-closed. Full opening travel is estimated.'});
    this.input(g,'Bolt feedback',p.feedback,'bolt',{options:[['relay','Relay ON / OFF state'],['position','Physical position sensor']],help:'The direct deCONZ relay uses relay state.'});
    if(p.feedback.closing==='timed')this.input(g,'Allow bolting after estimated closure',p.feedback,'allowEstimatedBolting',{type:'checkbox',help:'Elapsed time cannot prove the door closed. This policy requires explicit acceptance.'});else p.feedback.allowEstimatedBolting=false;
    const travel=this.panel(root,'Movement timing');const tg=this.grid(travel);
    for(const [key,label,help] of [['openingSeconds','Full opening travel','Starts after the closed sensor departs.'],['closingSeconds','Full closing travel','Used when closure is estimated.'],['closedStableSeconds','Stable closed confirmation','How long the closed sensor must remain active before bolting.'],['boltSettleSeconds','Bolt extension settling','Time to allow the mechanism to finish extending.']])this.input(tg,label+' (seconds)',p.feedback,key,{type:'number',min:key.includes('Seconds')&&['openingSeconds','closingSeconds'].includes(key)?1:0,max:300,step:.1,help});
    const settling=this.panel(root,'Bolt retraction');const sg=this.grid(settling);
    this.input(sg,'Before opening (seconds)',p.timing,'openRetractSettleSeconds',{type:'number',min:0,max:120,step:.1});this.input(sg,'Before closing (seconds)',p.timing,'closeRetractSettleSeconds',{type:'number',min:0,max:120,step:.1,help:'0 starts closing after any needed unlock command is acknowledged; retraction is monitored during travel. Above 0 waits for unlocked feedback, then this settling time.'});
    this.input(sg,'Automatically bolt a newly closed door',p,'autoBolt',{type:'checkbox',help:'An external unlock remains in effect until the next operation or restart.'});
    const advanced=el('details');advanced.append(el('summary','Polling and timeouts'));const ag=this.grid(advanced);
    for(const [key,label,min,max] of [['operationPollSeconds','Operation poll',.1,5],['idlePollSeconds','Idle poll',.5,30],['boltTimeoutSeconds','Bolt timeout',1,120],['motionTimeoutSeconds','Movement timeout',5,300],['interruptedOpenMarginSeconds','Extra travel after reversal',0,30]])this.input(ag,label+' (seconds)',p.timing,key,{type:'number',min,max,step:.1});root.append(advanced);
  }
}
