'use strict';
window.ConfiguratorController = ({ root, api, readOnly }) => {
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let data, selected, dirty = false, saving = false, uncertain = false, generation = 0;
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
    dirty = false; uncertain = false; render();
  }
  function clear() { generation++; data = null; selected = null; dirty = false; uncertain = false; saving = false; root.replaceChildren(); }
  function leave() { return !saving && (!dirty || confirm('Discard unsaved controller timing changes?')); }
  function render() {
    if (!data.controllers.length) { root.innerHTML = '<p class="gp-note">Add a garage in the Homebridge plugin settings first.</p>'; return; }
    const row = profile(), values = row.values, fields = data.fields;
    const state = row.status.state;
    root.innerHTML = `<label class="gp-field gp-controller-selector">Garage Door<select data-controller-select>${data.controllers.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <p class="gp-note">${esc((row.status.enabled ?? row.status.actuationEnabled) ? 'Enabled' : 'Disabled')}${row.status.health?.title && row.status.health.title !== 'Disabled' ? ' · '+esc(row.status.health.title) : ''} · Door: ${esc(state.door)} · Bolt: ${esc(state.bolt)}${state.busy ? ' · Busy' : ''}. Status at last reload.</p>
      ${row.status.health?.detail ? `<p class="gp-note" role="status">${esc(row.status.health.detail)}${row.status.health.code ? ' Reason: '+esc(row.status.health.code)+'.' : ''}</p>` : ''}
      ${row.status.lastFault ? `<details class="gp-panel gp-body"><summary>Previous fault</summary><p class="gp-note">${esc(row.status.lastFault.reason.replaceAll('_', ' '))}${row.status.lastFault.at ? ' · '+esc(row.status.lastFault.at) : ''}. Historical record; current status is shown above.</p></details>` : ''}
      ${row.status.canRecover ? `<button type="button" class="gp-button" data-controller-recover ${readOnly() ? 'disabled' : ''}>Check again</button>` : ''}
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
    const form = root.querySelector('form'), review = root.querySelector('[data-controller-review]');
    root.querySelector('[data-controller-select]').onchange = event => {
      if (!leave()) { event.target.value = selected; return; } selected = event.target.value; dirty = false; render();
    };
    root.querySelector('[data-controller-reload]').onclick = async () => { if (leave()) { try { await load(); } catch { message('Could not reload. Check your connection and try again.'); } } };
    const recover = root.querySelector('[data-controller-recover]');
    if (recover) recover.onclick = async () => {
      if (saving || readOnly() || !leave()) return;
      saving = true; const turn = generation;
      root.querySelectorAll('button,select').forEach(element => { element.disabled = true; });
      try {
        const result = await api('controller/recover', { controllerId: selected, revision: data.revision, bootId: row.status.bootId });
        if (turn !== generation) return;
        data = result; dirty = false; render(); message('Device states checked. No movement command was sent.');
      } catch (error) {
        if (turn !== generation) return;
        uncertain = true;
        message(explanations[error.code] || 'Could not confirm the check result. Reload to see the current status.');
        root.querySelector('[data-controller-reload]').disabled = false;
      } finally { saving = false; }
    };
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
          data = result; dirty = false; render(); message('Demo timings saved in this tab. No devices were contacted.');
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
