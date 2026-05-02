import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';

describe('validateDefinition (schema)', () => {
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
});
