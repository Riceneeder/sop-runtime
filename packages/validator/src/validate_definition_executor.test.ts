import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';

describe('validateDefinition (executor)', () => {
  test('reports invalid executor shape and conditional fields', () => {
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
      expect.objectContaining({'path': 'steps.0.title'}),
      expect.objectContaining({'path': 'steps.0.executor.kind'}),
      expect.objectContaining({'path': 'steps.0.executor.name'}),
      expect.objectContaining({'path': 'steps.0.executor.config'}),
      expect.objectContaining({'path': 'steps.0.executor.extra_field'}),
      expect.objectContaining({'path': 'steps.0.executor.timeout_secs'}),
      expect.objectContaining({'path': 'steps.0.executor.allow_network'}),
      expect.objectContaining({'path': 'steps.0.executor.env.TOKEN'}),
      expect.objectContaining({'path': 'steps.0.executor.resource_limits.max_output_bytes'}),
      expect.objectContaining({'path': 'steps.0.retry_policy.max_attempts'}),
      expect.objectContaining({'path': 'steps.0.retry_policy.backoff_secs.0'}),
      expect.objectContaining({'path': 'steps.0.retry_policy.retry_on.0'}),
      expect.objectContaining({'path': 'steps.0.supervision.owner'}),
      expect.objectContaining({'path': 'steps.0.supervision.allowed_outcomes'}),
      expect.objectContaining({'path': 'steps.0.supervision.default_outcome'}),
      expect.objectContaining({'path': 'steps.0.transitions'}),
    ]));
  });

  test('validates opposite-branch executor fields when they are present', () => {
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
            'config': { 'command_template': 'Search' },
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
            'config': { 'model': 'claude-opus-4-6', 'prompt_template': 'Summarize' },
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

  test('accepts empty strings in required executor-specific string fields', () => {
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
          'config': { 'command_template': '', 'path': '/tmp/workspace' },
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
          'config': { 'model': '', 'prompt_template': '', 'path': '/tmp/workspace' },
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

    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.executor.tool'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.executor.command_template'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.1.executor.model'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.1.executor.prompt_template'}),
    ]));
  });
});
