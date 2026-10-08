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
    assert model.writes == []
    result = {'source': {key: provenance[key] for key in ('repository', 'commit')},
              'responses': responses, 'capabilities': capabilities, 'expected': expected, 'history': history}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
print('Captured synthetic read-model contracts; no network or device writes.')
