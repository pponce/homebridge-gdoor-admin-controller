import { controllerTimingFields, controllerTimingValues } from './controller-timings.js';
import { WebAdminError } from './web-admin-auth.js';
import { requireWeb, exact, integer } from './web-admin-common.js';
import { Fault } from './fault.js';

export class WebAdminController {
  constructor(runtime) { this.runtime = runtime; }
  read() {
    return { revision: this.runtime.state.revision, fields: controllerTimingFields,
      controllers: this.runtime.configuration.controllers.map(profile => ({ id: profile.id, name: profile.name,
        status: this.runtime.status(profile.id), values: controllerTimingValues(profile),
        feedback: { opening: profile.feedback.opening, closing: profile.feedback.closing, bolt: profile.feedback.bolt },
        inputs: profile.inputs.map(input => ({ id: input.id, name: input.name, enabled: input.enabled, motorPath: input.motorPath })),
        motorPaths: profile.motorPaths.map(motor => ({ id: motor.id, name: motor.name })),
      })) };
  }
  async dispatch(operation, body) {
    if (operation === 'controller_settings') { requireWeb(exact(body, []), 'invalid_request'); return this.read(); }
    requireWeb(operation === 'controller_timings_save' && exact(body, ['controllerId', 'revision', 'values']) &&
      typeof body.controllerId === 'string' && integer(body.revision, 1, Number.MAX_SAFE_INTEGER), 'invalid_request');
    try { await this.runtime.applyTimings(body.controllerId, body.values, body.revision); }
    catch (error) { if (error instanceof Fault || error.name === 'ConfigurationError') throw new WebAdminError(error.message); throw error; }
    return { ...this.read(), saved: true, restart_required: false };
  }
}
