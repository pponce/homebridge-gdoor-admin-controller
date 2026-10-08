'use strict';
// No transport exists in this preview. Unsupported requests fail locally.
window.StaticDemo = (() => {
  const copy = value => structuredClone(value);
  let revision = 1;
  const seed = () => ['Main garage', 'Workshop garage'].map((name, index) => ({
    id: 'demo-garage-' + index, name,
    feedback: { opening: 'timed estimate', closing: 'closed sensor', bolt: 'relay state' },
    status: { enabled: true, health: { title: 'Ready', detail: 'Fictional device states for this preview.' },
      state: { door: 'closed', bolt: 'locked', busy: false }, canRecover: false },
    inputs: [{ id: 'keypad', name: 'Xfinity keypad', enabled: true, motorPath: 'relay' },
      { id: 'button', name: 'Indoor button', enabled: true, motorPath: 'relay' }],
    motorPaths: [{ id: 'relay', name: 'Opener relay' }],
    values: {
      timing: { openRetractSettleSeconds: 1, closeRetractSettleSeconds: 1, operationPollSeconds: 0.5,
        idlePollSeconds: 3, boltTimeoutSeconds: 10, motionTimeoutSeconds: 60, interruptedOpenMarginSeconds: 2 },
      feedback: { openingSeconds: 15, closingSeconds: 15, closedStableSeconds: 2, boltSettleSeconds: 1 },
      inputs: [{ id: 'keypad', rearmSeconds: 1, timing: {} }, { id: 'button', rearmSeconds: 1, timing: {} }],
      motorPaths: [{ id: 'relay', openPulseSeconds: 0.5, closePulseSeconds: 0.5 }],
    },
  }));
  let controllers = seed();
  const controllerView = () => copy({ revision: String(revision), fields: window.StaticDemoFields, controllers });
  async function request(path, body, context) {
    if (path === 'session') return { csrf: 'fictional-demo-session', role: 'admin', username: 'Demo visitor' };
    if (path === 'setup') return { access_mode: 'manage', controller_settings_available: true, onboarding_required: false, extensions: [] };
    if (path === 'controller') return controllerView();
    if (path === 'controller/timings') {
      const controller = controllers.find(row => row.id === body.controllerId);
      if (!controller || body.revision !== String(revision)) throw Error('Reload the demo timings before saving.');
      controller.values = copy(body.values); revision++;
      return controllerView();
    }
    if (['login', 'logout', 'accounts', 'settings'].includes(path) || /^(?:account|setup|controller|extensions)\//.test(path)) {
      throw Error('Installation settings and real accounts are not part of this static demo.');
    }
    return window.ConfiguratorDemo.request(path, body, context);
  }
  return Object.freeze({ request, reset() { controllers = seed(); revision++; window.ConfiguratorDemo.reset(); } });
})();
