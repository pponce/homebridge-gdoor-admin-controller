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
  fields(value, ['type', 'bridgeId', 'serviceId', 'credentialRef', ...(bolt ? ['serviceType', 'lockedValue'] : [])], 'invalid_homebridge_connection');
  const result = {
    type: 'homebridge',
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
    ['deconz-identity', value.gatewayId.toLowerCase(), value.uniqueId.toLowerCase()],
    ['deconz-resource', value.gatewayId.toLowerCase(), value.resourceId],
    ['deconz-endpoint', value.baseUrl, value.resourceId],
  ].map(key => JSON.stringify(key));
}

export function validateConfiguration(input) {
  if (!object(input)) fail('invalid_configuration');
  if (!Array.isArray(input.controllers) || input.controllers.length === 0 || input.controllers.length > 32) fail('controllers_required');
  const port = input.managementPort ?? 27773;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('invalid_management_port');
  const ids = new Set(); const resources = new Set();
  const controllers = input.controllers.map(value => {
    fields(value, ['id', 'name', 'door', 'bolt', 'feedback', 'exposeBoltLock'], 'invalid_controller');
    if (!identifier(value.id) || ids.has(value.id)) fail('invalid_or_duplicate_controller_id');
    ids.add(value.id);
    if (typeof value.exposeBoltLock !== 'boolean') fail('bolt_tile_choice_required');
    const result = { id: value.id, name: string(value.name, 'invalid_controller_name', 64), door: door(value.door), bolt: bolt(value.bolt), feedback: feedback(value.feedback), exposeBoltLock: value.exposeBoltLock };
    for (const item of [result.door, result.bolt]) {
      for (const key of resourceKeys(item)) {
        if (resources.has(key)) fail('duplicate_hardware_owner');
        resources.add(key);
      }
    }
    return result;
  });
  return { managementPort: port, controllers };
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
