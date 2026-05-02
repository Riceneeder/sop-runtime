import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';

describe('validateDefinition', () => {
  test('reports stable paths for top-level and nested validation errors', () => {
    const result = validateDefinition({
      'sop_id': 'ok_id',
      'name': 'Test',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': '',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'same',
        },
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
        'id': 'step_a',
        'title': 'A',
        'inputs': {
          'a.b': '${steps.missing.output.name}',
        },
        'executor': {
          'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search', 'path': '/tmp/workspace' },
          'timeout_secs': 120,
          'allow_network': true,
          'env': {
            'TOKEN.KEY': 1 as never,
          },
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
        '': '${steps.unknown.output.summary}',
      },
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'expression_unknown_step', 'path': 'steps.0.inputs["a.b"]'}),
      expect.objectContaining({'code': 'schema_type', 'path': 'steps.0.executor.env["TOKEN.KEY"]'}),
      expect.objectContaining({'code': 'expression_unknown_step', 'path': 'final_output[""]'}),
    ]));
  });

  test('reports top-level required, pattern, and min constraints', () => {
    const result = validateDefinition({
      'sop_id': 'bad id',
      'name': '',
      'version': '1',
      'entry_step': 'BadStep',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': -1,
        'max_run_secs': 0,
        'idempotency_key_template': '',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '',
        },
      },
      'steps': [],
      'final_output': {},
    });

    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'schema_pattern',
      'schema_min_length',
      'schema_minimum',
      'schema_min_items',
      'schema_min_properties',
    ]));
  });

  test('reports unknown top-level and policy fields', () => {
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
          'extra': 'boom',
        },
        'extra_policy': true,
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
          'continue': {'next_step': 'step_a'},
        },
        'extra_step': true,
      }],
      'final_output': {'summary': 'ok'},
      'extra_root': true,
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'extra_root'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'policies.extra_policy'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'policies.concurrency.extra'}),
    ]));
  });

  test('accepts step metadata while the public type still includes it', () => {
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
        'metadata': {'owner': 'ops'} as never,
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
          'continue': {'next_step': 'step_a'},
        },
      }],
      'final_output': {'summary': 'ok'},
    } as never);

    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'steps.0.metadata'}),
    ]));
  });

  test('accepts documented top-level $schema field', () => {
    const result = validateDefinition({
      '$schema': 'https://example.com/schemas/sop-definition.schema.json',
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
          'continue': {'next_step': 'step_a'},
        },
      }],
      'final_output': {'summary': 'ok'},
    } as never);

    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_additional_property', 'path': '$schema'}),
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
      'sop_id': 'valid_id',
      'name': 'Valid',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': 'not-an-object',
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
          'continue': {'next_step': 'step_a'},
        },
      }],
      'final_output': {'summary': 'ok'},
    } as never)).not.toThrow();

    const malformedPoliciesResult = validateDefinition({
      'sop_id': 'valid_id',
      'name': 'Valid',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': 'not-an-object',
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
          'continue': {'next_step': 'step_a'},
        },
      }],
      'final_output': {'summary': 'ok'},
    } as never);

    const malformedConcurrencyResult = validateDefinition({
      'sop_id': 'valid_id',
      'name': 'Valid',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 1,
        'idempotency_key_template': 'key',
        'concurrency': 'invalid-concurrency-object',
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
          'continue': {'next_step': 'step_a'},
        },
      }],
      'final_output': {'summary': 'ok'},
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

  test('reports semantic relationship errors between outcomes and transitions', () => {
    const result = validateDefinition({
      'sop_id': 'semantic_case',
      'name': 'Semantic Case',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'dup',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'dup',
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
          'output_schema': {},
          'retry_policy': {
            'max_attempts': 1,
            'backoff_secs': [],
            'retry_on': [],
          },
          'supervision': {
            'owner': 'main_agent',
            'allowed_outcomes': [
              {'id': 'continue', 'description': 'go'},
              {'id': 'continue', 'description': 'duplicate'},
              {'id': 'retry', 'description': 'retry'},
            ],
            'default_outcome': 'missing',
          },
          'transitions': {
            'continue': {'next_step': 'step_b'},
            'extra': {'next_step': 'step_missing'},
          },
        },
      ],
      'final_output': {'summary': 'ok'},
    });

    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'duplicate_step_outcome_id',
      'default_outcome_missing',
      'transition_outcome_missing',
      'transition_definition_missing',
      'next_step_missing',
    ]));
  });

  test('reports missing entry step and duplicate step ids', () => {
    const result = validateDefinition({
      'sop_id': 'dup_case',
      'name': 'Duplicate Case',
      'version': '1.0.0',
      'entry_step': 'missing_step',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'dup',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'dup',
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
        },
        {
          'id': 'step_a',
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
        },
      ],
      'final_output': {'ok': true},
    });

    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'duplicate_step_id',
      'entry_step_missing',
    ]));
  });

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
          'id': 'step_a',
          'title': 'A',
          'inputs': {},
          'executor': {
            'kind': 'python',
          'name': 'python',
          'config': { 'command_template': 'echo hello', 'path': '/tmp/workspace' },
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
          'config': { 'model': 'claude-opus-4-6', 'prompt_template': 'Return this verbatim', 'path': '/tmp/workspace' },
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

    expect(result.diagnostics.filter((item) => item.code.startsWith('expression_'))).toEqual([]);
  });

  test('skips expression validation for handler-owned executor config', () => {
    const result = validateDefinition({
      'sop_id': 'expr_executor_config',
      'name': 'Expr Executor Config',
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
        'inputs': {},
        'executor': {
          'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search ${run.input.company}', 'workspace_path': '${steps.missing.output.dir}' },
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

    // Executor config is handler-owned opaque data — expression validation is skipped.
    const executorConfigDiagnostics = result.diagnostics.filter(
      (item) => item.path.startsWith('steps.0.executor.config'),
    );
    expect(executorConfigDiagnostics).toEqual([]);
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
              'articles': {'type': 'array'},
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
          'inputs': {
            'articles': '${steps.step_a.output.articles}',
          },
          'executor': {
            'kind': 'llm',
          'name': 'claude-opus-4-6',
          'config': { 'model': 'claude-opus-4-6', 'prompt_template': 'Summarize ${steps.step_a.output.articles}', 'path': '/tmp/workspace' },
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
        'company': '${coalesce(run.input.company, "unknown")}',
      },
    });

    expect(result.diagnostics.filter((item) => item.code.startsWith('expression_'))).toEqual([]);
  });
});
