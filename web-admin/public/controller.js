'use strict';
window.ConfiguratorController = ({ root, api, readOnly }) => {
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let data, selected, dirty = false, saving = false, uncertain = false, generation = 0, refreshTimer;
  const message = text => { root.querySelector('[data-controller-message]').textContent = text; };
  const explanations = {
    controller_busy: 'A controller is busy or an interrupted movement is unfinished. Finish the operation, then save again.',
    maintenance_held: 'Controller maintenance is active. Complete it before saving timings.',
    settings_revision_conflict: 'Settings changed in another window. Reload the saved settings and review your changes again.',
  };
  const input = (field, value, attributes = '') => `<label class="gp-field">${esc(field[1])} · seconds<input type="number" min="${field[2]}" max="${field[3]}" step="any" required value="${esc(value)}" ${attributes}></label>`;
  const profile = () => data.controllers.find(row => row.id === selected);
  async function load() {
    if (saving) return;
    const turn = ++generation;
    const result = await api('controller');
    if (turn !== generation) return;
    data = result; selected = data.controllers.some(row => row.id === selected) ? selected : data.controllers[0]?.id;
    dirty = false; uncertain = false; render(); scheduleRefresh();
  }
  function clear() { clearTimeout(refreshTimer); generation++; data = null; selected = null; dirty = false; uncertain = false; saving = false; root.replaceChildren(); }
  function leave() { return !saving && (!dirty || confirm('Discard unsaved controller timing changes?')); }
  function troubleshooting(row) {
    const status = row.status, state = status.state, detail = row.troubleshooting || {};
    const yes = value => value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
    const value = item => item === null || item === undefined || item === '' ? 'None' : String(item);
    const date = item => item && Number.isFinite(new Date(item).getTime()) ? new Date(item).toLocaleString() : 'None';
    const rows = entries => `<dl class="gp-controller-status">${entries.map(([label, item]) => `<div><dt>${esc(label)}</dt><dd>${esc(value(item))}</dd></div>`).join('')}</dl>`;
    const group = (title, entries) => `<section><h4>${esc(title)}</h4>${rows(entries)}</section>`;
    const lockout = status.restarting ? 'Restart requested; waiting for fresh feedback' : state.unavailable || detail.fresh === false || typeof state.lockout !== 'boolean' ? 'Unknown' : state.lockout ? 'Locked out' : 'Not locked out';
    const inputName = id => row.inputs.find(input => input.id === id)?.name || id;
    const motorName = id => id === 'primary' ? 'Primary opener' : row.motorPaths.find(motor => motor.id === id)?.name || id;
    const doorStates = ['Open (0)', 'Closed (1)', 'Opening (2)', 'Closing (3)', 'Stopped (4)'];
    const lockStates = ['Unlocked (0)', 'Locked (1)', 'Jammed (2)', 'Unknown (3)'];
    const homekit = detail.homekit?.map(tile => {
      const name = { garage: 'Garage door', bolt: 'Bolt lock', lockout: 'Tailwind Lockout contact', restart: 'Restart Tailwind switch' }[tile.kind] || tile.kind;
      const fields = [['Availability', tile.available ? 'Available' : 'Unavailable / No Response'], ['Publication pending', yes(tile.publicationPending)]];
      if (tile.kind === 'garage') fields.push(['Current value', doorStates[tile.current] || 'Unknown'], ['Target value', ['Open (0)', 'Closed (1)'][tile.target] || 'Unknown'], ['Obstruction value', yes(tile.obstruction)]);
      else if (tile.kind === 'bolt') fields.push(['Current value', lockStates[tile.current] || 'Unknown'], ['Target value', lockStates[tile.target] || 'Unknown']);
      else if (tile.kind === 'lockout') fields.push(['Contact value', tile.current === 1 ? 'Open / lockout active (1)' : tile.current === 0 ? 'Closed / lockout inactive (0)' : 'Unknown']);
      else if (tile.kind === 'restart') fields.push(['Switch value', tile.target ? 'On' : 'Off']);
      return group(name, fields);
    }).join('');
    return `<h3>Troubleshooting</h3>
      <p role="status"><strong>${esc(status.health?.title || state.phase || 'Unknown')}</strong>${status.tailwind ? ' · Tailwind: '+esc(lockout) : ''}</p>
      ${status.health?.detail ? `<p class="gp-note">${esc(status.health.detail)}</p>` : ''}
      <p class="gp-sub">Refreshes every 3 seconds while visible. Device values describe the last successful sample; unavailable or stale values are not current confirmation.</p>
      <div class="gp-two">
      ${group('Door and bolt', [
        ['Door feedback', state.door], ['Controller phase', state.phase], ['Requested target', state.target],
        ['Bolt feedback', state.bolt], ['Bolt feedback source', row.feedback.bolt],
        ['Opening feedback', row.feedback.opening], ['Closing feedback', row.feedback.closing],
        ['Open is estimated', yes(state.openEstimated === true)], ['Closed is estimated', yes(state.closeEstimated === true)],
        ['Closed confirmed during fault', yes(state.closedObservedDuringFault === true)],
        ['Obstruction reported by adapter', yes(state.obstruction)], ['Inferred movement obstruction', yes(state.inferredObstruction === true)],
        ['HomeKit position fallback', state.inferredObstruction && ['open', 'not-closed'].includes(state.door) ? 'Open means not closed; full opening unconfirmed' : 'None'], ['Infrared beam signal', status.tailwind ? 'Not available' : 'Not independently verified'],
      ])}
      ${group('Control and recovery', [
        ['Saved enabled setting', yes(status.enabled)], ['Setup valid', yes(status.configurationValid)], ['Commissioned', yes(status.commissioned)],
        ['Primary opener commands enabled', yes(status.actuationEnabled)], ['Observation enabled', yes(status.observationEnabled)],
        ['Engine initialized', yes(detail.initialized)], ['Controller busy', yes(state.busy)], ['Operation pending', yes(detail.operationPending)],
        ['Read in progress', yes(detail.observationInProgress)], ['Reconciling position', yes(state.reconciling === true)],
        ['Fresh directional Close available', yes(state.restartCloseAvailable === true)], ['Explicit recovery available', yes(status.canRecover)],
        ['Automatic bolting configured', yes(detail.autoBolt)], ['Automatic bolt work pending', yes(detail.autoClosePending)],
        ['Manual unlock override', yes(state.externalUnlockOverride === true)],
      ])}
      ${group('Faults and feedback age', [
        ['Active fault', state.fault], ['Fault time', date(state.faultAt)], ['Device unavailable reason', state.unavailable], ['Runtime hold', status.held],
        ['Previous fault', status.lastFault?.reason], ['Previous fault time', date(status.lastFault?.at)],
        ['Last successful device sample', date(detail.observedAt)], ['Sample age', detail.ageMs == null ? 'Unknown' : (detail.ageMs / 1000).toFixed(1)+' seconds'],
        ['Sample fresh', yes(detail.fresh)], ['Plugin version', detail.pluginVersion],
      ])}
      ${status.tailwind ? group('Tailwind feedback', [
        ['Lockout flag', yes(state.lockout)], ['Disabled flag', yes(state.disabled)], ['Combined blocked flag', yes(state.blocked)],
        ['Restart waiting', yes(status.restarting)], ['Restart wait remaining', detail.restartWaitMs == null ? 'Unknown' : Math.ceil(detail.restartWaitMs / 1000)+' seconds'],
        ['Native Tailwind HomeKit tile', 'Not read by this plugin'],
      ]) : ''}
      ${group('Inputs and motor routes', [
        ['Active input', inputName(detail.activeInput)], ['Active motor route', motorName(detail.activeMotorPath)],
        ['Interruption currently allowed', yes(detail.interruptionAllowed)], ['Partial-stop owner', inputName(detail.partialStopOwner)],
        ...row.inputs.flatMap(input => [[input.name+' listener', input.enabled ? status.inputStates?.[input.id] || 'Unknown' : 'Disabled'], [input.name+' eligible now', yes(detail.inputEligibility?.[input.id])]]),
        ...(detail.motorPaths || []).map(motor => [motor.name+' worker', motor.stopped ? 'Stopped' : motor.busy ? 'Busy' : 'Idle']),
      ])}
      </div>
      <h4>HomeKit values from this plugin</h4>
      <p class="gp-sub">Committed accessory values, not a reading of the Apple Home screen. If unavailable, the values below are not a valid position report. No native Tailwind HomeKit state is inferred.</p>
      ${homekit ? `<div class="gp-two">${homekit}</div>` : '<p class="gp-note">HomeKit publisher status is unavailable here.</p>'}
      <button type="button" class="gp-button" data-controller-check-state ${readOnly() || state.busy || !status.observationEnabled ? 'disabled' : ''}>Check state now</button>
      ${status.canRecover ? `<button type="button" class="gp-button" data-controller-recover ${readOnly() ? 'disabled' : ''}>Check again</button>` : ''}
      ${status.tailwind ? `<button type="button" class="gp-button" data-controller-restart-tailwind ${readOnly() || state.busy || status.restarting || !status.observationEnabled ? 'disabled' : ''}>Restart Tailwind</button><p class="gp-sub">Restarts the Tailwind device. All doors connected to it are briefly unavailable. Fresh feedback confirms whether lockout cleared.</p>` : ''}
      <p class="gp-sub">Check state now reads devices without moving the door or bolt. Check again reinitializes the controller and clears resolved faults after fresh checks.</p>`;
  }
  function bindTroubleshooting() {
    for (const [selector, endpoint, success] of [
      ['[data-controller-recover]', 'recover', 'Device states checked. No movement command was sent.'],
      ['[data-controller-check-state]', 'check-state', 'Device states checked. No movement command was sent.'],
      ['[data-controller-restart-tailwind]', 'restart-tailwind', 'Restart requested. Waiting for fresh Tailwind feedback.'],
    ]) {
      const button = root.querySelector(selector);
      if (!button) continue;
      button.onclick = async () => {
        if (saving || readOnly()) return;
        saving = true; const turn = generation, row = profile();
        root.querySelectorAll('[data-controller-troubleshooting] button').forEach(el => { el.disabled = true; });
        try {
          const result = await api('controller/' + endpoint, { controllerId: selected, revision: data.revision, bootId: row.status.bootId });
          if (turn !== generation) return;
          for (const updated of result.controllers) {
            const old = data.controllers.find(item => item.id === updated.id);
            if (old) { old.status = updated.status; old.troubleshooting = updated.troubleshooting; }
          }
          message(success);
        } catch (error) {
          if (turn !== generation) return;
          message(explanations[error.code] || (endpoint === 'restart-tailwind' ? 'Restart could not be confirmed. Check status before trying again.' : 'Could not check device states.'));
        } finally {
          saving = false;
          if (turn === generation) { refreshTroubleshooting(); scheduleRefresh(); }
        }
      };
    }
  }
  function refreshTroubleshooting() {
    const panel = root.querySelector('[data-controller-troubleshooting]');
    if (panel && profile()) { panel.innerHTML = troubleshooting(profile()); bindTroubleshooting(); }
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const turn = generation;
      try {
        if (!saving && data && root.isConnected && !root.closest('[hidden]')) {
          const result = await api('controller');
          if (turn !== generation || saving) return;
          for (const updated of result.controllers) {
            const old = data.controllers.find(item => item.id === updated.id);
            if (old) { old.status = updated.status; old.troubleshooting = updated.troubleshooting; }
          }
          refreshTroubleshooting();
        }
      } catch { if (turn === generation) {
        const panel = root.querySelector('[data-controller-troubleshooting]');
        if (panel) panel.textContent = 'Status unavailable. Reload to check the connection.';
      } }
      finally { if (turn === generation && data) scheduleRefresh(); }
    }, 3000);
  }
  function render() {
    if (!data.controllers.length) { root.innerHTML = '<p class="gp-note">Add a garage in the Homebridge plugin settings first.</p>'; return; }
    const row = profile(), values = row.values, fields = data.fields;
    const state = row.status.state;
    root.innerHTML = `<label class="gp-field gp-controller-selector">Garage Door<select data-controller-select>${data.controllers.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <section class="gp-panel gp-body" data-controller-troubleshooting>${troubleshooting(row)}</section>
      <p class="gp-sub">All times are in seconds. Changes apply to the next operation without restarting Homebridge. Save when controllers are idle.</p>
      <p class="gp-sub">Opening feedback: ${esc(row.feedback.opening)} · Closing feedback: ${esc(row.feedback.closing)} · Bolt feedback: ${esc(row.feedback.bolt)}. Travel times are estimates when timed feedback is selected.</p>
      <p data-controller-message role="status" aria-live="polite"></p>
      <form data-controller-form><fieldset ${readOnly() ? 'disabled' : ''}>
      <h3>Controller defaults</h3><p class="gp-sub">Used by HomeKit, the virtual keypad and devices without an override.</p>
      <div class="gp-two">${['timing', 'feedback'].flatMap(group => fields[group].map(field => input(field, values[group][field[0]], `data-default-group="${group}" data-key="${field[0]}"`))).join('')}</div>
      <h3>Device timing overrides</h3><p class="gp-sub">Use the controller default or set a different time for an individual button, switch or keypad.</p>
      ${row.inputs.length ? row.inputs.map((device, index) => `<details class="gp-panel gp-body"><summary>${esc(device.name)}${device.enabled ? '' : ' (disabled)'}</summary><p class="gp-sub">Motor: ${esc(row.motorPaths.find(m => m.id === device.motorPath)?.name || 'Primary opener')}</p><div class="gp-two">${fields.inputs.map(field => {
        const override = Object.hasOwn(values.inputs[index].timing, field[0]);
        const fallback = values.timing[field[0]] ?? values.feedback[field[0]];
        return `<div><label class="gp-check"><input type="checkbox" data-inherit="${index}" data-key="${field[0]}" ${override ? '' : 'checked'}>Use default for ${esc(field[1].toLowerCase())}</label>${input(field, override ? values.inputs[index].timing[field[0]] : fallback, `data-input-index="${index}" data-key="${field[0]}" ${override ? '' : 'disabled'}`)}</div>`;
      }).join('')}${input(['rearmSeconds', 'Input rearm wait', 0, 10], values.inputs[index].rearmSeconds, `data-rearm="${index}"`)}</div></details>`).join('') : '<p class="gp-sub">No physical input devices configured.</p>'}
      ${row.motorPaths.length ? '<h3>Motor relay pulses</h3>' + row.motorPaths.map((motor, index) => `<details class="gp-panel gp-body"><summary>${esc(motor.name)}</summary><div class="gp-two">${fields.motorPaths.map(field => input(field, values.motorPaths[index][field[0]], `data-motor-index="${index}" data-key="${field[0]}"`)).join('')}</div></details>`).join('') : ''}
      <button type="submit" class="gp-button primary">Review timing changes</button></fieldset></form>
      <div data-controller-review class="gp-panel gp-body" hidden></div>
      <button type="button" class="gp-button" data-controller-reload>Reload saved timings</button>`;
    bindTroubleshooting();
    const form = root.querySelector('form'), review = root.querySelector('[data-controller-review]');
    root.querySelector('[data-controller-select]').onchange = event => {
      if (!leave()) { event.target.value = selected; return; } selected = event.target.value; dirty = false; render();
    };
    root.querySelector('[data-controller-reload]').onclick = async () => { if (leave()) { try { await load(); } catch { message('Could not reload. Check your connection and try again.'); } } };
    form.oninput = () => {
      if (!uncertain) message('');
      dirty = true;
      for (const checkbox of root.querySelectorAll('[data-inherit]')) {
        const number = root.querySelector(`[data-input-index="${checkbox.dataset.inherit}"][data-key="${checkbox.dataset.key}"]`);
        number.disabled = checkbox.checked;
        if (checkbox.checked) number.value = root.querySelector(`[data-default-group][data-key="${checkbox.dataset.key}"]`).value;
      }
    };
    form.onsubmit = event => {
      event.preventDefault(); if (saving || uncertain || readOnly()) return;
      const next = structuredClone(values), changes = [];
      const change = (target, key, value, label) => { if (target[key] !== value) { changes.push(`${label}: ${target[key] ?? 'Default'} → ${value ?? 'Default'}`); if (value === undefined) delete target[key]; else target[key] = value; } };
      for (const element of root.querySelectorAll('[data-default-group]')) change(next[element.dataset.defaultGroup], element.dataset.key, Number(element.value), element.closest('label').textContent);
      for (const element of root.querySelectorAll('[data-input-index]')) {
        const index = Number(element.dataset.inputIndex);
        change(next.inputs[index].timing, element.dataset.key, element.disabled ? undefined : Number(element.value), row.inputs[index].name + ' — ' + element.closest('label').textContent);
      }
      for (const element of root.querySelectorAll('[data-rearm]')) change(next.inputs[Number(element.dataset.rearm)], 'rearmSeconds', Number(element.value), row.inputs[Number(element.dataset.rearm)].name + ' — Input rearm wait');
      for (const element of root.querySelectorAll('[data-motor-index]')) change(next.motorPaths[Number(element.dataset.motorIndex)], element.dataset.key, Number(element.value), row.motorPaths[Number(element.dataset.motorIndex)].name + ' — ' + element.closest('label').textContent);
      if (!changes.length) { message('No timing changes to save.'); dirty = false; return; }
      form.hidden = true; review.hidden = false;
      review.innerHTML = `<h3>Review timing changes</h3><ul>${changes.map(text => `<li>${esc(text)}</li>`).join('')}</ul><p class="gp-sub">Applies while idle. No Homebridge restart is needed.</p><button type="button" class="gp-button primary" data-controller-apply>Apply timings</button> <button type="button" class="gp-button" data-controller-back>Back to editing</button>`;
      review.querySelector('[data-controller-back]').onclick = () => { review.hidden = true; form.hidden = false; };
      review.querySelector('[data-controller-apply]').onclick = async () => {
        if (saving || uncertain) return;
        saving = true; const turn = generation;
        message('Saving timings…');
        root.querySelectorAll('button,select').forEach(element => { element.disabled = true; });
        try {
          const result = await api('controller/timings', { controllerId: selected, revision: data.revision, values: next });
          if (turn !== generation) return;
          data = result; dirty = false; render(); message('Timings saved and active. Homebridge was not restarted.');
        } catch (error) {
          if (turn !== generation) return;
          uncertain = !error.code || !['controller_busy', 'maintenance_held', 'settings_revision_conflict'].includes(error.code);
          review.hidden = true; form.hidden = false;
          message(explanations[error.code] || 'The save result could not be confirmed. Reload saved timings before making another change.');
          root.querySelectorAll('button,select').forEach(element => { element.disabled = uncertain && element.type === 'submit'; });
          if (uncertain) root.querySelector('[data-controller-select]').disabled = true;
        } finally { saving = false; }
      };
    };
  }
  return { load, clear, leave, get dirty() { return dirty; } };
};
