import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';
import {buildDefinition, buildStep} from './validator_test_helpers.js';

describe('validateDefinition', () => {
  test('reports stable paths for top-level and nested validation errors', () => {
    const result = validateDefinition({
      ...buildDefinition(),
      'policies': {
        ...buildDefinition().policies,
        'idempotency_key_template': '',
      },
      'steps': [],
      'final_output': {},
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'path': 'policies.idempotency_key_template'}),
      expect.objectContaining({'path': 'steps'}),
      expect.objectContaining({'path': 'final_output'}),
    ]));
  });

  test('escapes ambiguous object keys in diagnostic paths', () => {
    const result = validateDefinition({
      'sop_id': 'escaped_paths',
      'name': 'Escaped Paths',
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
          'a.b': '${steps.missing.output.name}',
        },
        'executor': {
          ...buildStep().executor,
          'env': {
            'TOKEN.KEY': 1 as never,
          },
        },
      }],
      'final_output': {
        '': '${steps.unknown.output.summary}',
      },
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unknown_step', 'path': 'steps.0.inputs["a.b"]'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.0.executor.env["TOKEN.KEY"]'}),
      expect.objectContaining({'code': 'expression_unknown_step', 'path': 'final_output[""]'}),
    ]));
  });

  test('handles malformed root values without throwing and reports diagnostics', () => {
    expect(() => validateDefinition(null as never)).not.toThrow();
    expect(() => validateDefinition(undefined as never)).not.toThrow();

    const nullResult = validateDefinition(null as never);
    const undefinedResult = validateDefinition(undefined as never);

    expect(nullResult.ok).toBe(false);
    expect(undefinedResult.ok).toBe(false);
    expect(nullResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_type', 'path': ''}),
      expect.objectContaining({'code': 'schema_type', 'path': 'policies'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'final_output'}),
    ]));
    expect(undefinedResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_type', 'path': ''}),
      expect.objectContaining({'code': 'schema_type', 'path': 'policies'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'final_output'}),
    ]));
  });

  test('handles malformed policies without throwing and reports diagnostics', () => {
    expect(() => validateDefinition({
      ...buildDefinition(),
      'policies': 'not-an-object',
    } as never)).not.toThrow();

    const malformedPoliciesResult = validateDefinition({
      ...buildDefinition(),
      'policies': 'not-an-object',
    } as never);

    const malformedConcurrencyResult = validateDefinition({
      ...buildDefinition(),
      'policies': {
        ...buildDefinition().policies,
        'max_run_secs': 1,
        'concurrency': 'invalid-concurrency-object',
      },
    } as never);

    expect(malformedPoliciesResult.ok).toBe(false);
    expect(malformedPoliciesResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_type', 'path': 'policies'}),
    ]));

    expect(malformedConcurrencyResult.ok).toBe(false);
    expect(malformedConcurrencyResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_type', 'path': 'policies.concurrency'}),
    ]));
  });

  test('accepts valid expression templates and literals', () => {
    const result = validateDefinition({
      'sop_id': 'expr_valid',
      'name': 'Expr Valid',
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
        'idempotency_key_template': 'job:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '${coalesce(run.input.company, "fallback")}',
        },
      },
      'steps': [
        {
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
              'articles': {'type': 'array'},
            },
            'additionalProperties': false,
          },
          'transitions': {
            'continue': {'next_step': 'step_b'},
          },
        },
        {
          ...buildStep({'id': 'step_b'}),
          'title': 'B',
          'inputs': {
            'articles': '${steps.step_a.output.articles}',
          },
          'executor': {
            'kind': 'sandbox_model',
            'model': 'claude-opus-4-6',
            'prompt_template': 'Summarize ${steps.step_a.output.articles}',
            'path': '/tmp/workspace',
            'timeout_secs': 120,
            'allow_network': false,
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
        'company': '${coalesce(run.input.company, "unknown")}',
      },
    } as never);

    expect(result.diagnostics.filter((item) => item.code.startsWith('expression_'))).toEqual([]);
  });
});
