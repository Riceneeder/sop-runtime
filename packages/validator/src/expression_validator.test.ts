import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';
import {buildStep} from './validator_test_helpers.js';

describe('validateDefinition', () => {
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
        ...buildStep(),
        'inputs': {
          'company': '${steps.missing.output.name}',
        },
        'executor': {
          ...buildStep().executor,
          'command_template': 'Search ${}',
        },
        'transitions': {
          'continue': {'next_step': 'step_a'},
        },
      }],
      'final_output': {
        'summary': '${steps.unknown.output.summary}',
      },
    } as never);

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
        ...buildStep(),
        'inputs': {
          'company': '${run.input.company}',
        },
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

  test('treats boolean false subschemas as missing expression paths', () => {
    const result = validateDefinition({
      'sop_id': 'expr_false_subschemas',
      'name': 'Expr False Subschemas',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {
        'type': 'object',
        'properties': {
          'company': {'type': 'string'},
          'forbidden': false,
        },
        'additionalProperties': false,
      },
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': '${run.input.forbidden}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company}',
        },
      },
      'steps': [{
        ...buildStep(),
        'inputs': {
          'items': '${run.input.company}',
        },
        'output_schema': {
          'type': 'object',
          'properties': {
            'list': {
              'type': 'array',
              'items': false,
            },
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
      }],
      'final_output': {
        'first': '${steps.step_a.output.list.0}',
      },
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unknown_input', 'path': 'policies.idempotency_key_template'}),
      expect.objectContaining({'code': 'expression_unknown_output', 'path': 'final_output.first'}),
    ]));
  });

  test('rejects deeper expression paths under primitive schema leaves', () => {
    const result = validateDefinition({
      'sop_id': 'expr_primitive_leaf_paths',
      'name': 'Expr Primitive Leaf Paths',
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
        'idempotency_key_template': '${run.input.company.name}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company}',
        },
      },
      'steps': [{
        ...buildStep(),
        'inputs': {
          'company': '${run.input.company}',
        },
        'executor': {
          ...buildStep().executor,
          'command_template': 'Search ${run.input.company}',
        },
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
      }],
      'final_output': {
        'summary': '${steps.step_a.output.summary.name}',
      },
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unknown_input', 'path': 'policies.idempotency_key_template'}),
      expect.objectContaining({'code': 'expression_unknown_output', 'path': 'final_output.summary'}),
    ]));
  });

  test('does not reject references inside permissive or composed json schemas', () => {
    const result = validateDefinition({
      'sop_id': 'expr_unknown_schema_forms',
      'name': 'Expr Unknown Schema Forms',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': '${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${run.input.company}',
        },
      },
      'steps': [{
        ...buildStep(),
        'inputs': {
          'company': '${run.input.company}',
        },
        'output_schema': {
          'oneOf': [
            {
              'type': 'object',
              'properties': {
                'summary': {'type': 'string'},
              },
              'additionalProperties': false,
            },
            {'type': 'object'},
          ],
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
        'summary': '${steps.step_a.output.summary}',
      },
    });

    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unknown_input', 'path': 'policies.idempotency_key_template'}),
      expect.objectContaining({'code': 'expression_unknown_output', 'path': 'final_output.summary'}),
    ]));
  });
});
