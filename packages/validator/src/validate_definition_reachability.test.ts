import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';

describe('validateDefinition (reachability)', () => {
  test('rejects unreachable steps referenced from final_output expressions', () => {
    const result = validateDefinition({
      'sop_id': 'expr_unreachable_final_output',
      'name': 'Expr Unreachable Final Output',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'job',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'job',
        },
      },
      'steps': [
        {
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
          'output_schema': {
            'type': 'object',
            'properties': {
              'summary': {'type': 'string'},
            },
            'additionalProperties': false,
          },
          'retry_policy': {
            'max_attempts': 1,
            'backoff_secs': [],
            'retry_on': [],
          },
          'supervision': {
            'owner': 'main_agent',
            'allowed_outcomes': [{'id': 'done', 'description': 'done'}],
            'default_outcome': 'done',
          },
          'transitions': {
            'done': {
              'terminate': {
                'run_status': 'succeeded',
                'reason': 'complete',
              },
            },
          },
        },
        {
          'id': 'step_b',
          'title': 'B',
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
          'output_schema': {
            'type': 'object',
            'properties': {
              'summary': {'type': 'string'},
            },
            'additionalProperties': false,
          },
          'retry_policy': {
            'max_attempts': 1,
            'backoff_secs': [],
            'retry_on': [],
          },
          'supervision': {
            'owner': 'main_agent',
            'allowed_outcomes': [{'id': 'done', 'description': 'done'}],
            'default_outcome': 'done',
          },
          'transitions': {
            'done': {
              'terminate': {
                'run_status': 'succeeded',
                'reason': 'complete',
              },
            },
          },
        },
      ],
      'final_output': {
        'summary': '${steps.step_b.output.summary}',
      },
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unreachable_step', 'path': 'final_output.summary'}),
    ]));
  });

  test('ignores invalid transitions when computing final_output reachability', () => {
    const result = validateDefinition({
      'sop_id': 'expr_unreachable_invalid_transitions',
      'name': 'Expr Unreachable Invalid Transitions',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'job',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'job',
        },
      },
      'steps': [
        {
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
          'output_schema': {
            'type': 'object',
            'properties': {
              'summary': {'type': 'string'},
            },
            'additionalProperties': false,
          },
          'retry_policy': {
            'max_attempts': 1,
            'backoff_secs': [],
            'retry_on': [],
          },
          'supervision': {
            'owner': 'main_agent',
            'allowed_outcomes': [
              {'id': 'done', 'description': 'done'},
              {'id': 'both', 'description': 'both'},
            ],
            'default_outcome': 'done',
          },
          'transitions': {
            'done': {
              'terminate': {
                'run_status': 'succeeded',
                'reason': 'complete',
              },
            },
            'both': {
              'next_step': 'step_b',
              'terminate': {
                'run_status': 'succeeded',
                'reason': 'complete',
              },
            },
            'extra': {'next_step': 'step_b'},
          },
        },
        {
          'id': 'step_b',
          'title': 'B',
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
          'output_schema': {
            'type': 'object',
            'properties': {
              'summary': {'type': 'string'},
            },
            'additionalProperties': false,
          },
          'retry_policy': {
            'max_attempts': 1,
            'backoff_secs': [],
            'retry_on': [],
          },
          'supervision': {
            'owner': 'main_agent',
            'allowed_outcomes': [{'id': 'done', 'description': 'done'}],
            'default_outcome': 'done',
          },
          'transitions': {
            'done': {
              'terminate': {
                'run_status': 'succeeded',
                'reason': 'complete',
              },
            },
          },
        },
      ],
      'final_output': {
        'summary': '${steps.step_b.output.summary}',
      },
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unreachable_step', 'path': 'final_output.summary'}),
    ]));
  });
});
