#!/usr/bin/env python3
"""Development-only contract capture from a reviewed standalone source checkout.

Uses its synthetic Model, temporary application state, and no gateway transport.
The Node plugin never invokes Python. Pass the pinned extracted-admin checkout.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--reference', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
provenance = json.loads((Path(__file__).resolve().parent.parent / 'test/fixtures/web-admin-reference.json').read_text())
for row in provenance['files']:
    data = (args.reference / row['path']).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if actual != row['sha']:
        raise SystemExit('Reference source differs from the pinned revision: ' + row['path'])
sys.dont_write_bytecode = True
sys.path[:0] = [str(args.reference.resolve()), str((args.reference / 'configurator/tests').resolve())]
from configurator.core import Core
from configurator.editing import Editor
from configurator.presentation import overview
from configurator.activity import Activity
from configurator.schedule import policy
from configurator.common import Rejected
from test_editing import Model
from support import config, IDENTITY, USER

model = Model()
original_read = model.read
responses = {}
radio = '00:11:22:33:44:55:66:77-01-0501'
def read(path):
    if path == '/sensors':
        value = {'3': {'name': 'Synthetic keypad', 'type': 'ZHAAncillaryControl',
                        'uniqueid': radio, 'config': {'reachable': True}},
                 '4': {'name': 'Unrecognized radio', 'type': 'ZHAAncillaryControl',
                        'uniqueid': 'synthetic-unknown', 'config': {'reachable': False}}}
    elif path == '/alarmsystems':
        value = {aid: {'name': 'Alarm ' + aid, 'devices': {radio: {}, 'synthetic-unknown': {}},
                       'state': {'armstate': 'disarmed'}} for aid in model.grants}
    else:
        value = copy.deepcopy(original_read(path))
        if path.endswith('/users'):
            for row in value.values(): row['pin'] = 'synthetic-never-project'
    responses[path] = copy.deepcopy(value)
    return value
model.read = read
model.grants['1'][USER]['keypads'] = [{'source': 'abcdef', 'endpoint': 2}]
model.locks.append({'source': 'ffee', 'endpoint': 3, 'remaining_seconds': 7, 'level': 1})
registration = {'id': 'test', 'name': 'Synthetic gateway', 'identity': IDENTITY,
                'endpoint': 'http://127.0.0.1:1', 'key': 'synthetic-key'}
with tempfile.TemporaryDirectory() as temp:
    core = Core(config(Path(temp), [registration]), model.factory)
    view = core.view('test', 1)
    expected = {'inventory': view.inventory(), 'alarm': view.alarm(), 'users': view.users(),
                'lockout': view.lockout(), 'snapshot': Editor(view).snapshot(),
                'administration': overview(view)}
    capabilities = {str(alarm): view.client.verify(alarm) for alarm in (1, 2)}
    # Future, synthetic timestamps keep captures independent of the host clock
    # and the reference database's automatic age pruning.
    events = [(1, 'Owner', 'Keypad · Synthetic', 'Disarm', 'Accepted', '2099-01-01T12:00:00Z'),
              (1, 'Administrator', 'Configuration', 'Save user', 'Verified', '2099-01-01T12:00:01Z'),
              (3, 'System', 'Keypad', 'Lockout expired', 'Confirmed', '2099-01-01T12:00:02Z')]
    for alarm, user, source, action, result, stamp in events:
        core.history('test', alarm).add(user, source, action, result, stamp=stamp)
    activity = Activity(core)
    query = {'gateway': None, 'alarm': None, 'categories': ['keypad', 'deconz', 'administration']}
    history = {'scopes': [{'gateway': 'test', 'alarm': alarm} for alarm in (1, 3)],
               'rows': {str(alarm): core.history('test', alarm).rows(5000) for alarm in (1, 3)},
               'query': query, 'options': activity.options(), 'expected': activity.query(query)}
    editor = Editor(view)
    owner = copy.deepcopy(expected['snapshot']['grants']['1'][USER])
    owner['alarm'] = 1
    plans = []
    def plan_case(label, operation, body, state=None):
        state = copy.deepcopy(state or expected['snapshot'])
        row = {'name': label, 'operation': operation, 'body': copy.deepcopy(body), 'snapshot': state}
        try:
            intent, payload = editor.plan(operation, copy.deepcopy(body), copy.deepcopy(state))
            row['expected'] = {'plan': intent, 'payload': payload}
        except Rejected as error:
            row['error'] = str(error)
        plans.append(row)
    plan_case('rename identity across grants', 'save_user', dict(owner, name='Owner renamed'))
    plan_case('protect last owner on delete', 'delete_user', {key: owner[key] for key in ('id','alarm','revision','user_revision')})
    plan_case('protect last owner on disable', 'save_user', dict(owner, enabled=False))
    plan_case('stale grant revision', 'save_user', dict(owner, revision=0))
    plan_case('existing PIN requires rotation', 'save_user', dict(owner, pin='1234'))
    plan_case('duplicate keypad', 'save_user', dict(owner, keypads=owner['keypads'] * 2))
    plan_case('noncanonical keypad address', 'save_user', dict(owner, keypads=[{'source':'00ab','endpoint':1}]))
    plan_case('new scheduled guest', 'save_user', dict(owner, id=None, name='Guest', owner=False, revision=0, user_revision=0, pin='4321',
        schedule={'timezone':'America/Los_Angeles','weekly':'Mon 08:00-17:00\nSat 09:30-24:00','expires_local':'2026-12-01T12:00','not_before':None}))
    existing_schedule = copy.deepcopy(expected['snapshot'])
    existing_schedule['grants']['1'][USER]['schedule'] = {'timezone':'UTC','not_before':None,'expires_at':None,'windows':[]}
    # Preserve an existing non-owner schedule; another unrestricted owner remains.
    guest_id = 'b' * 32
    guest_row = dict(existing_schedule['grants']['1'][USER], id=guest_id, name='Guest', owner=False)
    existing_schedule['grants']['1'][USER] = copy.deepcopy(expected['snapshot']['grants']['1'][USER])
    existing_schedule['identities'][guest_id] = dict(existing_schedule['identities'][USER], id=guest_id, name='Guest')
    existing_schedule['grants']['1'][guest_id] = guest_row
    preserve_body = {k:v for k,v in guest_row.items() if k != 'schedule'}
    plan_case('preserve existing schedule', 'save_user', dict(preserve_body, alarm=1, preserve_schedule=True), existing_schedule)
    plan_case('delete guest grant only', 'delete_user', {'id':guest_id,'alarm':1,'revision':1,'user_revision':1}, existing_schedule)
    plan_case('coordinated PIN rotation', 'rotate_pin', {'id':USER,'revision':1,'user_revision':1,'new_pin':'4321','repeat_pin':'4321'})
    plan_case('PIN mismatch', 'rotate_pin', {'id':USER,'revision':1,'user_revision':1,'new_pin':'4321','repeat_pin':'4322'})
    timers = dict(expected['alarm']['timings']); timers['armed_stay_entry_delay'] += 1
    plan_case('disarmed alarm timers', 'save_alarm', {'revision':expected['alarm']['revision'],'timings':timers})
    armed = copy.deepcopy(expected['snapshot']); armed['alarm']['state'] = 'armed_away'
    plan_case('armed alarm timers rejected', 'save_alarm', {'revision':expected['alarm']['revision'],'timings':timers}, armed)
    plan_case('protection policy', 'save_lockout', expected['lockout']['policy'])
    plan_case('explicit protection reset', 'reset_lockout', {'reset':True})
    schedules = []
    for zone, expiry in [('America/Los_Angeles','2026-03-08T02:30'),('America/Los_Angeles','2026-11-01T01:30'),
                         ('Australia/Lord_Howe','2026-10-04T02:15'),('Australia/Lord_Howe','2026-04-05T01:45'),
                         ('Asia/Kathmandu','2026-10-08T19:30'),('US/Pacific','2026-10-08T19:30'),
                         ('UTC','2026-02-30T12:00'),('UTC','2026-10-08T19:30')]:
        row = {'body':{'timezone':zone,'weekly':'Mon 00:00-24:00\nSun 12:00-13:00','expires_local':expiry,'not_before':None}}
        try: row['expected'] = policy(row['body'])
        except Rejected as error: row['error'] = str(error)
        schedules.append(row)
    assert model.writes == []
    result = {'source': {key: provenance[key] for key in ('repository', 'commit')},
              'responses': responses, 'capabilities': capabilities, 'expected': expected, 'history': history,
              'plans': plans, 'schedules': schedules}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
print('Captured synthetic read-model contracts; no network or device writes.')
