// Built-in entries are derived from the opener, without a second hardware owner.
export const OPENER_CLOSED = 'opener-closed';
export const OPENER_OPEN = 'opener-open';
export const sensorField = endpoint => endpoint === 'closed' ? 'closedSensor' : 'openSensor';
export const feedbackMode = endpoint => endpoint === 'closed' ? 'closing' : 'opening';
export const selectedSensor = (profile, endpoint) => profile.feedback[sensorField(endpoint)] ??
  (endpoint === 'closed' ? OPENER_CLOSED : OPENER_OPEN);
export function builtinSensors(profile) {
  if (profile.door.type === 'tailwind') return [
    { id: OPENER_CLOSED, name: 'Tailwind closed sensor', endpoint: 'closed', input: profile.door.doorIndex },
    ...(profile.door.openSensorDoorIndex !== undefined ? [
      { id: OPENER_OPEN, name: 'Tailwind open sensor', endpoint: 'open', input: profile.door.openSensorDoorIndex },
    ] : []),
  ];
  if (profile.door.type === 'ratgdo-homekit') return [
    { id: OPENER_CLOSED, name: 'ratgdo closed feedback', endpoint: 'closed' },
    { id: OPENER_OPEN, name: 'ratgdo open feedback', endpoint: 'open' },
  ];
  return [];
}
export function sensorChoices(profile, endpoint) {
  const builtin = builtinSensors(profile).filter(sensor => sensor.endpoint === endpoint);
  if (profile.door.type === 'homebridge') builtin.push({
    id: endpoint === 'closed' ? OPENER_CLOSED : OPENER_OPEN, name: 'Garage opener ' + endpoint + ' feedback', endpoint,
  });
  return [...builtin, ...(profile.sensors ?? []).map(sensor => ({ id: sensor.id, name: sensor.name }))];
}
export function activeExternalSensors(profile) {
  return (profile.sensors ?? []).filter(sensor => ['closed', 'open'].some(endpoint =>
    profile.feedback[feedbackMode(endpoint)] === 'sensor' && selectedSensor(profile, endpoint) === sensor.id));
}
