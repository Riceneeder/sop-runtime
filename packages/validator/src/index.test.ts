import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index';

describe('validateDefinition', () => {
  test('reports duplicate step ids and missing entry step', () => {
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
          'executor': {},
          'output_schema': {},
          'retry_policy': {},
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
          'executor': {},
          'output_schema': {},
          'retry_policy': {},
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

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('duplicate_step_id');
    expect(result.diagnostics.map((item) => item.code)).toContain('entry_step_missing');
  });
});
