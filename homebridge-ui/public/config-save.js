export function sameConfiguration(a,b) {
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
}
// A managed save commits to the coordinator, then mirrors that reviewed
// snapshot into Homebridge. Retrying the latter never reapplies the former.
export class ConfigurationSave {
  constructor(homebridge) { this.hb=homebridge; this.phase='loading'; this.review=null; this.pending=null; }
  load({configuration,revision,connected,saved}) {
    this.configuration=structuredClone(configuration); this.revision=revision; this.connected=connected;
    this.review=null; this.pending=null; this.savedAtLoad=saved; this.phase=saved?'saved':'setup';
  }
  get canClose() { return this.phase==='saved'; }
  get canEdit() { return !['sync-pending','save-uncertain'].includes(this.phase); }
  changed(configuration) {
    if(!this.canEdit)throw Error('finish_save_first');
    this.review=null; this.phase=this.savedAtLoad&&sameConfiguration(configuration,this.configuration)?'saved':'dirty';
  }
  async prepare(configuration) {
    if(!this.canEdit)throw Error('finish_save_first');
    const snapshot=await this.hb.request('/validate',{configuration:structuredClone(configuration)});
    const review=this.connected?(await this.hb.request('/review',{configuration:snapshot,revision:this.revision})).review:
      {configuration:snapshot,requiresCommissioning:snapshot.controllers.map(p=>p.id)};
    this.review=structuredClone(review); this.phase='review'; return this.review;
  }
  async cancel() {
    if(this.review?.token)await this.hb.request('/cancel',{token:this.review.token});
    this.review=null; this.phase='dirty';
  }
  async save() {
    if(!this.pending) {
      if(!this.review)throw Error('review_required');
      let configuration=this.review.configuration;
      if(this.connected) {
        try {
          const result=await this.hb.request('/apply',{token:this.review.token});
          configuration=result.settings.configuration; this.revision=result.settings.revision;
        } catch(error) {
          // A response can be lost after apply. Reload instead of claiming
          // failure or retrying a consumed review token.
          this.review=null; this.phase='save-uncertain'; throw error;
        }
      }
      this.pending=structuredClone(configuration); this.review=null;
    }
    this.phase='sync-pending';
    await this.stage(this.pending);
    const result=await this.hb.savePluginConfig();
    if(result===false)throw Error('homebridge_save_failed');
    this.configuration=this.pending; this.pending=null; this.phase='saved';
    return structuredClone(this.configuration);
  }
  async stage(configuration) {
    const blocks=await this.hb.getPluginConfig();
    if(!Array.isArray(blocks)||blocks.length>1)throw Error('unexpected_config_blocks');
    const block={...(blocks[0]??{}),platform:'GDoorAndBoltCoordinator',
      name:blocks[0]?.name??'Garage Door and Bolt',managementPort:configuration.managementPort,
      controllers:structuredClone(configuration.controllers)};
    await this.hb.updatePluginConfig([block]);
  }
}
