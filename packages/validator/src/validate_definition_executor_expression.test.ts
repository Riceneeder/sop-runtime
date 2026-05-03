import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';

describe('validateDefinition (executor expression)', () => {
  test('executor.config is handler-owned opaque data', () => {
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
          'config': { 'command': 'echo hello', 'path': '/tmp/workspace' },
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
          'config': { 'option': 'summarize', 'prompt': 'Return this verbatim', 'path': '/tmp/workspace' },
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
          'config': { 'query': 'Search ${run.input.company}', 'output_dir': '${steps.missing.output.dir}' },
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
          'config': { 'query': 'Search ${run.input.company}', 'path': '/tmp/workspace' },
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
          'config': { 'option': 'summarize', 'prompt': 'Summarize ${steps.step_a.output.articles}', 'path': '/tmp/workspace' },
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
