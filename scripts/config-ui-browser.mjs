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
const server=http.createServer(async(req,res)=>{try{const file=path.basename(new URL(req.url,'http://test').pathname)||'index.html';if(!['index.html','app.js','editor.js','config-save.js','style.css'].includes(file))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(root,file)));}catch{res.writeHead(404);res.end();}});
server.listen(0,'127.0.0.1');await once(server,'listening');

// Model the native modal's documented APIs and footer. The parent enables its
// validation check when Save is enabled and saves/closes only on the outer Save.
// These are browser integration checks, not a claim to run Angular Homebridge UI.
async function fixture(browser,{mobile,dark,mode='managed'}){
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1200,height:1000}});
  let configuration=validateConfiguration(example),revision=1,reviewed,enabled=false;
  if(mode==='no-keypad')configuration.controllers[0].keypad=null;
  if(mode==='multiple'){const other=structuredClone(configuration.controllers[0]);other.id='second-garage';other.name='Second garage';other.door.doorIndex=1;other.bolt.resourceId='3';other.bolt.uniqueId='example-second-bolt';other.inputs=[];other.motorPaths=[];other.keypad=null;configuration.controllers.push(other);configuration=validateConfiguration(configuration);}
  if(mode==='fault'||mode==='moving')enabled=true;
  let applies=0,nativeSaves=0,probes=0,commissions=0,disables=0,releaseNative;const probedIds=[],savedKeys=['example-tailwind-key','example-deconz-key'];
  let blocks=mode==='initial'?[]:[{platform:'GDoorAndBoltCoordinator',name:'Custom name',_bridge:{username:'synthetic-bridge',port:12345},controllers:configuration.controllers}];
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.exposeFunction('testRequest',async(name,body)=>{
    if(name==='/load')return{connected:mode!=='initial',settings:{revision,configuration},credentials:savedKeys,adminConnection:mode==='initial'?null:{baseUrl:'http://127.0.0.1:27773',identityFile:'/synthetic/homebridge/gdoorandbolt-coordinator/identity.json'},
      controllers:mode==='initial'?[]:configuration.controllers.map(profile=>({id:profile.id,name:profile.name,status:{bootId:'synthetic-boot',actuationEnabled:enabled,held:enabled?null:'not-commissioned',state:{busy:mode==='moving',fault:mode==='fault'?'synthetic-fault':null}}}))};
    if(name==='/validate')return validateConfiguration(body.configuration,{allowEmpty:true});
    if(name==='/review'){assert.equal(body.revision,revision);reviewed=validateConfiguration(body.configuration);return{review:{token:'review-test',configuration:reviewed,requiresCommissioning:[base.id]}};}
    if(name==='/cancel'){reviewed=null;return{};}
    if(name==='/apply'){assert.equal(body.token,'review-test');configuration=reviewed;revision++;applies++;if(mode==='uncertain')throw Error('response lost');return{settings:{revision,configuration}};}
    if(name==='/probe'){probes++;probedIds.push(body.controller);return{probe:{compatible:probes>1,door:{state:'closed',feedback:'closed-sensor'},bolt:{state:'locked',feedback:'relay'},limitations:[],
      controls:[{id:'physical-keypad',name:'Physical keypad',kind:'input',error:probes===1?'input_alarm_mapping_changed':null}]}};}
    if(name==='/commission'){assert.equal(body.previousControllerStopped,true);assert.equal(body.physicalSetupReviewed,true);enabled=true;commissions++;return{};}
    if(name==='/disable'){assert.equal(body.revision,revision);assert.equal(body.bootId,'synthetic-boot');enabled=false;disables++;return{};}
    if(name==='/credentials'){assert.equal(body.secret,'private-browser-test-key');if(!savedKeys.includes(body.reference))savedKeys.push(body.reference);enabled=false;return{saved:true};}
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
  return{page,errors,probedIds,disables:()=>disables,configuration:()=>configuration,blocks:()=>blocks,applies:()=>applies,nativeSaves:()=>nativeSaves,probes:()=>probes,commissions:()=>commissions,release:()=>releaseNative?.()};
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
   const f=await fixture(browser,{mobile,dark}),{page}=f;
   assert.equal(f.probes(),0);assert.equal(f.nativeSaves(),0);
   assert.equal(await page.locator('#native-save').isEnabled(),true);
   assert.equal(await page.locator('html').getAttribute('data-theme'),dark?'dark':'light');
   assert.equal(await page.locator('#commissioning').count(),0);
   assert.equal(await page.locator('.garage-card').getAttribute('data-state'),'disabled');
   await page.getByRole('button',{name:'Add a garage door',exact:true}).click();
   assert.equal(await page.locator('.garage-card').count(),2);
   assert.equal(await page.locator('.garage-card').last().getAttribute('data-state'),'attention');
   await page.getByRole('button',{name:'04 Check & Enable'}).click();
   await page.getByText('Save this garage door before checking its connections.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Check connections',exact:true}).count(),0);
   await page.getByRole('button',{name:'01 Devices'}).click();
   await page.getByRole('button',{name:'Remove this garage',exact:true}).click();
   assert.equal(await page.locator('.garage-card').count(),1);
   await page.getByLabel('Garage name',{exact:true}).fill('Test garage');
   assert.equal(await page.locator('#native-save').isDisabled(),true,'Typing must disable native Save before blur');
   assert.equal(await page.locator('#native-check').isVisible(),false);
   await page.getByRole('button',{name:'02 Inputs'}).click();
   assert.match(await page.locator('.route-note').first().textContent(),/HomeKit.*virtual keypad.*Tailwind/);
   assert.equal(await page.locator('.input-profile').count(),2);
   assert.equal(await page.locator('#commissioning').count(),0);
   const virtual=page.locator('[data-section=virtual-keypad]');
   assert.equal(await virtual.getByLabel('Virtual keypad alarm',{exact:true}).inputValue(),'physical:physical-keypad');
   await virtual.getByLabel('Virtual keypad alarm',{exact:true}).selectOption('manual');
   assert.equal(await virtual.getByLabel('Virtual keypad alarm',{exact:true}).inputValue(),'manual');
   assert.equal(await virtual.getByLabel('Alarm number',{exact:true}).inputValue(),'1');
   await virtual.getByLabel('Virtual keypad alarm',{exact:true}).selectOption('off');
   assert.equal(await virtual.getByLabel('Alarm number',{exact:true}).count(),0);
   assert.equal(await page.locator('.input-profile').count(),2,'Virtual keypad does not remove physical controls');
   await virtual.getByLabel('Virtual keypad alarm',{exact:true}).selectOption('physical:physical-keypad');
   assert.equal(await virtual.getByLabel('Alarm number',{exact:true}).inputValue(),'1');
   assert.equal(f.probes(),0);assert.equal(f.commissions(),0);
   await page.getByRole('button',{name:'Find devices',exact:true}).first().click();
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
   assert.equal(await page.locator('#commissioning').count(),0);
   await page.getByRole('button',{name:'Enable Test garage',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'04 Check & Enable'}).getAttribute('aria-current'),'step');
   assert.equal(await page.getByRole('button',{name:'Enable this garage door',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Check connections'}).click();
   await page.locator('.commission-result').filter({hasText:'Physical keypad: input_alarm_mapping_changed'}).waitFor();
   assert.equal(await page.locator('.garage-card').getAttribute('data-state'),'attention');
   assert.equal(f.probes(),1);assert.equal(await page.locator('.commission-result').filter({hasText:'Connections verified'}).count(),0);
   await page.getByRole('button',{name:'Check connections'}).click();
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
   assert.equal(await page.locator('#garage-overview .overview-row').getAttribute('data-state'),'attention');
   await page.locator('#credential-reference').fill('private-key');
   await page.locator('#credential-secret').fill('private-browser-test-key');
   await page.getByRole('button',{name:'Save connection key'}).click();
   await page.locator('#notice').filter({hasText:'saved privately'}).waitFor();
   assert.equal(await page.locator('#credential-secret').inputValue(),'');
   assert.equal(await page.locator('#saved-keys .saved-key').count(),3);
   await page.getByRole('button',{name:'Replace key example-tailwind-key',exact:true}).click();
   assert.equal(await page.locator('#credential-reference').inputValue(),'example-tailwind-key');
   assert.equal(await page.locator('#credential-reference').getAttribute('readonly'),'');
   assert.equal(await page.locator('#credential-secret').inputValue(),'','Never prefill a secret or mask as a replacement');
   await page.locator('#credential-secret').fill('private-browser-test-key');
   await page.getByRole('button',{name:'Replace connection key',exact:true}).click();
   await page.waitForFunction(()=>document.getElementById('credential-reference').value===''&&!document.getElementById('workspace').disabled);
   assert.equal(await page.locator('#saved-keys .saved-key').count(),3,'Replacing a key keeps its name');
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
   await page.getByRole('button',{name:'Check & Enable Test garage',exact:true}).click();
   assert.equal(await page.locator('#garages-page').isVisible(),true);
   assert.equal(await page.locator('.commission-row').count(),1);
   assert.equal(await page.getByRole('button',{name:'04 Check & Enable'}).getAttribute('aria-current'),'step');
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

   for(const mode of ['multiple','no-keypad','fault','moving']){
     const x=await fixture(browser,{mobile,dark,mode}),p=x.page;
     if(mode==='multiple'){
       await p.locator('#general-tab').click();
       await p.getByRole('button',{name:'Check & Enable Second garage',exact:true}).click();
       assert.equal(await p.locator('.commission-row h3').textContent(),'Second garage');
       assert.equal(await p.locator('.commission-row').count(),1);
       await p.getByRole('button',{name:'Check connections',exact:true}).click();
       await p.waitForFunction(()=>!document.getElementById('workspace').disabled);
       assert.deepEqual(x.probedIds,['second-garage']);
       await p.getByRole('button',{name:'02 Inputs'}).click();
       assert.equal(await p.locator('#commissioning').count(),0);
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
 console.log('Desktop Chromium/mobile WebKit passed guided editing, modeled native Save/check/toasts, setup and managed saves, delayed/failed native save, uncertain apply reload, metadata preservation, commissioning, General overview, selected-garage checks, colored enable/disable cards, masked key names/replacement, optional virtual keypad setup, draft-safe keys, theme switching and overflow.');
}catch(e){if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'result='+String(e).replaceAll('\n',' ').slice(0,1500)+'\n');throw e;}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
