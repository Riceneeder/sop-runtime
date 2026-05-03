import {describe, expect, test} from 'bun:test';
import {validateDefinition} from '../src/index.js';

describe('validateDefinition (schema path)', () => {
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
        'id': 'step_a',
        'title': 'A',
        'inputs': {
          'items': '${run.input.company}',
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
            'list': {
              'type': 'array',
              'items': false,
            },
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
        'id': 'step_a',
        'title': 'A',
        'inputs': {
          'company': '${run.input.company}',
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
        'summary': '${steps.step_a.output.summary.name}',
      },
    });

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
        'summary': '${steps.step_a.output.summary}',
      },
    });

    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unknown_input', 'path': 'policies.idempotency_key_template'}),
      expect.objectContaining({'code': 'expression_unknown_output', 'path': 'final_output.summary'}),
    ]));
  });
});
