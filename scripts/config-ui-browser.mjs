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
const server=http.createServer(async(req,res)=>{try{const file=path.basename(new URL(req.url,'http://test').pathname)||'index.html';if(!['index.html','app.js','editor.js','style.css'].includes(file))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(root,file)));}catch{res.writeHead(404);res.end();}});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
 for(const [browserType,mobile,dark] of [[chromium,false,false],[webkit,true,true]]){
  const browser=await browserType.launch({headless:true});try{
   const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1200,height:1000}});let configuration=validateConfiguration(example), revision=1, reviewed;let saves=0, probes=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.exposeFunction('testRequest',async(name,body)=>{
    if(name==='/load')return{connected:true,settings:{revision,configuration},credentials:['example-tailwind-key','example-deconz-key'],controllers:[{id:base.id,name:base.name,status:{actuationEnabled:false,held:'not-commissioned'}}]};
    if(name==='/validate')return validateConfiguration(body.configuration,{allowEmpty:true});
    if(name==='/review'){assert.equal(body.revision,revision);reviewed=validateConfiguration(body.configuration);return{review:{token:'review-test',configuration:reviewed,requiresCommissioning:[base.id]}};}
    if(name==='/cancel'){reviewed=null;return{};}
    if(name==='/apply'){assert.equal(body.token,'review-test');configuration=reviewed;revision++;saves++;return{settings:{revision,configuration}};}
    if(name==='/probe'){probes++;return{probe:{compatible:true,door:{state:'closed',feedback:'closed-sensor'},bolt:{state:'locked',feedback:'relay'},limitations:[]}};}
    if(name==='/credentials'){assert.equal(body.secret,'private-browser-test-key');return{saved:true};}
    if(name==='/deconz'){const row=configuration.controllers[0].motorPaths[0].connection;return{gatewayId:row.gatewayId,
      lights:[{name:'Synthetic Aqara opener',resourceId:row.resourceId,uniqueId:row.uniqueId,resourceType:row.resourceType,
        modelId:row.modelId,manufacturer:row.manufacturer}],sensors:[],alarms:[]};}
    throw Error('unsupported_browser_request');
   });
   await page.addInitScript(({dark})=>{Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});window.homebridge={hideSchemaForm(){},disableSaveButton(){},fixScrollHeight(){},async userCurrentLightingMode(){return dark?'dark':'light';},async getPluginConfig(){return[];},request:(name,body)=>window.testRequest(name,body)};},{dark});
   await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.getByRole('button',{name:'Review changes',exact:true}).waitFor();await page.locator('.garage-card').waitFor();
   assert.equal(probes,0);assert.equal(await page.locator('html').getAttribute('data-theme'),dark?'dark':'light');
   await page.getByRole('button',{name:'Add a garage'}).click();assert.equal(await page.locator('.garage-card').count(),2);await page.getByRole('button',{name:'Remove this garage'}).click();assert.equal(await page.locator('.garage-card').count(),1);
   await page.getByLabel('Garage name',{exact:true}).fill('Test garage');await page.getByLabel('Garage name',{exact:true}).press('Tab');
   await page.getByRole('button',{name:'02 Inputs'}).click();assert.match(await page.locator('.route-note').first().textContent(),/HomeKit.*virtual keypad.*Tailwind/);assert.equal(await page.locator('.input-profile').count(),2);
   await page.getByRole('button',{name:'Find devices',exact:true}).first().click();
   await page.getByLabel('Discovered motor',{exact:true}).selectOption('0');
   await page.getByText('Selected: lumi.switch.acn047 · resource 2',{exact:true}).waitFor();
   await page.getByRole('button',{name:'03 Behavior'}).click();await page.getByLabel('Before opening (seconds)',{exact:true}).fill('3');await page.getByLabel('Before opening (seconds)',{exact:true}).press('Tab');
   await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByRole('button',{name:'Save reviewed settings'}).waitFor();assert.equal(saves,0);
   await page.getByRole('button',{name:'Save reviewed settings'}).click();await page.locator('#notice').filter({hasText:'Settings saved'}).waitFor();assert.equal(saves,1);assert.equal(configuration.controllers[0].timing.openRetractSettleSeconds,3);
   assert.equal(await page.getByRole('button',{name:'Enable this garage'}).isDisabled(),true);
   await page.getByRole('button',{name:'Check connections'}).click();await page.locator('.commission-result').filter({hasText:'Connections verified'}).waitFor();assert.equal(probes,1);
   await page.locator('#credential-reference').fill('private-key');await page.locator('#credential-secret').fill('private-browser-test-key');await page.getByRole('button',{name:'Save connection key'}).click();await page.locator('#notice').filter({hasText:'saved privately'}).waitFor();assert.equal(await page.locator('#credential-secret').inputValue(),'');
   assert.equal(await page.locator('body').evaluate(b=>b.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
   if(process.env.PREVIEW_OUTPUT){await mkdir(process.env.PREVIEW_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.PREVIEW_OUTPUT,mobile?'coordinator-mobile.png':'coordinator-desktop.png'),fullPage:true});}
   await page.close();
  }finally{await browser.close();}
 }
 console.log('Custom Homebridge UI passed desktop Chromium and mobile WebKit: guided editing, source routing, review/apply, explicit probes, disabled commissioning, private key clearing and overflow.');
}catch(e){if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'result='+String(e).replaceAll('\n',' ').slice(0,1500)+'\n');throw e;}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
