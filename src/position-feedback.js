import { requireValue } from './fault.js';
import { selectedSensor, activeExternalSensors, OPENER_OPEN } from '../homebridge-ui/public/position-sensors.js';

// Commands and safety flags stay with the opener. Only selected contacts
// replace its endpoint readings; unused contacts are never read.
export class PositionFeedbackDoor {
  constructor(profile, opener, resolveSensor) {
    this.profile = profile; this.opener = opener;
    this.sensors = new Map(activeExternalSensors(profile).map(sensor => [sensor.id, resolveSensor(sensor)]));
    const externalOpen = this.sensors.has(selectedSensor(profile, 'open'));
    const builtinOpen = selectedSensor(profile, 'open') === OPENER_OPEN &&
      (profile.door.type !== 'tailwind' || profile.door.openSensorDoorIndex !== undefined);
    this.capabilities = Object.freeze({ ...opener.capabilities,
      openSensor: profile.feedback.opening === 'sensor' && (externalOpen || builtinOpen) });
  }
  async read() {
    const [base, readings] = await Promise.all([this.opener.read(),
      Promise.all([...this.sensors].map(async ([id, sensor]) => [id, await sensor.read()]))]);
    const contacts = new Map(readings);
    for (const reading of contacts.values()) requireValue(typeof reading?.active === 'boolean', 'door_sensor_invalid');
    const closedContact = contacts.get(selectedSensor(this.profile, 'closed'));
    const openContact = contacts.get(selectedSensor(this.profile, 'open'));
    const closed = closedContact ? closedContact.active : base.door === 'closed';
    const open = this.profile.feedback.opening === 'sensor' && (openContact ? openContact.active : base.door === 'open');
    requireValue(!(closed && open), 'door_sensor_conflict');
    return { ...base,
      door: closed ? 'closed' : open ? 'open' : ['opening', 'closing'].includes(base.door) ? base.door : 'not-closed',
      evidence: closed ? closedContact ? 'closed-sensor' : base.evidence : open ? 'open-sensor' : 'position-sensors',
    };
  }
  async write(command, options) { await this.read(); return this.opener.write(command, options); }
  restart() { return this.opener.restart(); }
}
export function withPositionFeedback(profile, opener, resolveSensor) {
  return profile.sensors?.length || profile.feedback.closedSensor !== undefined || profile.feedback.openSensor !== undefined
    ? new PositionFeedbackDoor(profile, opener, resolveSensor) : opener;
}
