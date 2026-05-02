import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';
import {buildDefinition, buildStep} from './validator_test_helpers.js';

describe('validateDefinition', () => {
  test('validates opposite-branch executor fields when they are present', () => {
    const result = validateDefinition({
      ...buildDefinition({'name': 'Mixed Executor Fields', 'sop_id': 'mixed_executor_fields'}),
      'policies': {
        ...buildDefinition().policies,
        'idempotency_key_template': 'job:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company}',
        },
      },
      'steps': [
        {
          ...buildStep(),
          'inputs': {},
          'executor': {
            ...buildStep().executor,
            'model': 123 as never,
            'prompt_template': true as never,
          },
          'transitions': {
            'continue': {'next_step': 'step_b'},
          },
        },
        {
          ...buildStep({'id': 'step_b'}),
          'title': 'B',
          'inputs': {},
          'executor': {
            'kind': 'sandbox_model',
            'model': 'claude-opus-4-6',
            'prompt_template': 'Summarize',
            'tool': 123 as never,
            'command_template': false as never,
            'path': '/tmp/workspace',
            'timeout_secs': 120,
            'allow_network': false,
            'env': {},
            'resource_limits': {
              'max_output_bytes': 1024,
              'max_artifacts': 1,
            },
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
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.0.executor.model'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.0.executor.prompt_template'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.1.executor.tool'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.1.executor.command_template'}),
    ]));
  });

  test('accepts empty strings in required executor-specific string fields', () => {
    const result = validateDefinition({
      ...buildDefinition({'name': 'Empty Executor Fields', 'sop_id': 'empty_executor_fields'}),
      'policies': {
        ...buildDefinition().policies,
        'idempotency_key_template': 'job:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company}',
        },
      },
      'steps': [
        {
          ...buildStep(),
          'executor': {
            ...buildStep().executor,
            'tool': '',
            'command_template': '',
          },
          'transitions': {
            'continue': {'next_step': 'step_b'},
          },
        },
        {
          ...buildStep({'id': 'step_b'}),
          'title': 'B',
          'executor': {
            'kind': 'sandbox_model',
            'model': '',
            'prompt_template': '',
            'path': '/tmp/workspace',
            'timeout_secs': 120,
            'allow_network': false,
            'env': {},
            'resource_limits': {
              'max_output_bytes': 1024,
              'max_artifacts': 1,
            },
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
    } as never);

    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.executor.tool'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.0.executor.command_template'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.1.executor.model'}),
      expect.objectContaining({'code': 'schema_min_length', 'path': 'steps.1.executor.prompt_template'}),
    ]));
  });

  test('rejects unreachable steps referenced from final_output expressions', () => {
    const result = validateDefinition({
      ...buildDefinition({'sop_id': 'expr_unreachable_final_output', 'name': 'Expr Unreachable Final Output'}),
      'policies': {
        ...buildDefinition().policies,
        'idempotency_key_template': 'job',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'job',
        },
      },
      'steps': [
        {
          ...buildStep(),
          'output_schema': {
            'type': 'object',
            'properties': {
              'summary': {'type': 'string'},
            },
            'additionalProperties': false,
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
          ...buildStep({'id': 'step_b'}),
          'title': 'B',
          'output_schema': {
            'type': 'object',
            'properties': {
              'summary': {'type': 'string'},
            },
            'additionalProperties': false,
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
      ...buildDefinition({'sop_id': 'expr_unreachable_invalid_transitions', 'name': 'Expr Unreachable Invalid Transitions'}),
      'policies': {
        ...buildDefinition().policies,
        'idempotency_key_template': 'job',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'job',
        },
      },
      'steps': [
        {
          ...buildStep(),
          'output_schema': {
            'type': 'object',
            'properties': {
              'summary': {'type': 'string'},
            },
            'additionalProperties': false,
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
          ...buildStep({'id': 'step_b'}),
          'title': 'B',
          'output_schema': {
            'type': 'object',
            'properties': {
              'summary': {'type': 'string'},
            },
            'additionalProperties': false,
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
