import {describe, expect, test} from 'bun:test';
import {validateDefinition} from '../src/index.js';

describe('validateDefinition (malformed)', () => {
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
});
