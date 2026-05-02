import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';

describe('validateDefinition (step/transition)', () => {
  test('reports invalid transition terminal shape', () => {
    const result = validateDefinition({
      'sop_id': 'valid_id',
      'name': 'Valid',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 1,
        'idempotency_key_template': 'key',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'same',
        },
      },
      'steps': [{
        'id': 'step_a',
        'title': 'A',
        'inputs': {},
        'executor': {
          'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search', 'path': '/tmp/workspace' },
          'timeout_secs': 120,
          'allow_network': true,
          'env': {},
          'resource_limits': {
            'max_output_bytes': 1024,
            'max_artifacts': 1,
          },
        },
        'output_schema': {},
        'retry_policy': {
          'max_attempts': 1,
          'backoff_secs': [],
          'retry_on': [],
        },
        'supervision': {
          'owner': 'main_agent',
          'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
          'default_outcome': 'continue',
        },
        'transitions': {
          'continue': {
            'terminate': {
              'run_status': 'done' as never,
              'reason': '',
            },
          },
        },
      }],
      'final_output': {'summary': 'ok'},
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'path': 'steps.0.transitions.continue.terminate.run_status'}),
      expect.objectContaining({'path': 'steps.0.transitions.continue.terminate.reason'}),
    ]));
  });

  test('reports transition one-of and unknown-key violations', () => {
    const result = validateDefinition({
      'sop_id': 'valid_id',
      'name': 'Valid',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 1,
        'idempotency_key_template': 'key',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'same',
        },
      },
      'steps': [{
        'id': 'step_a',
        'title': 'A',
        'inputs': {},
        'executor': {
          'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search', 'path': '/tmp/workspace' },
          'timeout_secs': 120,
          'allow_network': true,
          'env': {},
          'resource_limits': {
            'max_output_bytes': 1024,
            'max_artifacts': 1,
          },
        },
        'output_schema': {},
        'retry_policy': {
          'max_attempts': 1,
          'backoff_secs': [],
          'retry_on': [],
        },
        'supervision': {
          'owner': 'main_agent',
          'allowed_outcomes': [
            {'id': 'both', 'description': 'both'},
            {'id': 'neither', 'description': 'neither'},
            {'id': 'extra', 'description': 'extra'},
          ],
          'default_outcome': 'both',
        },
        'transitions': {
          'both': {
            'next_step': 'step_a',
            'terminate': {
              'run_status': 'succeeded',
              'reason': 'done',
            },
          },
          'neither': {},
          'extra': {'unexpected': true},
        },
      }],
      'final_output': {'summary': 'ok'},
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_one_of', 'path': 'steps.0.transitions.both'}),
      expect.objectContaining({'code': 'schema_one_of', 'path': 'steps.0.transitions.neither'}),
      expect.objectContaining({'code': 'schema_one_of', 'path': 'steps.0.transitions.extra'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'steps.0.transitions.extra.unexpected'}),
    ]));
  });
});
