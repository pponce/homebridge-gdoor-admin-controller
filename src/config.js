export class ConfigurationError extends Error {
  constructor(code) { super(code); this.name = 'ConfigurationError'; }
}
const fail = (code) => { throw new ConfigurationError(code); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
function fields(value, allowed, code) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(code);
}
function string(value, code, max = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\x00-\x1f]/.test(value)) fail(code);
  return value;
}
function number(value, min, max, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(code);
  return value;
}
function choice(value, choices, code) {
  if (!choices.includes(value)) fail(code);
  return value;
}
function baseUrl(value) {
  string(value, 'invalid_device_url', 512);
  let url;
  try { url = new URL(value); } catch { fail('invalid_device_url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('invalid_device_url');
  return url.origin;
}
function secretRef(value) {
  if (!identifier(value)) fail('invalid_secret_reference');
  return value;
}
function homebridge(value, bolt) {
  fields(value, ['type', 'baseUrl', 'bridgeId', 'serviceId', 'accessoryIdentity', 'credentialRef', ...(bolt ? ['serviceType', 'lockedValue'] : [])], 'invalid_homebridge_connection');
  const result = {
    type: 'homebridge',
    ...(value.baseUrl !== undefined ? { baseUrl: baseUrl(value.baseUrl) } : {}),
    ...(value.accessoryIdentity !== undefined ? { accessoryIdentity: string(value.accessoryIdentity, 'invalid_accessory_identity', 64) } : {}),
    bridgeId: string(value.bridgeId, 'invalid_bridge_id'),
    serviceId: string(value.serviceId, 'invalid_service_id'),
    credentialRef: secretRef(value.credentialRef),
  };
  if (bolt) {
    result.serviceType = choice(value.serviceType, ['lock', 'switch', 'light'], 'invalid_bolt_service');
    if (result.serviceType !== 'lock') {
      if (typeof value.lockedValue !== 'boolean') fail('invalid_bolt_mapping');
      result.lockedValue = value.lockedValue;
    } else if (value.lockedValue !== undefined) fail('invalid_bolt_mapping');
  }
  return result;
}
function door(value) {
  if (!object(value)) fail('door_and_bolt_required');
  if (value.type === 'homebridge') return homebridge(value, false);
  if (value.type !== 'tailwind') fail('unsupported_door_backend');
  fields(value, ['type', 'baseUrl', 'doorIndex', 'credentialRef'], 'invalid_tailwind_connection');
  if (!Number.isInteger(value.doorIndex) || value.doorIndex < 0 || value.doorIndex > 2) fail('invalid_door_index');
  return { type: 'tailwind', baseUrl: baseUrl(value.baseUrl), doorIndex: value.doorIndex, credentialRef: secretRef(value.credentialRef) };
}
function bolt(value) {
  if (!object(value)) fail('door_and_bolt_required');
  if (value.type === 'homebridge') return homebridge(value, true);
  if (value.type !== 'deconz') fail('unsupported_bolt_backend');
  fields(value, ['type', 'baseUrl', 'gatewayId', 'resourceId', 'uniqueId', 'resourceType', 'modelId', 'manufacturer', 'credentialRef', 'lockedValue'], 'invalid_deconz_connection');
  if (typeof value.resourceId !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value.resourceId)) fail('invalid_deconz_resource');
  if (typeof value.lockedValue !== 'boolean') fail('invalid_bolt_mapping');
  return {
    type: 'deconz', baseUrl: baseUrl(value.baseUrl), gatewayId: string(value.gatewayId, 'invalid_gateway_id'),
    resourceId: value.resourceId, uniqueId: string(value.uniqueId, 'invalid_resource_identity'),
    ...(value.resourceType !== undefined ? { resourceType: choice(value.resourceType, ['On/Off light', 'On/Off output'], 'invalid_resource_type') } : {}),
    ...(value.modelId !== undefined ? { modelId: string(value.modelId, 'invalid_resource_model') } : {}),
    ...(value.manufacturer !== undefined ? { manufacturer: string(value.manufacturer, 'invalid_resource_manufacturer') } : {}),
    credentialRef: secretRef(value.credentialRef), lockedValue: value.lockedValue,
  };
}
function feedback(value) {
  fields(value, ['closing', 'opening', 'bolt', 'openingSeconds', 'closingSeconds', 'closedStableSeconds', 'boltSettleSeconds', 'allowEstimatedBolting'], 'invalid_feedback');
  if (typeof value.allowEstimatedBolting !== 'boolean') fail('estimated_bolting_policy_required');
  return {
    closing: choice(value.closing, ['sensor', 'timed'], 'invalid_closing_feedback'),
    opening: choice(value.opening, ['sensor', 'timed'], 'invalid_opening_feedback'),
    bolt: choice(value.bolt, ['position', 'relay', 'timed'], 'invalid_bolt_feedback'),
    openingSeconds: number(value.openingSeconds, 1, 300, 'invalid_opening_time'),
    closingSeconds: number(value.closingSeconds, 1, 300, 'invalid_closing_time'),
    closedStableSeconds: number(value.closedStableSeconds, 0, 60, 'invalid_closed_stability'),
    boltSettleSeconds: number(value.boltSettleSeconds, 0, 60, 'invalid_bolt_settle'),
    allowEstimatedBolting: value.allowEstimatedBolting,
  };
}
function resourceKeys(value) {
  if (value.type === 'homebridge') return [JSON.stringify(['homebridge', value.bridgeId.toLowerCase(), value.serviceId])];
  if (value.type === 'tailwind') return [JSON.stringify(['tailwind', value.baseUrl, value.doorIndex])];
  return [
    ['deconz-identity', value.gatewayId.replaceAll(':', '').toLowerCase(), value.uniqueId.toLowerCase()],
    ['deconz-resource', value.gatewayId.replaceAll(':', '').toLowerCase(), value.resourceId],
    ['deconz-endpoint', value.baseUrl, value.resourceId],
  ].map(key => JSON.stringify(key));
}

function pulseConnection(value) {
  fields(value, ['type', 'baseUrl', 'gatewayId', 'resourceId', 'uniqueId', 'resourceType', 'modelId', 'manufacturer',
    'bridgeId', 'serviceId', 'accessoryIdentity', 'credentialRef', 'activeValue'], 'invalid_pulse_connection');
  if (typeof value.activeValue !== 'boolean') fail('invalid_pulse_mapping');
  const { activeValue, ...connection } = value;
  if (value.type === 'deconz') {
    fields(value, ['type', 'baseUrl', 'gatewayId', 'resourceId', 'uniqueId', 'resourceType', 'modelId', 'manufacturer', 'credentialRef', 'activeValue'], 'invalid_pulse_connection');
    const checked = bolt({ ...connection, lockedValue: activeValue });
    if (!checked.resourceType || !checked.modelId || !checked.manufacturer) fail('pulse_identity_required');
    delete checked.lockedValue;
    return { ...checked, activeValue };
  }
  fields(value, ['type', 'baseUrl', 'bridgeId', 'serviceId', 'accessoryIdentity', 'credentialRef', 'activeValue'], 'invalid_pulse_connection');
  if (value.type !== 'homebridge') fail('unsupported_pulse_backend');
  return { ...homebridge(connection, false), activeValue };
}

function motorPaths(value = []) {
  if (!Array.isArray(value) || value.length > 4) fail('invalid_motor_paths');
  const ids = new Set(['primary']);
  return value.map(row => {
    fields(row, ['id', 'name', 'type', 'connection', 'openPulseSeconds', 'closePulseSeconds', 'interruption'], 'invalid_motor_path');
    if (!identifier(row.id) || ids.has(row.id)) fail('duplicate_motor_path');
    ids.add(row.id);
    if (row.type !== 'pulse-relay') fail('unsupported_motor_path');
    return { id: row.id, name: string(row.name, 'invalid_motor_path_name', 64), type: row.type,
      connection: pulseConnection(row.connection),
      openPulseSeconds: number(row.openPulseSeconds, 0.1, 2, 'invalid_pulse_duration'),
      closePulseSeconds: number(row.closePulseSeconds, 0.1, 2, 'invalid_pulse_duration'),
      interruption: choice(row.interruption, ['disabled', 'stop-opening-reverse-closing'], 'invalid_interruption_policy') };
  });
}

function source(value) {
  if (!object(value)) fail('invalid_input_source');
  if (value.type === 'homebridge') {
    fields(value, ['type', 'kind', 'baseUrl', 'bridgeId', 'serviceId', 'accessoryIdentity', 'credentialRef'], 'invalid_input_source');
    const { kind, ...connection } = value;
    return { ...homebridge(connection, false), kind: choice(kind, ['button', 'switch'], 'unsupported_input_kind') };
  }
  fields(value, ['type', 'kind', 'baseUrl', 'gatewayId', 'resourceId', 'uniqueId', 'resourceType', 'modelId', 'manufacturer', 'credentialRef', 'alarmId'], 'invalid_input_source');
  if (value.type !== 'deconz') fail('unsupported_input_backend');
  if (typeof value.resourceId !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value.resourceId)) fail('invalid_input_resource');
  const result = { type: 'deconz', kind: choice(value.kind, ['button', 'keypad'], 'unsupported_input_kind'),
    baseUrl: baseUrl(value.baseUrl), gatewayId: string(value.gatewayId, 'invalid_gateway_id'),
    resourceId: value.resourceId, uniqueId: string(value.uniqueId, 'invalid_resource_identity'),
    resourceType: string(value.resourceType, 'invalid_resource_type'), modelId: string(value.modelId, 'invalid_resource_model'),
    manufacturer: string(value.manufacturer, 'invalid_resource_manufacturer'), credentialRef: secretRef(value.credentialRef) };
  if (result.kind === 'keypad') {
    if (!Number.isInteger(value.alarmId) || value.alarmId < 1 || value.alarmId > 255) fail('invalid_input_alarm');
    result.alarmId = value.alarmId;
  } else if (value.alarmId !== undefined) fail('invalid_input_alarm');
  return result;
}

