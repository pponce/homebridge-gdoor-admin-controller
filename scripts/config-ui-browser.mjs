import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { validateConfiguration } from '../src/config.js';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve('homebridge-ui/public');
const example=JSON.parse(await readFile('examples/input-routing-config.json','utf8'));
const base=example.controllers[0];base.inputs=base.inputs.slice(0,2);base.keypad={baseUrl:base.bolt.baseUrl,gatewayId:base.bolt.gatewayId,credentialRef:base.bolt.credentialRef,alarmId:1};
Object.assign(base.motorPaths[0].connection,{resourceType:'On/Off switch',modelId:'lumi.switch.acn047',manufacturer:'Aqara'});
const server=http.createServer(async(req,res)=>{try{const file=path.basename(new URL(req.url,'http://test').pathname)||'index.html';if(!['index.html','app.js','editor.js','config-save.js','connections.js','connection-editor.js','debug.js','style.css'].includes(file))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(root,file)));}catch{res.writeHead(404);res.end();}});
server.listen(0,'127.0.0.1');await once(server,'listening');

// Model the native modal's documented APIs and footer. The parent enables its
// validation check when Save is enabled and saves/closes only on the outer Save.
// These are browser integration checks, not a claim to run Angular Homebridge UI.
async function fixture(browser,{mobile,dark,mode='managed'}){
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1200,height:1000}});
  let configuration=validateConfiguration(example),revision=1,reviewed,enabled=false;
  if(mode==='no-keypad')configuration.controllers[0].keypad=null;
  if(mode==='multiple'){const other=structuredClone(configuration.controllers[0]);other.id='second-garage';other.name='Second garage';other.door.doorIndex=1;other.bolt.resourceId='3';other.bolt.uniqueId='example-second-bolt';other.inputs=[];other.motorPaths=[];other.keypad=null;configuration.controllers.push(other);configuration=validateConfiguration(configuration);}
  if(['fault','moving','enabled'].includes(mode))enabled=true;
  let reviews=0,applies=0,nativeSaves=0,probes=0,commissions=0,disables=0,releaseNative;const probedIds=[],savedKeys=['example-tailwind-key','example-deconz-key'];
  let blocks=mode==='initial'?[]:[{platform:'GDoorAndBoltCoordinator',name:'Custom name',_bridge:{username:'synthetic-bridge',port:12345},controllers:configuration.controllers}];
  let localImports=0,debugReads=0,debugRecording=false,debugWrites=0;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('Unexpected native dialog');void d.dismiss();});
  await page.exposeFunction('testRequest',async(name,body)=>{
    if(name==='/debug'){
      debugReads++;if(mode==='debug-unavailable')throw Error('unavailable');
      return {schema:1,capturedAt:new Date().toISOString(),recording:debugRecording,traceMode:debugRecording?'full':'off',publicationMode:'inline',versions:{plugin:'0.4.16',homebridge:'2.4.0',hap:'2.2.2'},connectionInspection:'available',
        controllers:[{garage:'Garage 1',door:'closed',bolt:'locked',busy:mode==='moving',fault:false}],tiles:[],clients:[],events:[],activity:[]};
    }
    if(name==='/debug/recording'){assert.deepEqual(Object.keys(body),['recording']);assert.equal(typeof body.recording,'boolean');assert.notEqual(mode,'moving');debugWrites++;debugRecording=body.recording;return{recording:debugRecording};}
    if(name==='/local-connections')return {candidates:[
      {id:'local-bridge',type:'homebridge',name:'Configured devices',baseUrl:'http://127.0.0.1:51001',canImportPin:true,credentialRef:'local-homebridge-test',detail:'Address and pairing PIN available. Access will be checked when added.'},
      {id:'local-gateway',type:'deconz',name:'Configured deCONZ',baseUrl:'http://192.0.2.60:8080',canImportPin:false,credentialRef:null,detail:'Address from homebridge-deconz. Select a saved deCONZ API key or enter one.'}
    ]};
    if(name==='/local-connections/import'){
      assert.equal(body.id,'local-bridge');localImports++;
      if(mode==='local-unavailable')throw Error('bridge unavailable');
      if(!savedKeys.includes('local-homebridge-test'))savedKeys.push('local-homebridge-test');
      return {saved:true,reference:'local-homebridge-test'};
    }
    if(name==='/load')return{connected:mode!=='initial',settings:{revision,configuration},credentials:savedKeys,adminConnection:mode==='initial'?null:{baseUrl:'http://127.0.0.1:27773',identityFile:'/synthetic/homebridge/gdoorandbolt-coordinator/identity.json'},
      controllers:mode==='initial'?[]:configuration.controllers.map(profile=>({id:profile.id,name:profile.name,status:{bootId:'synthetic-boot',actuationEnabled:enabled,held:enabled?null:'not-commissioned',state:{busy:mode==='moving',fault:mode==='fault'?'synthetic-fault':null}}}))};
    if(name==='/validate')return validateConfiguration(body.configuration,{allowEmpty:true});
    if(name==='/review'){assert.equal(body.revision,revision);reviews++;reviewed=validateConfiguration(body.configuration,{allowEmpty:true});return{review:{token:'review-test',configuration:reviewed,requiresCommissioning:reviewed.controllers.filter(p=>!enabled||!configuration.controllers.some(old=>old.id===p.id&&JSON.stringify({...old,name:p.name})===JSON.stringify(p))).map(p=>p.id)}};}
    if(name==='/cancel'){reviewed=null;return{};}
    if(name==='/apply'){assert.equal(body.token,'review-test');if(enabled&&!reviewed.controllers.every(p=>configuration.controllers.some(old=>old.id===p.id&&JSON.stringify({...old,name:p.name})===JSON.stringify(p))))enabled=false;configuration=reviewed;revision++;applies++;if(mode==='uncertain')throw Error('response lost');return{settings:{revision,configuration}};}
    if(name==='/probe'){probes++;probedIds.push(body.controller);if(mode==='probe-unavailable')throw Error('synthetic unavailable');return{probe:{compatible:probes>1,door:{state:'closed',feedback:'closed-sensor'},bolt:{state:'locked',feedback:'relay'},limitations:[],
      controls:[{id:'physical-keypad',name:'Physical keypad',kind:'input',error:probes===1?'input_alarm_mapping_changed':null}]}};}
    if(name==='/commission'){assert.equal(body.previousControllerStopped,true);assert.equal(body.physicalSetupReviewed,true);enabled=true;commissions++;return{};}
    if(name==='/disable'){assert.equal(body.revision,revision);assert.equal(body.bootId,'synthetic-boot');enabled=false;disables++;return{};}
    if(name==='/credentials'){assert.equal(body.secret,'private-browser-test-key');const exists=savedKeys.includes(body.reference);if(body.mode==='create'&&exists)return{saved:false,reason:'exists'};if(!exists)savedKeys.push(body.reference);else enabled=false;return{saved:true};}
    if(name==='/credentials/delete'){if(body.reference.startsWith('example-'))return{deleted:false,reason:'in-use'};savedKeys.splice(savedKeys.indexOf(body.reference),1);return{deleted:true};}
    if(name==='/deconz'){const row=configuration.controllers[0].motorPaths[0].connection;return{gatewayId:row.gatewayId,
      lights:[{name:'Synthetic Aqara opener',resourceId:row.resourceId,uniqueId:row.uniqueId,resourceType:row.resourceType,modelId:row.modelId,manufacturer:row.manufacturer}],sensors:[],alarms:[]};}
    throw Error('unsupported_browser_request');
  });
  await page.exposeFunction('testGetConfig',()=>structuredClone(blocks));
  await page.exposeFunction('testUpdateConfig',value=>{blocks=structuredClone(value);});
  await page.exposeFunction('testNativeSave',async()=>{
    nativeSaves++;
    if(mode==='native-failure'&&nativeSaves===1)throw Error('native save failed');
    if(mode==='pending'&&nativeSaves===1)await new Promise(resolve=>{releaseNative=resolve;});
    return blocks;
  });
  await page.addInitScript(({dark})=>{
    Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});
    window.confirm=()=>{throw Error('Native confirmation is unavailable in the settings frame');};
    window.nativeSaveDisabled=true;window.nativeClosed=false;window.nativeToasts=[];
    const footer=()=>{
      const button=document.getElementById('native-save');if(button)button.disabled=window.nativeSaveDisabled;
      const check=document.getElementById('native-check');if(check)check.hidden=window.nativeSaveDisabled;
    };
    window.homebridge={
      hideSchemaForm(){},disableSaveButton(){window.nativeSaveDisabled=true;footer();},
      enableSaveButton(){window.nativeSaveDisabled=false;footer();},fixScrollHeight(){},
      toast:{success:message=>{window.nativeToasts.push({type:'success',message});},error:message=>{window.nativeToasts.push({type:'error',message});}},
      async userCurrentLightingMode(){return dark?'dark':'light';},
      getPluginConfig:()=>window.testGetConfig(),updatePluginConfig:config=>window.testUpdateConfig(config),
      savePluginConfig:()=>window.testNativeSave(),request:(name,body)=>window.testRequest(name,body)
    };
    document.addEventListener('DOMContentLoaded',()=>{
      const row=document.createElement('footer');row.id='native-footer';
      row.style.cssText='position:sticky;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:16px 24px;background:#242424;color:#fff;border-top:1px solid #777;z-index:10';
      row.innerHTML='<span style="margin-right:auto">Homebridge settings</span><span id="native-check" style="color:#6ce19b" aria-label="Configuration valid">✓</span><button id="native-save" type="button" style="padding:10px 24px;border-radius:6px">Save</button>';
      document.body.append(row);footer();
      document.getElementById('native-save').onclick=async()=>{await window.homebridge.savePluginConfig();window.nativeClosed=true;};
    });
  },{dark});
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  await page.waitForFunction(()=>document.getElementById('coordinator-ui').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#general-page').isVisible(),true);
  assert.equal(await page.locator('#saved-keys .saved-key').count(),2);
  assert.equal(await page.locator('#credential-secret').inputValue(),'');
  await page.locator('#garages-tab').click();await page.locator('.garage-card').first().waitFor();
  return{page,errors,probedIds,localImports:()=>localImports,debugReads:()=>debugReads,debugWrites:()=>debugWrites,reviews:()=>reviews,disables:()=>disables,configuration:()=>configuration,blocks:()=>blocks,applies:()=>applies,nativeSaves:()=>nativeSaves,probes:()=>probes,commissions:()=>commissions,release:()=>releaseNative?.()};
}
async function review(page){
  await page.getByRole('button',{name:'Review changes',exact:true}).click();
  await page.getByRole('button',{name:'Save configuration',exact:true}).waitFor();
}
async function saved(page){
  await page.waitForFunction(()=>document.getElementById('save-state').dataset.state==='saved'&&document.getElementById('coordinator-ui').getAttribute('aria-busy')==='false');
}
try{
 for(const [browserType,mobile,dark]of [[chromium,false,false],[webkit,true,true]]){
  const browser=await browserType.launch({headless:true});
  try{
   for(const mode of ['enabled','moving','debug-unavailable']){
     const x=await fixture(browser,{mobile,dark,mode}),p=x.page;
     assert.equal(x.debugReads(),0,'No diagnostic requests before opening Debug');
     await p.getByLabel('Garage name',{exact:true}).fill('Unsaved diagnostic test');
     await p.getByRole('button',{name:'Debug',exact:true}).click();
     await p.waitForFunction(()=>!document.getElementById('debug-refresh').disabled);
     assert.equal(await p.locator('#debug-page').isVisible(),true);assert.equal(await p.locator('#garages-page').isVisible(),false);
     assert.equal(await p.locator('#debug-tab').getAttribute('aria-current'),'page');
     if(mode==='debug-unavailable'){
       assert.equal(await p.locator('#debug-recording').isDisabled(),true);
       assert.match(await p.locator('#debug-page').textContent(),/Diagnostic status is unavailable/);
     }else if(mode==='moving'){
       assert.equal(await p.locator('#debug-recording').isDisabled(),true);assert.equal(x.debugWrites(),0);
     }else{
       await p.locator('#debug-recording').click();
       await p.waitForFunction(()=>!document.getElementById('debug-recording').disabled&&document.getElementById('debug-recording').checked);
       assert.equal(x.debugWrites(),1);assert.equal(x.applies(),0);assert.equal(x.nativeSaves(),0);
       const downloaded=p.waitForEvent('download');await p.locator('#debug-download').click();const file=await downloaded;
       assert.match(file.suggestedFilename(),/^garage-diagnostics-.*\.json$/);
       const stream=await file.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
       const report=JSON.parse(Buffer.concat(chunks).toString());assert.equal(report.recording,true);assert.equal(report.controllers[0].garage,'Garage 1');
       await p.waitForFunction(()=>!document.getElementById('debug-recording').disabled);await p.locator('#debug-recording').click();
       await p.waitForFunction(()=>!document.getElementById('debug-recording').disabled&&!document.getElementById('debug-recording').checked);
       assert.equal(x.debugWrites(),2);
       if(process.env.PREVIEW_OUTPUT)await p.screenshot({path:path.join(process.env.PREVIEW_OUTPUT,mobile?'debug-mobile.png':'debug-desktop.png'),fullPage:true});
     }
     const reads=x.debugReads();await p.locator('#general-tab').click();await p.locator('#garages-tab').click();
     assert.equal(x.debugReads(),reads);assert.equal(await p.getByLabel('Garage name',{exact:true}).inputValue(),'Unsaved diagnostic test');
     assert.equal(x.applies(),0);assert.equal(x.commissions(),0);assert.equal(x.disables(),0);assert.equal(x.probes(),0);
     assert.deepEqual(x.errors,[]);await p.close();
   }
   for(const mode of ['enabled','local-unavailable']){
     const x=await fixture(browser,{mobile,dark,mode}),p=x.page;
     await p.locator('#general-tab').click();await p.locator('#shared-type').selectOption('homebridge');
     await p.waitForFunction(()=>document.querySelector('#shared-source option[value="local-bridge"]'));
     await p.locator('#shared-source').selectOption('local-bridge');
     assert.equal(await p.locator('#shared-address').inputValue(),'http://127.0.0.1:51001');
     assert.equal(await p.locator('#shared-key').inputValue(),'__configured__');
     assert.equal(await p.locator('#shared-secret').isVisible(),false);
     assert.equal(x.localImports(),0);
     // Editing the destination must detach the private PIN import.
     await p.locator('#shared-address').fill('http://192.0.2.99:51001');
     assert.notEqual(await p.locator('#shared-key').inputValue(),'__configured__');
     await p.locator('#shared-source').selectOption('');await p.locator('#shared-source').selectOption('local-bridge');
     await p.getByRole('button',{name:'Add connection',exact:true}).click();
     if(mode==='local-unavailable'){
       await p.locator('#notice').filter({hasText:'Could not use this bridge'}).waitFor();
       assert.equal(await p.locator('#shared-source').inputValue(),'local-bridge');
       assert.equal(await p.locator('.shared-connection').filter({hasText:'Configured devices'}).count(),0);
     }else{
       await p.locator('.shared-connection').filter({hasText:'Configured devices'}).waitFor();
       assert.equal(x.localImports(),1);assert.equal(x.applies(),0);
       await review(p);await p.getByRole('button',{name:'Save configuration',exact:true}).click();await saved(p);
       assert.equal(x.configuration().connections.find(c=>c.type==='homebridge').credentialRef,'local-homebridge-test');
       assert.equal(x.blocks()[0].controllers[0].name,x.configuration().controllers[0].name);
       await p.locator('#shared-type').selectOption('deconz');
       await p.waitForFunction(()=>document.querySelector('#shared-source option[value="local-gateway"]'));
       await p.locator('#shared-source').selectOption('local-gateway');
       assert.equal(await p.locator('#shared-address').inputValue(),'http://192.0.2.60:8080');
       assert.equal(await p.locator('#shared-key option[value="__configured__"]').count(),0);
       if(process.env.PREVIEW_OUTPUT)await p.screenshot({path:path.join(process.env.PREVIEW_OUTPUT,mobile?'configured-connections-mobile.png':'configured-connections-desktop.png'),fullPage:true});
     }
     assert.equal(x.probes(),0);assert.equal(x.commissions(),0);assert.equal(x.disables(),0);
     assert.equal(await p.locator('body').evaluate(b=>b.scrollWidth<=innerWidth+1),true);
     assert.deepEqual(x.errors,[]);await p.close();
   }
   const f=await fixture(browser,{mobile,dark}),{page}=f;
   assert.equal(f.probes(),0);assert.equal(f.nativeSaves(),0);
   assert.equal(await page.locator('#native-save').isEnabled(),true);
   assert.equal(await page.locator('html').getAttribute('data-theme'),dark?'dark':'light');
   assert.equal(await page.getByRole('button',{name:'04 Check & Enable'}).count(),0);
   assert.equal(await page.locator('.garage-card').getAttribute('data-state'),'disabled');
   await page.getByRole('button',{name:'Add a garage door',exact:true}).click();
   assert.equal(await page.locator('.garage-card').count(),2);
   assert.equal(await page.locator('.garage-card').last().getAttribute('data-state'),'attention');
   await page.getByRole('button',{name:'Review setup My garage',exact:true}).click();
   await page.getByText('Save this garage door before checking its connections.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Check connections',exact:true}).count(),0);
   await page.getByRole('button',{name:'01 Devices'}).click();
   await page.getByRole('button',{name:'Remove this garage door',exact:true}).click();
   assert.equal(await page.locator('.garage-card').count(),1);
   await page.getByLabel('Garage name',{exact:true}).fill('Test garage');
   assert.equal(await page.locator('#native-save').isDisabled(),true,'Typing must disable native Save before blur');
   assert.equal(await page.locator('#native-check').isVisible(),false);
   await page.getByRole('button',{name:'02 Inputs'}).click();
   assert.match(await page.locator('.route-note').first().textContent(),/HomeKit.*virtual keypad.*Tailwind/);
   assert.equal(await page.locator('.input-profile').count(),1);
   assert.equal(await page.locator('.input-choice').count(),2);
   assert.equal(await page.getByRole('button',{name:'04 Check & Enable'}).count(),0);
   const originalInputName=await page.getByLabel('Control name',{exact:true}).inputValue();
   await page.getByLabel('Control name',{exact:true}).fill('Edited indoor button');
   await page.locator('.input-choice').nth(1).click();
   assert.equal(await page.locator('.input-profile').count(),1);
   assert.equal(await page.getByLabel('Control door using',{exact:true}).locator('option[value="primary"]').textContent(),'Garage opener (Tailwind)');
   await page.locator('.input-choice').nth(0).click();
   assert.equal(await page.getByLabel('Control name',{exact:true}).inputValue(),'Edited indoor button');
   await page.getByLabel('Control name',{exact:true}).fill(originalInputName);
   await page.getByRole('button',{name:'Add a button or keypad',exact:true}).click();
   assert.equal(await page.locator('.input-choice').count(),3);
   assert.equal(await page.locator('.input-choice').last().getAttribute('aria-pressed'),'true');
   await page.getByRole('button',{name:'Remove control',exact:true}).click();
   assert.equal(await page.locator('.input-choice').count(),2);
   await page.locator('.input-choice').first().click();
   if(process.env.PREVIEW_OUTPUT)await page.screenshot({path:path.join(process.env.PREVIEW_OUTPUT,mobile?'inputs-mobile.png':'inputs-desktop.png'),fullPage:true});
   const virtual=page.locator('[data-section=virtual-keypad]');
   assert.equal(await virtual.getByLabel('Virtual keypad alarm',{exact:true}).inputValue(),'physical:physical-keypad');
   await virtual.getByLabel('Virtual keypad alarm',{exact:true}).selectOption('manual');
   assert.equal(await virtual.getByLabel('Virtual keypad alarm',{exact:true}).inputValue(),'manual');
   assert.equal(await virtual.getByLabel('Alarm number',{exact:true}).inputValue(),'1');
   await virtual.getByLabel('Virtual keypad alarm',{exact:true}).selectOption('off');
   assert.equal(await virtual.getByLabel('Alarm number',{exact:true}).count(),0);
   assert.equal(await page.locator('.input-choice').count(),2,'Virtual keypad does not remove physical controls');
   await virtual.getByLabel('Virtual keypad alarm',{exact:true}).selectOption('physical:physical-keypad');
   assert.equal(await virtual.getByLabel('Alarm number',{exact:true}).inputValue(),'1');
   assert.equal(f.probes(),0);assert.equal(f.commissions(),0);
   await page.locator('.device-block').filter({has:page.getByRole('heading',{name:'Additional motor path',exact:true})}).getByRole('button',{name:'Find devices',exact:true}).first().click();
   await page.getByLabel('Discovered motor',{exact:true}).selectOption('0');
   await page.getByText('Selected: lumi.switch.acn047 · resource 2',{exact:true}).waitFor();
   await page.getByRole('button',{name:'03 Behavior'}).click();
   await page.getByLabel('Before opening (seconds)',{exact:true}).fill('3');
   await review(page);assert.equal(f.applies(),0);
   assert.equal(await page.locator('#native-save').isDisabled(),true);
   await page.getByRole('button',{name:'Save configuration',exact:true}).click();await saved(page);
   assert.equal(f.applies(),1);assert.equal(f.nativeSaves(),1);
   assert.equal(f.configuration().controllers[0].timing.openRetractSettleSeconds,3);
   assert.deepEqual(f.blocks()[0]._bridge,{username:'synthetic-bridge',port:12345});
   assert.equal(await page.locator('#native-save').isEnabled(),true);
   assert.equal(await page.locator('#native-check').isVisible(),true);
   assert.equal(await page.evaluate(()=>nativeClosed),false,'Plugin save must keep the modal open');
   assert.equal(await page.evaluate(()=>nativeToasts.some(t=>t.type==='success'&&t.message==='Configuration saved.')),true);
   assert.equal(await page.getByRole('button',{name:'04 Check & Enable'}).count(),0);
   await page.getByRole('button',{name:'Enable Test garage',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'04 Check & Enable'}).count(),0);
   assert.equal(await page.locator('.garage-card .card-checks').count(),1);
   assert.equal(await page.getByRole('button',{name:'Enable this garage door',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Check connections',exact:true}).click();
   await page.locator('.commission-result').filter({hasText:'Physical keypad: input_alarm_mapping_changed'}).waitFor();
   assert.equal(await page.locator('.garage-card').getAttribute('data-state'),'attention');
   assert.equal(f.probes(),1);assert.equal(await page.locator('.commission-result').filter({hasText:'Connections verified'}).count(),0);
   await page.getByRole('button',{name:'Check connections',exact:true}).click();
   await page.locator('.commission-result').filter({hasText:'Connections verified'}).waitFor();
   assert.equal(f.probes(),2);
   for(const input of await page.locator('.commission-row input[type=checkbox]').all())await input.check();
   await page.getByRole('button',{name:'Enable this garage door',exact:true}).click();await saved(page);
   await page.locator('.commission-result').filter({hasText:'Control is enabled'}).waitFor();
   assert.equal(f.commissions(),1);assert.equal(f.applies(),1);
   assert.equal(await page.locator('.garage-card').getAttribute('data-state'),'enabled');
   await page.getByRole('button',{name:'Disable Test garage',exact:true}).click();await saved(page);
   assert.equal(f.disables(),1);assert.equal(f.applies(),1);
   assert.equal(await page.locator('.garage-card').getAttribute('data-state'),'disabled');
   assert.equal(await page.getByRole('button',{name:'Enable Test garage',exact:true}).isEnabled(),true);
   assert.equal(await page.locator('#native-save').isEnabled(),true);
   // Private-key saving must preserve a draft and must not enable bottom Save.
   await page.getByRole('button',{name:'01 Devices'}).click();
   await page.getByLabel('Garage name',{exact:true}).fill('Unsaved garage name');
   await page.locator('#general-tab').click();
   assert.equal(await page.locator('#garage-overview .overview-row').getAttribute('data-state'),'disabled');
   await page.locator('#credential-reference').fill('private-key');
   await page.locator('#credential-secret').fill('private-browser-test-key');
   await page.getByRole('button',{name:'Create connection key'}).click();
   await page.locator('#notice').filter({hasText:'saved privately'}).waitFor();
   assert.equal(await page.locator('#credential-secret').inputValue(),'');
   assert.equal(await page.locator('#saved-keys .saved-key').count(),3);
   assert.equal(await page.locator('#credential-form').evaluate(form=>!!(form.compareDocumentPosition(document.getElementById('saved-keys'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
   await page.locator('#credential-reference').fill('private-key');await page.locator('#credential-secret').fill('private-browser-test-key');
   await page.getByRole('button',{name:'Create connection key',exact:true}).click();
   await page.locator('#notice').filter({hasText:'That name is already saved'}).waitFor();
   assert.equal(await page.locator('#credential-secret').inputValue(),'');
   await page.getByRole('button',{name:'Delete key private-key',exact:true}).click();
   await page.getByRole('button',{name:'Cancel deletion',exact:true}).click();
   assert.equal(await page.locator('#saved-keys .saved-key').count(),3);
   await page.getByRole('button',{name:'Delete key private-key',exact:true}).click();
   await page.getByRole('button',{name:'Delete saved key',exact:true}).click();
   await page.locator('#notice').filter({hasText:'Connection key deleted'}).waitFor();
   assert.equal(await page.locator('#saved-keys .saved-key').count(),2);
   await page.getByRole('button',{name:'Delete key example-tailwind-key',exact:true}).click();
   await page.locator('.key-delete').filter({hasText:'Used by Unsaved garage name'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Delete saved key',exact:true}).count(),0);
   await page.getByRole('button',{name:'Cancel deletion',exact:true}).click();
   await page.getByRole('button',{name:'Replace key example-tailwind-key',exact:true}).click();
   assert.equal(await page.locator('#credential-reference').inputValue(),'example-tailwind-key');
   assert.equal(await page.locator('#credential-reference').getAttribute('readonly'),'');
   assert.equal(await page.locator('#credential-secret').inputValue(),'','Never prefill a secret or mask as a replacement');
   await page.locator('#credential-secret').fill('private-browser-test-key');
   await page.getByRole('button',{name:'Replace connection key',exact:true}).click();
   await page.waitForFunction(()=>document.getElementById('credential-reference').value===''&&!document.getElementById('workspace').disabled);
   assert.equal(await page.locator('#saved-keys .saved-key').count(),2,'Replacing a key keeps its name');
   assert.equal(await page.locator('#credential-secret').inputValue(),'');
   await page.getByRole('button',{name:'Replace key example-tailwind-key',exact:true}).click();
   await page.getByRole('button',{name:'Cancel replacement',exact:true}).click();
   assert.equal(await page.locator('#credential-reference').inputValue(),'');
   await page.locator('#garages-tab').click();
   assert.equal(await page.getByLabel('Garage name',{exact:true}).inputValue(),'Unsaved garage name');
   assert.equal(await page.locator('#native-save').isDisabled(),true);
   await page.getByRole('button',{name:'Discard changes',exact:true}).click();await saved(page);
   assert.equal(await page.getByLabel('Garage name',{exact:true}).inputValue(),'Test garage');
   await page.locator('#general-tab').click();
   await page.getByRole('button',{name:'Configure Test garage',exact:true}).click();
   await page.getByRole('button',{name:'Enable Test garage',exact:true}).click();
   assert.equal(await page.locator('#garages-page').isVisible(),true);
   assert.equal(await page.locator('.commission-row').count(),1);
   assert.equal(await page.getByRole('button',{name:'04 Check & Enable'}).count(),0);
   assert.equal(await page.locator('.garage-card .card-checks').count(),1);
   assert.equal(await page.getByRole('button',{name:'Check connections',exact:true}).isEnabled(),true);
   await page.locator('#general-tab').click();
   // Live Homebridge theme changes override the OS/default theme.
   await page.evaluate(()=>document.body.classList.add('dark-mode'));
   await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
   await page.evaluate(()=>{document.body.classList.remove('dark-mode');document.body.classList.add('config-ui-x-light');});
   await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
   if(dark)await page.evaluate(()=>document.body.classList.add('dark-mode'));
   assert.equal(await page.locator('body').evaluate(b=>b.scrollWidth<=innerWidth+1),true);
   assert.deepEqual(f.errors,[]);
   if(process.env.PREVIEW_OUTPUT){
     await mkdir(process.env.PREVIEW_OUTPUT,{recursive:true});
     await page.screenshot({path:path.join(process.env.PREVIEW_OUTPUT,mobile?'coordinator-mobile.png':'coordinator-desktop.png'),fullPage:true});
   }
   await page.locator('#native-save').click();await page.waitForFunction(()=>nativeClosed);
   assert.equal(f.nativeSaves(),2);assert.equal(f.applies(),1,'Native bottom Save must not reapply managed settings');
   await page.close();

   {
     const x=await fixture(browser,{mobile,dark,mode:'enabled'}),p=x.page;
     await p.getByLabel('Garage name',{exact:true}).fill('Renamed garage');
     assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'enabled','A name draft retains live enabled color');
     assert.equal(await p.locator('.garage-card .garage-status').textContent(),'Enabled · Unsaved changes');
     assert.equal(await p.locator('#native-save').isDisabled(),true);
     // Click the newly shown card button directly after typing, without an
     // intervening blur: this is the owner's lost-in-the-form route.
     await p.getByRole('button',{name:'Review changes Renamed garage',exact:true}).click();
     await p.locator('.garage-card #review').waitFor();
     assert.match(await p.locator('#review').textContent(),/Existing enabled garage doors will stay enabled/);
     assert.match(await p.locator('#review').textContent(),/Rename garage door: .* → Renamed garage/);
     assert.match(await p.locator('#review').textContent(),/all pending configuration changes/);
     assert.equal(await p.locator('.card-checks').count(),0);
     assert.equal(await p.locator('#review h2').evaluate(node=>document.activeElement===node),true);
     assert.equal(x.applies(),0);assert.equal(x.probes(),0);assert.equal(x.reviews(),1);
     assert.equal(await p.locator('#review-button').isVisible(),true,'The bottom review route stays available');
     await p.locator('#review-button').click();
     await p.locator('#review-slot #review').waitFor();
     assert.equal(x.reviews(),1,'Both routes share the same review token');
     await p.getByRole('button',{name:'Review changes Renamed garage',exact:true}).click();
     await p.locator('.garage-card #review').waitFor();
     assert.equal(x.reviews(),1);
     await p.getByRole('button',{name:'Keep editing',exact:true}).click();
     await p.waitForFunction(()=>!document.getElementById('workspace').disabled);
     assert.equal(await p.locator('#review').isVisible(),false);
     await p.getByRole('button',{name:'Review changes Renamed garage',exact:true}).click();
     await p.locator('.garage-card #review').waitFor();
     // Editing after a card review must invalidate it, not leave a stale Save.
     await p.getByLabel('Garage name',{exact:true}).fill('Final garage name');
     assert.equal(await p.getByRole('button',{name:'Save configuration',exact:true}).count(),0);
     await p.getByRole('button',{name:'Review changes Final garage name',exact:true}).click();
     await p.locator('.garage-card #review').waitFor();
     assert.equal(x.reviews(),3);
     await p.getByRole('button',{name:'Save configuration',exact:true}).click();await saved(p);
     assert.equal(x.configuration().controllers[0].name,'Final garage name');
     assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'enabled');
     assert.equal(await p.locator('.garage-card .garage-status').textContent(),'Enabled');
     assert.equal(await p.locator('#native-save').isEnabled(),true);
     assert.equal(await p.locator('#native-check').isVisible(),true);
     assert.equal(await p.evaluate(()=>nativeToasts.some(t=>t.type==='success'&&t.message==='Configuration saved.')),true);
     assert.equal(x.applies(),1);assert.equal(x.nativeSaves(),1);
     assert.equal(x.probes(),0);assert.equal(x.commissions(),0);assert.equal(x.disables(),0);
     // A control-setting edit still warns and reviews from the same card.
     await p.getByRole('button',{name:'03 Behavior'}).click();
     await p.getByLabel('Before opening (seconds)',{exact:true}).fill('9');
     assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'attention');
     await p.getByRole('button',{name:'Review changes Final garage name',exact:true}).click();
     await p.locator('.garage-card #review').waitFor();
     assert.match(await p.locator('#review').textContent(),/1 garage door will need connection checks/);
     if(process.env.PREVIEW_OUTPUT){await p.screenshot({path:path.join(process.env.PREVIEW_OUTPUT,mobile?'card-review-mobile.png':'card-review-desktop.png'),fullPage:true});}
     await p.getByRole('button',{name:'Discard changes',exact:true}).click();await saved(p);
     assert.equal(await p.locator('#review').isVisible(),false);
     assert.equal(x.applies(),1);
     assert.equal(await p.locator('body').evaluate(b=>b.scrollWidth<=innerWidth+1),true);
     assert.deepEqual(x.errors,[]);await p.close();
   }
   {
     const x=await fixture(browser,{mobile,dark,mode:'enabled'}),p=x.page;
     await p.getByRole('button',{name:'Add a garage door',exact:true}).click();
     assert.equal(await p.locator('.garage-card').first().getAttribute('data-state'),'enabled');
     assert.equal(await p.locator('.garage-card').last().getAttribute('data-state'),'attention');
     assert.equal(await p.locator('.garage-card').first().locator('.garage-status').textContent(),'Enabled');
     await p.getByRole('button',{name:'Remove this garage door',exact:true}).click();
     assert.equal(await p.locator('.garage-card').count(),1);
     assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'enabled');
     assert.equal(await p.locator('#native-save').isEnabled(),true,'Removing the only new draft restores a clean configuration');
     assert.equal(x.applies(),0);assert.equal(x.disables(),0);assert.equal(x.commissions(),0);
     await p.getByRole('button',{name:'01 Devices'}).click();
     await p.getByLabel('Garage name',{exact:true}).fill('Pending name');
     await p.getByRole('button',{name:'Add a garage door',exact:true}).click();
     await p.getByRole('button',{name:'Remove this garage door',exact:true}).click();
     assert.equal(await p.getByLabel('Garage name',{exact:true}).inputValue(),'Pending name');
     assert.equal(await p.locator('#native-save').isDisabled(),true,'Removing a draft preserves other edits');
     await p.getByRole('button',{name:'Discard changes',exact:true}).click();await saved(p);
     await p.getByRole('button',{name:'Remove this garage door',exact:true}).click();
     assert.equal(await p.locator('.garage-card').count(),0);assert.equal(x.configuration().controllers.length,1,'Saved garage removal remains pending');
     await p.getByRole('button',{name:'Discard changes',exact:true}).click();await saved(p);
     assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'enabled');
     assert.deepEqual(x.errors,[]);await p.close();
   }
   {
     const x=await fixture(browser,{mobile,dark,mode:'enabled'}),p=x.page;
     const original=structuredClone(x.configuration().controllers);
     await p.locator('#general-tab').click();
     assert.equal(await p.locator('.shared-connection').count(),2,'Existing addresses migrate without re-entry');
     assert.match(await p.locator('.connection-purposes').textContent(),/buttons and keypads/);
     assert.match(await p.locator('.connection-purposes').textContent(),/separate from the web admin/);
     await p.getByRole('button',{name:'Edit connection Tailwind 1',exact:true}).click();
     await p.locator('#shared-name').fill('Driveway Tailwind');
     await p.locator('#shared-door-count').selectOption('1');
     assert.equal(await p.locator('#native-save').isDisabled(),true);
     await p.getByRole('button',{name:'Update connection',exact:true}).click();
     await p.locator('#notice').filter({hasText:'Review and save'}).waitFor();
     await review(p);
     await p.locator('#shared-name').fill('Unfinished next connection');
     assert.equal(await p.getByRole('button',{name:'Save configuration',exact:true}).count(),0,'A pending form invalidates an earlier review');
     assert.equal(await p.locator('#native-save').isDisabled(),true);
     await p.getByRole('button',{name:'Cancel connection edit',exact:true}).click();
     await review(p);await p.getByRole('button',{name:'Save configuration',exact:true}).click();await saved(p);
     assert.deepEqual(x.configuration().controllers,original,'Catalog-only edits retain resolved hardware profiles');
     assert.equal(await p.locator('.overview-row').getAttribute('data-state'),'enabled');
     assert.deepEqual(x.blocks()[0].connections,x.configuration().connections);
     await p.locator('#garages-tab').click();
     assert.equal(await p.getByLabel('Tailwind connection',{exact:true}).locator('option:checked').textContent(),'Driveway Tailwind');
     assert.equal(await p.getByLabel('Tailwind door',{exact:true}).locator('option').count(),1);
     assert.equal(await p.getByLabel('Tailwind door',{exact:true}).locator('option:checked').textContent(),'Door 1');
     await p.getByRole('button',{name:'Manage connections in General',exact:true}).first().click();
     assert.equal(await p.locator('#general-page').isVisible(),true);
     await p.locator('#shared-type').selectOption('homebridge');
     assert.match(await p.locator('.connection-form .hint,.connection-form .help').last().textContent(),/accessory port/);
     await p.locator('#shared-type').selectOption('deconz');
     await p.locator('#shared-name').fill('Other gateway');await p.locator('#shared-address').fill('192.0.2.55:8080');
     await p.locator('#shared-key').selectOption('__new__');await p.locator('#shared-new-key-name').fill('other-gateway-key');
     await p.locator('#shared-secret').fill('private-browser-test-key');
     await p.getByRole('button',{name:'Add connection',exact:true}).click();
     await p.locator('.shared-connection').filter({hasText:'Other gateway'}).waitFor();
     assert.equal(await p.locator('#shared-secret').inputValue(),'');
     assert.equal(await p.locator('.overview-row').getAttribute('data-state'),'enabled');
     await p.locator('#garages-tab').click();await p.getByRole('button',{name:'Add a garage door',exact:true}).click();
     await p.getByLabel('Tailwind connection',{exact:true}).selectOption({label:'Driveway Tailwind'});
     await p.getByLabel('deCONZ connection',{exact:true}).selectOption({label:'Other gateway'});
     assert.match(await p.locator('.connection-summary').last().textContent(),/http:\/\/192.0.2.55:8080/);
     assert.equal(await p.locator('.garage-card').first().getAttribute('data-state'),'enabled');
     await p.getByRole('button',{name:'Remove this garage door',exact:true}).click();
     await review(p);await p.getByRole('button',{name:'Save configuration',exact:true}).click();await saved(p);
     assert.equal(x.configuration().connections.length,3);assert.deepEqual(x.configuration().controllers,original);
     await p.locator('#general-tab').click();await p.getByRole('button',{name:'Edit connection deCONZ 1',exact:true}).click();
     await p.locator('#shared-address').fill('192.0.2.56:8080');await p.getByRole('button',{name:'Update connection',exact:true}).click();
     await p.locator('#garages-tab').click();await p.getByRole('button',{name:'02 Inputs'}).click();
     const summaries=await p.locator('.connection-summary').allTextContents();assert.ok(summaries.length>=3);assert.ok(summaries.every(text=>text.includes('192.0.2.56:8080')));
     await review(p);await p.getByRole('button',{name:'Save configuration',exact:true}).click();await saved(p);
     assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'disabled');
     assert.equal(x.configuration().controllers[0].bolt.baseUrl,'http://192.0.2.56:8080');
     assert.equal(x.probes(),0);assert.equal(x.commissions(),0);assert.equal(x.disables(),0);
     assert.equal(JSON.stringify(x.blocks()).includes('private-browser-test-key'),false);
     assert.deepEqual(x.errors,[]);assert.equal(await p.locator('body').evaluate(b=>b.scrollWidth<=innerWidth+1),true);
     if(process.env.PREVIEW_OUTPUT){await p.locator('#general-tab').click();await p.screenshot({path:path.join(process.env.PREVIEW_OUTPUT,mobile?'connections-mobile.png':'connections-desktop.png'),fullPage:true});}
     await p.close();
   }
   for(const mode of ['multiple','no-keypad','fault','moving','probe-unavailable']){
     const x=await fixture(browser,{mobile,dark,mode}),p=x.page;
     if(mode==='multiple'){
       await p.locator('#general-tab').click();
       await p.getByRole('button',{name:'Configure Second garage',exact:true}).click();
       await p.getByRole('button',{name:'Enable Second garage',exact:true}).click();
       assert.equal(await p.locator('.card-checks').getAttribute('aria-label'),'Checks for Second garage');
       assert.equal(await p.locator('.commission-row').count(),1);
       await p.getByRole('button',{name:'Check connections',exact:true}).click();
       await p.waitForFunction(()=>!document.getElementById('workspace').disabled);
       assert.deepEqual(x.probedIds,['second-garage']);
       await p.getByRole('button',{name:'02 Inputs'}).click();
       assert.equal(await p.locator('.garage-card .card-checks').count(),1);
       const select=p.getByLabel('Virtual keypad alarm',{exact:true});
       assert.equal(await select.locator('option').count(),2,'No physical-keypad choice without a configured keypad');
     }else if(mode==='no-keypad'){
       await p.getByRole('button',{name:'02 Inputs'}).click();
       const virtual=p.locator('[data-section=virtual-keypad]');
       assert.equal(await virtual.getByLabel('Virtual keypad alarm',{exact:true}).inputValue(),'off');
       assert.equal(await virtual.getByLabel('Alarm number',{exact:true}).count(),0);
       await virtual.getByLabel('Virtual keypad alarm',{exact:true}).selectOption('manual');
       await virtual.getByLabel('Alarm number',{exact:true}).fill('2');
       await review(p);await p.getByRole('button',{name:'Save configuration',exact:true}).click();await saved(p);
       assert.equal(x.configuration().controllers[0].keypad.alarmId,2);
       assert.equal(x.configuration().controllers[0].inputs.length,2);
       assert.equal(x.probes(),0);assert.equal(x.commissions(),0);
     }else if(mode==='probe-unavailable'){
       await p.getByRole('button',{name:'Enable '+base.name,exact:true}).click();
       await p.getByRole('button',{name:'Check connections',exact:true}).click();
       await p.locator('.commission-result').filter({hasText:'Connection check could not complete'}).waitFor();
       assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'attention');
     }else if(mode==='fault'){
       assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'attention');
       assert.equal(await p.locator('.garage-status').filter({hasText:'Needs attention'}).count(),2);
     }else{
       assert.equal(await p.locator('.garage-card').getAttribute('data-state'),'enabled');
       assert.equal(await p.getByRole('button',{name:'Disable '+base.name,exact:true}).isDisabled(),true);
     }
     assert.equal(await p.locator('body').evaluate(b=>b.scrollWidth<=innerWidth+1),true);
     assert.deepEqual(x.errors,[]);await p.close();
   }
   for(const mode of ['initial','native-failure','pending','uncertain']){
     const x=await fixture(browser,{mobile,dark,mode}),p=x.page;
     if(mode==='initial')assert.equal(await p.locator('#native-save').isDisabled(),true);
     else await p.getByLabel('Garage name',{exact:true}).fill('Reviewed garage name');
     await review(p);await p.getByRole('button',{name:'Save configuration',exact:true}).click();
     if(mode==='pending'){
       await p.waitForFunction(()=>document.getElementById('workspace').disabled);
       assert.equal(await p.locator('#native-save').isDisabled(),true);
       assert.equal(await p.evaluate(()=>nativeToasts.some(t=>t.type==='success')),false);
       // Wait for the native save call itself, not just the outer busy flag.
       for(let i=0;i<100&&x.nativeSaves()===0;i++)await p.waitForTimeout(20);
       assert.equal(x.nativeSaves(),1);x.release();
     }
     if(mode==='native-failure'){
       await p.locator('#notice').filter({hasText:'Retry Homebridge save'}).waitFor();
       assert.equal(await p.locator('#native-save').isDisabled(),true);
       assert.equal(await p.getByLabel('Garage name',{exact:true}).isDisabled(),true);
       assert.equal(await p.evaluate(()=>nativeToasts.some(t=>t.type==='success')),false);
       await p.getByRole('button',{name:'Retry Homebridge save',exact:true}).click();
     }
     if(mode==='uncertain'){
       await p.locator('#notice').filter({hasText:'Reload saved settings'}).waitFor();
       assert.equal(await p.locator('#native-save').isDisabled(),true);assert.equal(x.nativeSaves(),0);
       await p.getByRole('button',{name:'Reload saved settings',exact:true}).click();
       await saved(p);assert.equal(x.applies(),1);
       assert.equal(await p.getByLabel('Garage name',{exact:true}).inputValue(),'Reviewed garage name');
       await p.locator('#native-save').click();await p.waitForFunction(()=>nativeClosed);
       assert.equal(x.applies(),1);
     }else{
       await saved(p);assert.equal(await p.locator('#native-save').isEnabled(),true);
       assert.equal(x.applies(),mode==='initial'?0:1);
       assert.equal(await p.evaluate(()=>nativeToasts.filter(t=>t.type==='success').length),1);
     }
     assert.deepEqual(x.errors,[]);await p.close();
   }
  }finally{await browser.close();}
 }
 console.log('Desktop Chromium/mobile WebKit passed guided editing, modeled native Save/check/toasts, setup and managed saves, delayed/failed native save, uncertain apply reload, metadata preservation, commissioning, General overview, inline garage checks, per-garage draft status, dialog-free draft removal, masked key creation/replacement/deletion, optional virtual keypad setup, draft-safe keys, theme switching and overflow.');
}catch(e){if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'result='+String(e.stack||e).replaceAll('\n',' ').slice(0,2000)+'\n');throw e;}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
