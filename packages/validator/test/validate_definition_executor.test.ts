import {describe, expect, test} from 'bun:test';
import {validateDefinition} from '../src/index.js';

describe('validateDefinition (executor)', () => {
  test('reports invalid executor shape and field types', () => {
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
        'title': '',
        'inputs': {},
        'executor': {
          'kind': '',
          'name': '',
          'config': 'not-an-object' as never,
          'extra_field': 123 as never,
          'timeout_secs': 0,
          'allow_network': 'not-a-bool' as never,
          'env': {'TOKEN': 1 as never},
          'resource_limits': {
            'max_output_bytes': 0,
            'max_artifacts': -1,
          },
        },
        'output_schema': {},
        'retry_policy': {
          'max_attempts': 0,
          'backoff_secs': [-1],
          'retry_on': ['oops' as never],
        },
        'supervision': {
          'owner': 'worker' as never,
          'allowed_outcomes': [],
          'default_outcome': '',
        },
        'transitions': {},
      }],
      'final_output': {'summary': 'ok'},
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.title'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.executor.kind'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.executor.name'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.0.executor.config'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'steps.0.executor.extra_field'}),
      expect.objectContaining({'code': 'schema_minimum', 'path': 'steps.0.executor.timeout_secs'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.0.executor.allow_network'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.0.executor.env.TOKEN'}),
      expect.objectContaining({'code': 'schema_minimum', 'path': 'steps.0.executor.resource_limits.max_output_bytes'}),
      expect.objectContaining({'code': 'schema_minimum', 'path': 'steps.0.executor.resource_limits.max_artifacts'}),
      expect.objectContaining({'code': 'schema_minimum', 'path': 'steps.0.retry_policy.max_attempts'}),
      expect.objectContaining({'code': 'schema_minimum', 'path': 'steps.0.retry_policy.backoff_secs.0'}),
      expect.objectContaining({'code': 'schema_enum', 'path': 'steps.0.retry_policy.retry_on.0'}),
      expect.objectContaining({'code': 'schema_enum', 'path': 'steps.0.supervision.owner'}),
      expect.objectContaining({'code': 'schema_min_items', 'path': 'steps.0.supervision.allowed_outcomes'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.supervision.default_outcome'}),
      expect.objectContaining({'code': 'schema_min_properties', 'path': 'steps.0.transitions'}),
    ]));
  });

  test('validates executor unknown additional properties', () => {
    const result = validateDefinition({
      'sop_id': 'mixed_executor_fields',
      'name': 'Mixed Executor Fields',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'job:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company}',
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
            'config': { 'option': 'web', 'method': 'GET' },
            'unknown_field': 123 as never,
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
            'continue': {'next_step': 'step_b'},
          },
        },
        {
          'id': 'step_b',
          'title': 'B',
          'inputs': {},
          'executor': {
            'kind': 'llm',
            'name': 'claude-opus-4-6',
            'config': { 'option': 'summarize', 'format': 'text' },
            'extra_key': true as never,
            'timeout_secs': 120,
            'allow_network': false,
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
      'final_output': {'summary': 'ok'},
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'steps.0.executor.unknown_field'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'steps.1.executor.extra_key'}),
    ]));
  });

  test('rejects empty generic executor kind and name', () => {
    const result = validateDefinition({
      'sop_id': 'empty_executor_fields',
      'name': 'Empty Executor Fields',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'job:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company}',
        },
      },
      'steps': [
        {
          'id': 'step_a',
          'title': 'A',
          'inputs': {},
          'executor': {
            'kind': '',
            'name': '',
            'config': {'key': '', 'path': '/tmp/workspace'},
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
            'continue': {'next_step': 'step_b'},
          },
        },
        {
          'id': 'step_b',
          'title': 'B',
          'inputs': {},
          'executor': {
            'kind': 'llm',
            'name': '',
            'config': {'key': '', 'path': '/tmp/workspace'},
            'timeout_secs': 120,
            'allow_network': false,
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
      'final_output': {'summary': 'ok'},
    });

    // Empty kind/name should produce schema_min_length diagnostics.
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.executor.kind'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.executor.name'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.1.executor.name'}),
    ]));

    // Executor.config is handler-owned opaque data — empty strings inside config do not produce schema diagnostics.
    const configDiagnostics = result.diagnostics.filter(
      (d) => d.path.startsWith('steps.0.executor.config') || d.path.startsWith('steps.1.executor.config'),
    );
    expect(configDiagnostics).toEqual([]);
  });
});