const timingFields = ['openRetractSettleSeconds', 'closeRetractSettleSeconds', 'openingSeconds', 'closingSeconds'];
function inputs(value = [], paths) {
  if (!Array.isArray(value) || value.length > 32) fail('invalid_inputs');
  const ids = new Set();
  return value.map(row => {
    fields(row, ['id', 'name', 'enabled', 'source', 'trigger', 'action', 'motorPath', 'busyBehavior', 'rearmSeconds', 'timing'], 'invalid_input');
    if (!identifier(row.id) || ['homekit', 'virtual-keypad'].includes(row.id) || ids.has(row.id)) fail('invalid_or_duplicate_input_id');
    ids.add(row.id);
    if (typeof row.enabled !== 'boolean') fail('invalid_input_enabled');
    const selected = source(row.source);
    const path = paths.find(path => path.id === row.motorPath);
    if (row.motorPath !== 'primary' && !path) fail('input_motor_path_not_found');
    const action = choice(row.action, selected.kind === 'keypad' ? ['keypad'] : ['open', 'close', 'toggle'], 'invalid_input_action');
    let trigger;
    if (selected.kind === 'button') {
      if (!Number.isInteger(row.trigger) || row.trigger < 0 || row.trigger > (selected.type === 'homebridge' ? 2 : 65535)) fail('invalid_button_event');
      trigger = row.trigger;
    } else if (selected.kind === 'switch') trigger = choice(row.trigger, ['on', 'off', 'either'], 'invalid_switch_edge');
    else { if (row.trigger !== 'native-outcome') fail('invalid_keypad_trigger'); trigger = row.trigger; }
    const busyBehavior = choice(row.busyBehavior, ['drop', 'interrupt'], 'invalid_busy_behavior');
    if (busyBehavior === 'interrupt' && (selected.kind === 'keypad' || action !== 'toggle' || path?.interruption !== 'stop-opening-reverse-closing')) fail('unsupported_input_interruption');
    const timing = row.timing ?? {};
    fields(timing, timingFields, 'invalid_input_timing');
    for (const key of Object.keys(timing)) number(timing[key], key.includes('Retract') ? 0 : 1, key.includes('Retract') ? 120 : 300, 'invalid_input_timing');
    return { id: row.id, name: string(row.name, 'invalid_input_name', 64), enabled: row.enabled, source: selected,
      trigger, action, motorPath: row.motorPath, busyBehavior,
      rearmSeconds: number(row.rearmSeconds, 0, 10, 'invalid_input_rearm'), timing: { ...timing } };
  });
}

