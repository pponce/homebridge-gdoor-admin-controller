// The only fields the web timing editor may read and change. Connections,
// feedback modes, input actions and commissioning remain outside this API.
import { requireValue } from './fault.js';

export const controllerTimingFields = {
  timing: [
    ['openRetractSettleSeconds', 'Before opening: bolt retraction wait', 0, 120],
    ['closeRetractSettleSeconds', 'Before closing: bolt retraction wait', 0, 120],
    ['operationPollSeconds', 'Check interval during an operation', 0.1, 5],
    ['idlePollSeconds', 'Check interval while idle', 0.5, 30],
    ['boltTimeoutSeconds', 'Bolt timeout', 1, 120],
    ['motionTimeoutSeconds', 'Door movement timeout', 5, 300],
    ['interruptedOpenMarginSeconds', 'Extra opening time after interruption', 0, 30],
  ],
  feedback: [
    ['openingSeconds', 'Opening travel time', 1, 300],
    ['closingSeconds', 'Closing travel time', 1, 300],
    ['closedStableSeconds', 'Closed sensor stability wait', 0, 60],
    ['boltSettleSeconds', 'Bolt extension settling time', 0, 60],
  ],
  inputs: [
    ['openRetractSettleSeconds', 'Before opening: bolt retraction wait', 0, 120],
    ['closeRetractSettleSeconds', 'Before closing: bolt retraction wait', 0, 120],
    ['openingSeconds', 'Opening travel time', 1, 300],
    ['closingSeconds', 'Closing travel time', 1, 300],
  ],
  motorPaths: [['openPulseSeconds', 'Opening pulse', 0.1, 2], ['closePulseSeconds', 'Closing pulse', 0.1, 2]],
};
const keys = fields => fields.map(row => row[0]);
const pick = (value, names) => Object.fromEntries(names.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
export function controllerTimingValues(profile) {
  return {
    timing: pick(profile.timing, keys(controllerTimingFields.timing)),
    feedback: pick(profile.feedback, keys(controllerTimingFields.feedback)),
    inputs: profile.inputs.map(input => ({ id: input.id, rearmSeconds: input.rearmSeconds, timing: { ...input.timing }, ...pick(input, ['allowDuringOpenerLockout']) })),
    motorPaths: profile.motorPaths.map(motor => ({ id: motor.id, ...pick(motor, [...keys(controllerTimingFields.motorPaths), 'allowDuringOpenerLockout']) })),
  };
}
export function profileWithTimings(profile, values) {
  requireValue(exact(values, ['timing', 'feedback', 'inputs', 'motorPaths']) &&
    exact(values.timing, keys(controllerTimingFields.timing)) && exact(values.feedback, keys(controllerTimingFields.feedback)), 'invalid_controller_timings');
  const copy = structuredClone(profile);
  Object.assign(copy.timing, values.timing); Object.assign(copy.feedback, values.feedback);
  for (const group of ['inputs', 'motorPaths']) {
    const rows = values[group];
    requireValue(Array.isArray(rows) && rows.length === profile[group].length && new Set(rows.map(row => row?.id)).size === rows.length, 'invalid_controller_timings');
    for (const row of rows) {
      const permission = Object.hasOwn(row, 'allowDuringOpenerLockout');
      requireValue(!permission || typeof row.allowDuringOpenerLockout === 'boolean', 'invalid_controller_timings');
      requireValue(exact(row, [...(group === 'inputs' ? ['id', 'timing', 'rearmSeconds'] : ['id', ...keys(controllerTimingFields.motorPaths)]), ...(permission ? ['allowDuringOpenerLockout'] : [])]), 'invalid_controller_timings');
      const target = copy[group].find(value => value.id === row.id);
      requireValue(target, 'invalid_controller_timings');
      Object.assign(target, structuredClone(row));
    }
  }
  // Full configuration normalization validates numbers, ranges and input overrides.
  return copy;
}
