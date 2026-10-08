// Shared policy projections from configurator/domain.py; no gateway I/O.
import { requireWeb, exact, integer } from './web-admin-common.js';

export const userFields = ['id', 'name', 'enabled', 'user_revision', 'remaining_uses', 'revision', 'api_arm_disarm', 'grant_enabled', 'owner', 'arm', 'disarm', 'all_keypads', 'keypads'];
export const identityFields = ['id', 'name', 'enabled', 'revision', 'user_revision'];
export const grantFields = [...userFields, 'schedule'];
export const alarmModes = ['disarmed', 'armed_stay', 'armed_night', 'armed_away'];
export const alarmStates = [...alarmModes, 'exit_delay', 'entry_delay', 'not_ready', 'in_alarm', 'arming_stay', 'arming_night', 'arming_away'];
export const alarmTimingFields = alarmModes.slice(1).flatMap(mode => ['entry_delay', 'exit_delay', 'trigger_duration'].map(field => mode + '_' + field));
export const unrestricted = row => ['enabled', 'grant_enabled', 'owner', 'arm', 'disarm', 'api_arm_disarm'].every(key => row[key] === true) && row.remaining_uses === null && row.schedule === null;
export function alarmTimings(value) {
  requireWeb(exact(value, alarmTimingFields) && Object.values(value).every(v => integer(v, 0, 255)), 'invalid_alarm_timings');
  return { ...value };
}
export function lockoutPolicy(value) {
  requireWeb(exact(value, ['enabled', 'threshold', 'window_seconds', 'durations_seconds', 'reset_seconds', 'revision']) && typeof value.enabled === 'boolean', 'invalid_lockout_policy');
  for (const [key, low, high] of [['threshold', 1, 100], ['window_seconds', 1, 3600], ['reset_seconds', 3600, 604800], ['revision', 0, Number.MAX_SAFE_INTEGER]]) requireWeb(integer(value[key], low, high), 'invalid_lockout_policy');
  requireWeb(Array.isArray(value.durations_seconds) && value.durations_seconds.length === 3 && value.durations_seconds.every((duration, i, rows) => integer(duration, 1, 3600) && (i === 0 || duration >= rows[i - 1])), 'invalid_lockout_policy');
  return structuredClone(value);
}
