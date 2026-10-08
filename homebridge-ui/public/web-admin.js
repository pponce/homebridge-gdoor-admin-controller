// The web server has its own save, so setup never changes garage commissioning.
const messages = {
  web_port_in_use: 'That port is already in use. Choose another port, or stop the old web service when you are ready to switch.',
  web_settings_changed: 'These settings changed elsewhere. Reload the saved web settings before saving again.',
  web_connections_changed: 'A selected connection or key changed. Save the web settings again to use the current connection.',
  web_connection_unavailable: 'Save a deCONZ device connection in General first, then select it here.',
  web_gateway_unavailable: 'The selected deCONZ gateway could not be verified. Check its saved connection and key.',
  web_gateway_identity_changed: 'This connection now identifies a different gateway. Create a separate connection for that gateway.',
  web_gateway_duplicate: 'Two selected connections identify the same gateway. Select only one of them.',
  web_connections_required: 'Select at least one saved deCONZ connection.',
  web_account_setup_required: 'Enter the first web administrator username and password.',
  web_account_already_configured: 'A web account is already configured. Reload the web settings; existing accounts are kept.',
  username_invalid: 'Use a username starting with a letter or number, followed by letters, numbers, dots, underscores or hyphens.',
  password_length_invalid: 'Use a password with 8 to 256 characters.',
  web_admin_node_update_required: 'The optional web admin needs Node.js 22.13 or later in the 22 series, or Node.js 24.',
  web_certificate_generation_failed: 'The private backend certificate could not be created. Check that OpenSSL is available to Homebridge.',
  web_backend_port_mismatch: 'The backend HTTPS address must use the selected listening port.',
  web_origin_invalid: 'Use an HTTPS address with no path, trailing slash, username or password.',
  web_management_port_conflict: 'Choose a different port from the coordinator management API.',
  web_settings_invalid: 'Check the listening address, port and selected connections.',
};
export class WebAdminPanel {
  constructor(root, { request, changed = () => {}, run = fn => fn() }) {
    Object.assign(this, { root, request, changed, run }); this.dirty = false; this.value = null;
  }
  async load(connected, force = false) {
    if (this.dirty && !force) return;
    this.dirty = false;
    if (!connected) { this.renderUnavailable('Save your setup and start the coordinator child bridge to configure the optional web interface.'); return; }
    try { this.value = (await this.request('/web-admin')).webAdmin; this.render(); }
    catch { this.renderUnavailable('Web settings are unavailable. Check that the coordinator child bridge is running.'); }
    this.changed();
  }
  renderUnavailable(message) {
    this.root.replaceChildren(); const title = document.createElement('h2'), help = document.createElement('p');
    title.textContent = 'Web admin interface'; help.textContent = message; help.className = 'help'; this.root.append(title, help);
  }
  render() {
    const value = this.value, settings = value.settings;
    this.root.innerHTML = `<div class="section-heading"><div><h2>Web admin interface</h2><p class="subtle">Optional pages for deCONZ users, PINs, alarms, keypad and activity.</p></div><span class="badge neutral" data-web-status></span></div>
      <p class="help">HomeKit and physical controls work with this off. Web accounts are separate from Homebridge accounts.</p>
      <p role="status" data-web-message></p>
      <form><label class="check"><input type="checkbox" name="enabled"> Enable web admin</label>
      <div data-web-options><div class="field-grid">
        <label>Web address<input name="publicUrl" type="url" required placeholder="https://garage.example.test"><span class="help">The address you open in your browser.</span></label>
        <label>Access<select name="accessMode"><option value="manage">Manage users and alarm settings</option><option value="observe">View only</option></select></label>
      </div><fieldset data-web-connections><legend>Saved deCONZ connections</legend><p class="help">Uses the connections and keys you saved above. Select the gateways to administer.</p></fieldset>
      <details><summary>HTTPS listener and reverse proxy</summary><div class="field-grid">
        <label>Listen on address<input name="bind" required placeholder="127.0.0.1"><span class="help">Use an IP address. 127.0.0.1 accepts this host only; 0.0.0.0 accepts IPv4 connections on its network interfaces.</span></label>
        <label>Listening port<input name="port" type="number" required min="1024" max="65535"></label>
        <label class="wide">Backend HTTPS address<input name="origin" type="url" required placeholder="https://localhost:9443"><span class="help">For a direct connection, use the web address. With nginx, match the Host and Origin it sends to this backend.</span></label>
      </div><p class="help">The plugin creates its own private backend certificate. Your public certificate stays in nginx. An existing service on the selected port will not be stopped automatically.</p></details>
      <fieldset data-web-account><legend>First web administrator</legend><div class="field-grid">
        <label>Username<input name="username" autocomplete="username" maxlength="64"></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256"></label>
        <label>Repeat password<input name="repeat" type="password" autocomplete="new-password" minlength="8" maxlength="256"></label>
      </div><p class="help">Create this account once. Manage additional accounts and passwords inside the web interface.</p></fieldset></div>
      <div class="actions"><button type="submit" class="primary">Save web settings</button><button type="button" class="secondary" data-web-reload>Reload saved web settings</button><a data-web-open target="_blank" rel="noopener noreferrer" hidden>Open web admin</a></div></form>`;
    const form = this.root.querySelector('form'), fields = form.elements, message = this.root.querySelector('[data-web-message]');
    for (const key of ['publicUrl', 'accessMode', 'bind', 'port', 'origin']) fields.namedItem(key).value = settings[key];
    fields.enabled.checked = settings.enabled;
    const list = this.root.querySelector('[data-web-connections]');
    for (const row of value.connections) {
      const label = document.createElement('label'), input = document.createElement('input'); label.className = 'check';
      input.type = 'checkbox'; input.name = 'connection'; input.value = row.id; input.checked = settings.connectionIds.includes(row.id);
      label.append(input, document.createTextNode(row.name)); list.append(label);
    }
    if (!value.connections.length) { const help = document.createElement('p'); help.textContent = 'Add and save a deCONZ connection in General, then reload these web settings.'; list.append(help); }
    this.root.querySelector('[data-web-account]').hidden = value.accountConfigured;
    const sync = () => {
      this.root.querySelector('[data-web-options]').hidden = !fields.enabled.checked;
      for (const name of ['username', 'password', 'repeat']) fields.namedItem(name).required = fields.enabled.checked && !value.accountConfigured;
    }; sync();
    this.root.querySelector('[data-web-status]').textContent = value.error ? 'Needs attention' : value.running ? 'Running' : 'Off';
    if (value.error) message.textContent = messages[value.error] ?? 'Web admin could not start. Check its settings and Homebridge storage.';
    const link = this.root.querySelector('[data-web-open]'); if (value.running && !value.error) { link.hidden = false; link.href = settings.publicUrl; }
    form.oninput = () => { this.dirty = true; sync(); this.changed(); };
    this.root.querySelector('[data-web-reload]').onclick = () => this.run(() => this.load(true, true));
    form.onsubmit = event => { event.preventDefault(); void this.run(async () => {
      if (fields.enabled.checked && !value.accountConfigured && fields.password.value !== fields.repeat.value) { message.textContent = 'The passwords do not match.'; return; }
      const next = { enabled: fields.enabled.checked, bind: fields.bind.value.trim(), port: Number(fields.port.value),
        origin: fields.origin.value.trim(), publicUrl: fields.publicUrl.value.trim(), accessMode: fields.accessMode.value,
        connectionIds: [...form.querySelectorAll('input[name="connection"]:checked')].map(input => input.value) };
      const admin = !value.accountConfigured && next.enabled ? { username: fields.username.value.trim(), password: fields.password.value } : null;
      let result;
      try { result = await this.request('/web-admin/configure', { expectedRevision: value.revision, settings: next, admin }); }
      catch { message.textContent = 'The save response was lost. Reload saved web settings to check the result before saving again.'; return; }
      finally { fields.password.value = ''; fields.repeat.value = ''; }
      if (!result.configured) { message.textContent = messages[result.error] ?? 'Web setup could not finish. Reload saved web settings to check the result.'; return; }
      this.value = result.webAdmin; this.dirty = false; this.render(); this.changed();
      if (!this.value.error) this.root.querySelector('[data-web-message]').textContent = this.value.running ? 'Saved. Web admin is running.' : 'Saved. Web admin is off. Accounts and history are kept.';
    }); };
  }
}
