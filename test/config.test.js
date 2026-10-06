import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfiguration, inventory } from '../src/config.js';

const example = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(example);
test('all four agreed door/bolt connection combinations can be declared', () => {
  for (const doorType of ['tailwind', 'homebridge']) for (const boltType of ['deconz', 'homebridge']) {
    const config = copy();
    if (doorType === 'homebridge') config.controllers[0].door = { type: doorType, bridgeId: 'EXAMPLE-DOOR-BRIDGE', serviceId: 'garage-service', credentialRef: 'example-hb-key' };
    if (boltType === 'homebridge') config.controllers[0].bolt = { type: boltType, bridgeId: 'EXAMPLE-BOLT-BRIDGE', serviceId: 'bolt-service', credentialRef: 'example-hb-key', serviceType: 'switch', lockedValue: false };
    const result = validateConfiguration(config);
    assert.equal(result.controllers[0].door.type, doorType);
    assert.equal(result.controllers[0].bolt.type, boltType);
  }
});
for (const missing of ['door', 'bolt']) test(`rejects a controller without ${missing}`, () => {
  const config = copy(); delete config.controllers[0][missing];
  assert.throws(() => validateConfiguration(config), /door_and_bolt_required/);
});
for (const type of ['homekit', 'automation', 'mqtt']) test(`does not silently accept out-of-scope ${type} opener`, () => {
  const config = copy(); config.controllers[0].door.type = type;
  assert.throws(() => validateConfiguration(config), /unsupported_door_backend/);
});
test('rejects competing controller declarations for the same door or bolt', () => {
  const config = copy(); const second = structuredClone(config.controllers[0]);
  second.id = 'second'; second.name = 'Second'; config.controllers.push(second);
  assert.throws(() => validateConfiguration(config), /duplicate_hardware_owner/);
  second.door.doorIndex = 1;
  assert.throws(() => validateConfiguration(config), /duplicate_hardware_owner/);
  second.bolt.uniqueId = 'second-bolt-endpoint'; second.bolt.resourceId = '2';
  assert.equal(validateConfiguration(config).controllers.length, 2);
});
test('inconsistent deCONZ identity declarations cannot reuse the same resource', () => {
  const config = copy(); const second = structuredClone(config.controllers[0]);
  second.id = 'second'; second.door.doorIndex = 1;
  second.bolt.uniqueId = 'inconsistent-identity'; config.controllers.push(second);
  assert.throws(() => validateConfiguration(config), /duplicate_hardware_owner/);
  second.bolt.gatewayId = 'inconsistent-gateway';
  assert.throws(() => validateConfiguration(config), /duplicate_hardware_owner/);
});
test('requires explicit estimated-bolting policy and separate bounded travel times', () => {
  const config = copy(); config.controllers[0].feedback.closing = 'timed';
  assert.equal(validateConfiguration(config).controllers[0].feedback.allowEstimatedBolting, false);
  delete config.controllers[0].feedback.allowEstimatedBolting;
  assert.throws(() => validateConfiguration(config), /estimated_bolting_policy_required/);
  config.controllers[0].feedback.allowEstimatedBolting = true;
  config.controllers[0].feedback.openingSeconds = 12;
  config.controllers[0].feedback.closingSeconds = 30;
  assert.equal(validateConfiguration(config).controllers[0].feedback.closingSeconds, 30);
  config.controllers[0].feedback.closingSeconds = Infinity;
  assert.throws(() => validateConfiguration(config), /invalid_closing_time/);
});
test('errors and inventory do not disclose credentials, private endpoints or secret references', () => {
  const config = copy(); config.controllers[0].door.baseUrl = 'http://user:sensitive-password@example.invalid';
  assert.throws(() => validateConfiguration(config), error => error.message === 'invalid_device_url');
  const text = JSON.stringify(inventory(validateConfiguration(copy())));
  for (const secret of ['example.invalid', 'credentialRef', 'example-tailwind-key', 'example-bolt-endpoint']) assert.equal(text.includes(secret), false);
});
test('rejects raw secrets in controller connections and invalid switch/lock mappings', () => {
  const config = copy(); config.controllers[0].door.token = 'must-not-be-accepted';
  assert.throws(() => validateConfiguration(config), /invalid_tailwind_connection/);
  delete config.controllers[0].door.token;
  config.controllers[0].bolt = { type: 'homebridge', bridgeId: 'bolt-bridge', serviceId: 'bolt', credentialRef: 'bolt-key', serviceType: 'switch' };
  assert.throws(() => validateConfiguration(config), /invalid_bolt_mapping/);
  config.controllers[0].bolt.serviceType = 'lock';
  assert.equal(validateConfiguration(config).controllers[0].bolt.serviceType, 'lock');
});
