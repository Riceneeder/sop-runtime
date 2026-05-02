import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';
import {buildStep} from './validator_test_helpers.js';

describe('validateDefinition', () => {
  test('skips expression validation for executor command and prompt templates', () => {
    const result = validateDefinition({
      'sop_id': 'expr_executor_skip',
      'name': 'Expr Executor Skip',
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
          ...buildStep(),
          'executor': {
            ...buildStep().executor,
            'kind': 'sandbox_script',
            'tool': 'python',
            'command_template': 'echo ${HOME} && echo ${steps.missing.output.value}',
            'allow_network': false,
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
            'model': 'claude-opus-4-6',
            'prompt_template': 'Return this verbatim: ${steps.unknown.output.value}',
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
      'final_output': {'summary': 'ok'},
    } as never);

    expect(result.diagnostics.filter((item) => item.code.startsWith('expression_'))).toEqual([]);
  });

  test('reports invalid expression references in executor path templates', () => {
    const result = validateDefinition({
      'sop_id': 'expr_executor_path',
      'name': 'Expr Executor Path',
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
      'steps': [{
        ...buildStep(),
        'executor': {
          ...buildStep().executor,
          'command_template': 'Search ${run.input.company}',
          'path': '${steps.missing.output.dir}',
        },
      }],
      'final_output': {'summary': 'ok'},
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        'code': 'expression_unknown_step',
        'path': 'steps.0.executor.path',
      }),
    ]));
  });

  test('reports invalid expression references in nested step input values', () => {
    const result = validateDefinition({
      'sop_id': 'expr_nested_inputs',
      'name': 'Expr Nested Inputs',
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
      'steps': [{
        ...buildStep(),
        'inputs': {
          'payload': {
            'company': '${steps.missing.output.name}',
            'aliases': [
              'ok',
              '${steps.unknown.output.alias}',
            ],
          },
        },
        'executor': {
          ...buildStep().executor,
          'command_template': 'Search ${run.input.company}',
        },
      }],
      'final_output': {'summary': 'ok'},
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        'code': 'expression_unknown_step',
        'path': 'steps.0.inputs.payload.company',
      }),
      expect.objectContaining({
        'code': 'expression_unknown_step',
        'path': 'steps.0.inputs.payload.aliases.1',
      }),
    ]));
  });
});
