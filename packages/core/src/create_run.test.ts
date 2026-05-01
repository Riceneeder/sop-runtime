import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, createRun} from './index.js';

function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'news_report',
    'name': 'News Report',
    'version': '1.0.0',
    'entry_step': 'search_news',
    'input_schema': {
      'type': 'object',
      'required': ['company'],
      'properties': {
        'company': {'type': 'string', 'minLength': 1},
        'workspace': {'type': 'string'},
      },
      'additionalProperties': false,
    },
    'defaults': {'workspace': '/tmp/workspace'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': 'news:${run.input.company}',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'news:${run.input.company}',
      },
    },
    'steps': [{
      'id': 'search_news',
      'title': 'Search News',
      'inputs': {'company': '${run.input.company}'},
      'executor': {
        'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search ${run.input.company}', 'path': '${run.input.workspace}' },
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
        'required': ['summary'],
        'properties': {
          'summary': {'type': 'string'},
        },
      },
      'retry_policy': {
        'max_attempts': 2,
        'backoff_secs': [],
        'retry_on': ['tool_error'],
      },
      'supervision': {
        'owner': 'main_agent',
        'allowed_outcomes': [{'id': 'done', 'description': 'finish'}],
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
    'final_output': {'ok': true},
  };
}

describe('createRun', () => {
  test('merges defaults, validates input, and records timestamps', () => {
    const state = createRun({
      'definition': buildDefinition(),
      'input': {'company': 'Acme'},
      'runId': 'run_001',
      'now': '2026-04-20T12:00:00Z',
    });

    expect(state.run_input).toEqual({
      'company': 'Acme',
      'workspace': '/tmp/workspace',
    });
    expect(state.created_at).toBe('2026-04-20T12:00:00Z');
    expect(state.updated_at).toBe('2026-04-20T12:00:00Z');
    expect(state.history[0]).toEqual({
      'kind': 'run_created',
      'step_id': 'search_news',
      'at': '2026-04-20T12:00:00Z',
    });
  });

  test('throws definition_invalid for malformed definitions', () => {
    let error: unknown;

    try {
      createRun({
        'definition': {
          ...buildDefinition(),
          'steps': [],
        } as never,
        'input': {'company': 'Acme'},
        'runId': 'run_001',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('definition_invalid');
  });

  test('throws run_input_invalid when merged input violates input_schema', () => {
    let error: unknown;

    try {
      createRun({
        'definition': buildDefinition(),
        'input': {'workspace': '/tmp/only'} as never,
        'runId': 'run_001',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('run_input_invalid');
  });
});
