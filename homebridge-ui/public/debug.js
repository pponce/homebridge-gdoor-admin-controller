const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export class DebugPanel {
  constructor(root,request){
    this.root=root;this.request=request;this.report=null;this.working=false;
    const panel=el('section',undefined,'panel');root.append(panel);
    panel.append(el('h2','Diagnostics'),el('p','Inspect current status and record HomeKit events for troubleshooting.','subtle'));
    this.message=el('p','Open this tab to load diagnostic status.','help');this.message.setAttribute('role','status');panel.append(this.message);
    const label=el('label',undefined,'debug-toggle');this.toggle=document.createElement('input');this.toggle.type='checkbox';this.toggle.id='debug-recording';this.toggle.disabled=true;
    label.append(this.toggle,el('span','HomeKit event recording'));panel.append(label);
    panel.append(el('p','Changes take effect immediately when all garage doors are idle. Recording stays off after a restart. No configuration save is needed.','help'));
    this.mode=el('p',undefined,'help');panel.append(this.mode);
    const actions=el('div',undefined,'actions');this.refresh=el('button','Refresh status','secondary');this.refresh.type='button';this.refresh.id='debug-refresh';
    this.download=el('button','Download diagnostic report','primary');this.download.type='button';this.download.id='debug-download';actions.append(this.refresh,this.download);panel.append(actions);
    panel.append(el('p','Reports use Garage 1, Garage 2, etc. and exclude names, addresses, credentials and pairing identities. Recent events are limited to the available history; turning recording on cannot recover earlier events.','help'));
    this.summary=el('div',undefined,'debug-summary');panel.append(this.summary);
    this.preview=el('details');this.preview.append(el('summary','Report details'));this.json=el('pre');this.preview.append(this.json);panel.append(this.preview);
    this.refresh.onclick=()=>void this.load();this.download.onclick=()=>void this.load(true);
    this.toggle.onchange=()=>{const enabled=this.toggle.checked;this.toggle.checked=this.report?.recording??false;void this.record(enabled);};
  }
  controls(){this.refresh.disabled=this.working;this.download.disabled=this.working;this.toggle.disabled=this.working||!this.report||this.report.controllers.some(c=>c.busy);}
  async load(download=false){
    if(this.working)return;this.working=true;this.controls();this.message.textContent='Reading diagnostic status…';
    try{const report=await this.request('/debug',{});this.render(report);
      if(download){const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download='garage-diagnostics-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }catch{this.unavailable('Diagnostic status is unavailable. Start the coordinator child bridge, then refresh. Older plugin versions may need an update.');}
    finally{this.working=false;this.controls();}
  }
  async record(recording){
    if(this.working)return;this.working=true;this.controls();this.message.textContent='Changing recording setting…';
    try{await this.request('/debug/recording',{recording});this.render(await this.request('/debug',{}));}
    catch{this.unavailable('Could not confirm the recording setting. Wait until all garage doors are idle, then refresh status before trying again.');}
    finally{this.working=false;this.controls();}
  }
  unavailable(message){this.report=null;this.toggle.checked=false;this.toggle.indeterminate=true;this.mode.textContent='Recording status unknown';this.message.textContent=message;this.summary.replaceChildren();this.json.textContent='';}
  render(report){
    this.report=report;this.toggle.indeterminate=false;this.toggle.checked=report.recording;
    this.message.textContent='Snapshot captured '+new Date(report.capturedAt).toLocaleTimeString()+'. Refresh to update; there is no background polling.';
    this.mode.textContent=(report.recording?'Recording ON':'Recording OFF')+' · '+report.events.length+' recorded HomeKit events · '+(report.traceMode??'unknown')+' tracing · '+(report.publicationMode??'unknown')+' publication';
    this.summary.replaceChildren(el('h3','Current status'));
    this.summary.append(el('p','Plugin '+(report.versions.plugin??'unknown')+' · Homebridge '+(report.versions.homebridge??'unknown')+' · HAP '+(report.versions.hap??'unknown'),'help'));
    for(const c of report.controllers){const item=el('p');item.textContent=c.garage+': '+(c.door??'unknown')+' door, '+(c.bolt??'unknown')+' bolt'+(c.busy?' · Operation active':'')+(c.fault?' · Fault present':'')+(c.unavailable?' · Unavailable':'');this.summary.append(item);}
    if(report.controllers.some(c=>c.busy))this.summary.append(el('p','Recording can be changed after the current operation finishes.','help'));
    this.summary.append(el('p',report.clients.length+' HomeKit connections · Subscription inspection '+(report.connectionInspection??'unavailable'),'help'));
    this.json.textContent=JSON.stringify(report,null,2);this.controls();
  }
}
