import {describe, expect, test} from 'bun:test';
import {validateDefinition} from '../src/index.js';

describe('validateDefinition (expression)', () => {
  test('reports invalid expression syntax in templates', () => {
    const result = validateDefinition({
      'sop_id': 'expr_case',
      'name': 'Expr Case',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': '${coalesce(run.input.company,)}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company',
        },
      },
      'steps': [{
        'id': 'step_a',
        'title': 'A',
        'inputs': {
          'company': '${steps.missing.output.name}',
        },
        'executor': {
          'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search ${}', 'path': '/tmp/workspace' },
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
          'continue': {'next_step': 'step_a'},
        },
      }],
      'final_output': {
        'summary': '${steps.unknown.output.summary}',
      },
    });

    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'expression_syntax',
      'expression_unknown_step',
    ]));
  });

  test('reports undefined input and output fields referenced by expressions', () => {
    const result = validateDefinition({
      'sop_id': 'expr_missing_fields',
      'name': 'Expr Missing Fields',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {
        'type': 'object',
        'properties': {
          'company': {'type': 'string'},
        },
        'additionalProperties': false,
      },
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': '${run.input.missing}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company}',
        },
      },
      'steps': [{
        'id': 'step_a',
        'title': 'A',
        'inputs': {
          'company': '${run.input.company}',
        },
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
      }],
      'final_output': {
        'summary': '${steps.step_a.output.missing}',
      },
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unknown_input', 'path': 'policies.idempotency_key_template'}),
      expect.objectContaining({'code': 'expression_unknown_output', 'path': 'final_output.summary'}),
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
        'id': 'step_a',
        'title': 'A',
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
          'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search ${run.input.company}', 'path': '/tmp/workspace' },
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
          'continue': {'next_step': 'step_a'},
        },
      }],
      'final_output': {'summary': 'ok'},
    });

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
