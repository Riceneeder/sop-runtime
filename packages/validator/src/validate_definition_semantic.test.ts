import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';

describe('validateDefinition (semantic)', () => {
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
});
