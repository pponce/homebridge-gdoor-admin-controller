import test from 'node:test';
import assert from 'node:assert/strict';
import { controllerTimingValues, profileWithTimings } from '../src/controller-timings.js';
import { validateConfiguration } from '../src/config.js';
import { readFile } from 'node:fs/promises';
const base = JSON.parse(await readFile(new URL('../examples/development-config.json', import.meta.url)));
test('device overrides retain explicit zero, remove inheritance overrides, and reject injected settings', () => {
  const config = structuredClone(base), profile = config.controllers[0];
  profile.inputs = [{ id: 'button', name: 'Indoor button', enabled: true,
    source: { type: 'deconz', kind: 'button', baseUrl: 'http://example.invalid', gatewayId: '0011223344556677',
      resourceId: '80', uniqueId: 'button-endpoint', resourceType: 'ZHASwitch', modelId: 'EXAMPLE', manufacturer: 'Example', credentialRef: 'example-key' },
    trigger: 1002, action: 'toggle', motorPath: 'primary', busyBehavior: 'drop', rearmSeconds: 1.5,
    timing: { openingSeconds: 15, closeRetractSettleSeconds: 0 } }];
  const normalized = validateConfiguration(config).controllers[0], values = controllerTimingValues(normalized);
  delete values.inputs[0].timing.openingSeconds;
  values.inputs[0].rearmSeconds = 2;
  const changed = profileWithTimings(normalized, values);
  assert.deepEqual(changed.inputs[0].timing, { closeRetractSettleSeconds: 0 });
  assert.equal(changed.inputs[0].rearmSeconds, 2); assert.deepEqual(changed.inputs[0].source, normalized.inputs[0].source);
  assert.equal(normalized.inputs[0].timing.openingSeconds, 15);
  assert.doesNotThrow(() => validateConfiguration({ ...config, controllers: [changed] }));
  for (const mutation of [v => { v.inputs[0].action = 'open'; }, v => { v.inputs[0].id = 'unknown'; }, v => { v.inputs.push(v.inputs[0]); }]) {
    const bad = structuredClone(values); mutation(bad); assert.throws(() => profileWithTimings(normalized, bad));
  }
});