function inputKeys(value) {
  if (value.type === 'homebridge') return resourceKeys(value);
  return [
    ['deconz-sensor-identity', value.gatewayId.replaceAll(':', '').toLowerCase(), value.uniqueId.toLowerCase()],
    ['deconz-sensor-resource', value.gatewayId.replaceAll(':', '').toLowerCase(), value.resourceId],
    ['deconz-sensor-endpoint', value.baseUrl, value.resourceId],
  ].map(key => JSON.stringify(key));
}

export function validateConfiguration(input, { allowEmpty = false } = {}) {
  if (!object(input)) fail('invalid_configuration');
  if (!Array.isArray(input.controllers) || (!allowEmpty && input.controllers.length === 0) || input.controllers.length > 32) fail('controllers_required');
  const port = input.managementPort ?? 27773;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('invalid_management_port');
  const ids = new Set(); const resources = new Set();
  const controllers = input.controllers.map(value => {
    fields(value, ['id', 'name', 'door', 'bolt', 'feedback', 'exposeBoltLock', 'motorPaths', 'inputs', 'timing', 'autoBolt', 'keypad'], 'invalid_controller');
    if (!identifier(value.id) || ids.has(value.id)) fail('invalid_or_duplicate_controller_id');
    ids.add(value.id);
    if (typeof value.exposeBoltLock !== 'boolean') fail('bolt_tile_choice_required');
    const result = { id: value.id, name: string(value.name, 'invalid_controller_name', 64), door: door(value.door), bolt: bolt(value.bolt), feedback: feedback(value.feedback), exposeBoltLock: value.exposeBoltLock };
    const timing = value.timing ?? {};
    const bounds = { operationPollSeconds: [0.1, 5, 0.5], idlePollSeconds: [0.5, 30, 2],
      openRetractSettleSeconds: [0, 120, 2], closeRetractSettleSeconds: [0, 120, 2],
      boltTimeoutSeconds: [1, 120, 10], motionTimeoutSeconds: [5, 300, 45], interruptedOpenMarginSeconds: [0, 30, 1] };
    fields(timing, Object.keys(bounds), 'invalid_controller_timing');
    result.timing = Object.fromEntries(Object.entries(bounds).map(([k, [min, max, fallback]]) => [k, number(timing[k] ?? fallback, min, max, 'invalid_controller_timing')]));
    if (value.autoBolt !== undefined && typeof value.autoBolt !== 'boolean') fail('invalid_auto_bolt');
    result.autoBolt = value.autoBolt ?? true;
    result.keypad = null;
    if (value.keypad !== undefined && value.keypad !== null) {
      fields(value.keypad, ['baseUrl', 'gatewayId', 'alarmId', 'credentialRef'], 'invalid_keypad_scope');
      if (!Number.isInteger(value.keypad.alarmId) || value.keypad.alarmId < 1 || value.keypad.alarmId > 255) fail('invalid_keypad_scope');
      result.keypad = { baseUrl: baseUrl(value.keypad.baseUrl), gatewayId: string(value.keypad.gatewayId, 'invalid_gateway_id'),
        alarmId: value.keypad.alarmId, credentialRef: secretRef(value.keypad.credentialRef) };
    }
    result.motorPaths = motorPaths(value.motorPaths);
    result.inputs = inputs(value.inputs, result.motorPaths);
    for (const item of [result.door, result.bolt, ...result.motorPaths.map(path => path.connection)]) {
      for (const key of resourceKeys(item)) {
        if (resources.has(key)) fail('duplicate_hardware_owner');
        resources.add(key);
      }
    }
    return result;
  });
  const bindings = new Map();
  for (const controller of controllers) for (const input of controller.inputs) {
    for (const key of inputKeys(input.source)) {
      if (resources.has(key)) fail('input_output_feedback_loop');
      const existing = bindings.get(key) ?? [];
      if (existing.some(other => other.source.kind !== input.source.kind || other.trigger === input.trigger ||
        other.trigger === 'either' || input.trigger === 'either')) fail('overlapping_input_binding');
      existing.push(input); bindings.set(key, existing);
    }
  }
  return { managementPort: port, controllers };
}

export function routingInventory(controller) {
  return {
    controllerId: controller.id,
    builtins: { homekit: 'primary', virtualKeypad: 'primary' },
    motorPaths: [{ id: 'primary', name: 'Primary opener', type: controller.door.type, interruption: 'disabled' },
      ...(controller.motorPaths ?? []).map(({ id, name, type, interruption }) => ({ id, name, type, interruption }))],
    inputs: (controller.inputs ?? []).map(({ id, name, enabled, source, action, trigger, motorPath, busyBehavior, rearmSeconds, timing }) =>
      ({ id, name, enabled, source: { type: source.type, kind: source.kind }, action, trigger, motorPath, busyBehavior, rearmSeconds, timing })),
    runtimeEnabled: false,
  };
}

export function inventory(configuration) {
  return configuration.controllers.map(controller => ({
    id: controller.id, name: controller.name,
    doorBackend: controller.door.type, boltBackend: controller.bolt.type,
    exposeBoltLock: controller.exposeBoltLock,
    feedback: { closing: controller.feedback.closing, opening: controller.feedback.opening, bolt: controller.feedback.bolt },
    status: { phase: 'not-commissioned', door: 'unknown', bolt: 'unknown', actuationEnabled: false },
  }));
}
