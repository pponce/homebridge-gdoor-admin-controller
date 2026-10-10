import { controllerTimingFields, controllerTimingValues } from './controller-timings.js';
import { WebAdminError } from './web-admin-auth.js';
import { requireWeb, exact, integer } from './web-admin-common.js';
import { PLUGIN_VERSION } from './api.js';
import { Fault } from './fault.js';

export class WebAdminController {
  constructor(runtime) { this.runtime = runtime; }
  troubleshooting(profile) {
    const entry = this.runtime.entry(profile.id), engine = entry.engine;
    const observedAt = engine?.observedAt || null;
    const ageMs = observedAt ? Math.max(0, Date.now() - observedAt) : null;
    return {
      pluginVersion: PLUGIN_VERSION, observedAt, ageMs,
      fresh: ageMs !== null && ageMs <= Math.max(10000, profile.timing.idlePollSeconds * 2500),
      initialized: engine?.initialized === true, observationInProgress: Boolean(engine?.observation),
      operationPending: Boolean(entry.job), activeInput: entry.router?.activeInput ?? null,
      inputEligibility: Object.fromEntries(profile.inputs.map(input => [input.id, entry?.router?.context(input.id).eligible ?? false])),
      activeMotorPath: engine?.busy ? [...engine.motorPaths].find(([, motor]) => motor === engine.motor)?.[0] ?? null : null,
      interruptionAllowed: engine?.interruptionAllowed === true,
      partialStopOwner: engine?.partialOwner ?? null, autoClosePending: engine?.autoClosePending === true,
      autoBolt: profile.autoBolt, restartWaitMs: Math.max(0, (entry.restartingUntil ?? 0) - Date.now()),
      homekit: this.runtime.homekitStatus?.(profile.id) ?? null,
      motorPaths: profile.motorPaths.map(path => ({ id: path.id, name: path.name,
        busy: engine?.motorPaths.get(path.id)?.busy === true,
        stopped: engine?.motorPaths.get(path.id)?.stopped === true })),
    };
  }
  read() {
    return { revision: this.runtime.state.revision, fields: controllerTimingFields,
      controllers: this.runtime.configuration.controllers.map(profile => ({ id: profile.id, name: profile.name,
        status: this.runtime.status(profile.id), troubleshooting: this.troubleshooting(profile), values: controllerTimingValues(profile),
        feedback: { opening: profile.feedback.opening, closing: profile.feedback.closing, bolt: profile.feedback.bolt },
        inputs: profile.inputs.map(input => ({ id: input.id, name: input.name, enabled: input.enabled, motorPath: input.motorPath })),
        motorPaths: profile.motorPaths.map(motor => ({ id: motor.id, name: motor.name })),
      })) };
  }
  async dispatch(operation, body) {
    if (operation === 'controller_settings') { requireWeb(exact(body, []), 'invalid_request'); return this.read(); }
    if (['controller_recover', 'controller_check_state', 'controller_restart_tailwind'].includes(operation)) {
      requireWeb(exact(body, ['controllerId', 'revision', 'bootId']) && typeof body.controllerId === 'string' &&
        integer(body.revision, 1, Number.MAX_SAFE_INTEGER) && typeof body.bootId === 'string', 'invalid_request');
      try { await this.runtime[{ controller_recover: 'recover', controller_check_state: 'checkStateNow', controller_restart_tailwind: 'restartTailwind' }[operation]](body.controllerId, body); }
      catch (error) { if (error instanceof Fault) throw new WebAdminError(error.message); throw error; }
      return this.read();
    }
    requireWeb(operation === 'controller_timings_save' && exact(body, ['controllerId', 'revision', 'values']) &&
      typeof body.controllerId === 'string' && integer(body.revision, 1, Number.MAX_SAFE_INTEGER), 'invalid_request');
    try { await this.runtime.applyTimings(body.controllerId, body.values, body.revision); }
    catch (error) { if (error instanceof Fault || error.name === 'ConfigurationError') throw new WebAdminError(error.message); throw error; }
    return { ...this.read(), saved: true, restart_required: false };
  }
}
