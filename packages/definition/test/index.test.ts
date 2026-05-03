import {describe, expect, test} from 'bun:test';
import {
  ACCEPTED_STEP_RESULT_STATUSES,
  ExecutorConfig,
  EXECUTOR_RESULT_STATUSES,
  ExpressionSyntaxError,
  HistoryEntry,
  JsonObject,
  RUN_PHASES,
  RUN_STATUSES,
  RETRYABLE_STEP_RESULT_STATUSES,
  RetryPolicy,
  SopDefinition,
  STEP_LIFECYCLES,
  defineSop,
  parseExpressionBody,
  parseExpressionTemplate,
} from '../src/index.js';

// ---- runtime constants ----
describe('runtime constants', () => {
  test('RUN_STATUSES exports running and terminal statuses', () => {
    expect(RUN_STATUSES).toEqual(['running', 'succeeded', 'failed', 'cancelled']);
  });

  test('RUN_PHASES exports all orchestration phases', () => {
    expect(RUN_PHASES).toEqual(['ready', 'awaiting_decision', 'paused', 'terminated']);
  });

  test('STEP_LIFECYCLES exports all lifecycle statuses', () => {
    expect(STEP_LIFECYCLES).toEqual(['pending', 'active', 'waiting_decision', 'completed', 'failed']);
  });

  test('EXECUTOR_RESULT_STATUSES lists raw executor statuses', () => {
    expect(EXECUTOR_RESULT_STATUSES).toEqual([
      'success',
      'timeout',
      'tool_error',
      'sandbox_error',
    ]);
  });

  test('ACCEPTED_STEP_RESULT_STATUSES extends executor statuses with invalid_output', () => {
    expect(ACCEPTED_STEP_RESULT_STATUSES).toEqual([
      'success',
      'timeout',
      'tool_error',
      'sandbox_error',
      'invalid_output',
    ]);
  });

  test('RETRYABLE_STEP_RESULT_STATUSES lists statuses eligible for retry', () => {
    expect(RETRYABLE_STEP_RESULT_STATUSES).toEqual([
      'timeout',
      'tool_error',
      'invalid_output',
      'sandbox_error',
    ]);
  });
});

// ---- parser exports ----
describe('parser exports', () => {
  test('parseExpressionBody parses reference expressions into AST', () => {
    expect(parseExpressionBody('run.input.company').kind).toBe('reference');
  });

  test('parseExpressionTemplate splits templates into segments', () => {
    expect(parseExpressionTemplate('Hello ${run.input.company}').length).toBe(2);
  });

  test('ExpressionSyntaxError is a constructable error class', () => {
    const err = new ExpressionSyntaxError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test');
  });
});

// ---- type-level contracts ----
describe('type-level contracts', () => {
  test('SopDefinition accepts a complete workflow definition', () => {
    const input: JsonObject = {'company': 'Acme'};
    const definition: SopDefinition = {
      'sop_id': 'news_report',
      'name': 'News Report',
      'version': '1.0.0',
      'entry_step': 'search_news',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'news:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'news:${run.input.company}',
        },
      },
      'steps': [
        {
          'id': 'search_news',
          'title': 'Search News',
          'inputs': {
            'company': '${run.input.company}',
          },
          'executor': {
            'kind': 'web_search',
            'name': 'google_search',
            'timeout_secs': 120,
            'allow_network': true,
            'env': {},
            'resource_limits': {
              'max_output_bytes': 1024,
              'max_artifacts': 1,
            },
          },
          'output_schema': {'type': 'object'},
          'retry_policy': {
            'max_attempts': 2,
            'backoff_secs': [5],
            'retry_on': ['timeout'],
          },
          'supervision': {
            'owner': 'main_agent',
            'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
            'default_outcome': 'continue',
          },
          'transitions': {
            'continue': {'next_step': 'search_news'},
          },
        },
      ],
      'final_output': {'summary': 'ok'},
    };

    expect(input.company).toBe('Acme');
    expect(definition.sop_id).toBe('news_report');
    expect(definition.steps[0]?.executor.kind).toBe('web_search');
  });

  test('ExecutorConfig supports multiple executor kinds with optional config', () => {
    const webSearchExecutor: ExecutorConfig = {
      'kind': 'web_search',
      'name': 'google_search',
      'config': {'region': 'us-east'},
      'timeout_secs': 120,
      'allow_network': true,
      'env': {},
      'resource_limits': {
        'max_output_bytes': 1024,
        'max_artifacts': 1,
      },
    };
    const llmExecutor: ExecutorConfig = {
      'kind': 'llm',
      'name': 'gpt_summarize',
      'config': {'model': 'gpt-4', 'temperature': 0.3},
      'timeout_secs': 60,
      'allow_network': false,
      'env': {'API_KEY': 'sk-xxx'},
      'resource_limits': {
        'max_output_bytes': 4096,
        'max_artifacts': 0,
      },
    };
    const minimalExecutor: ExecutorConfig = {
      'kind': 'shell',
      'name': 'run_script',
      'timeout_secs': 30,
      'allow_network': false,
      'env': {},
      'resource_limits': {
        'max_output_bytes': 256,
        'max_artifacts': 0,
      },
    };

    expect(webSearchExecutor.kind).toBe('web_search');
    expect(webSearchExecutor.name).toBe('google_search');
    expect(webSearchExecutor.config).toEqual({'region': 'us-east'});
    expect(llmExecutor.kind).toBe('llm');
    expect(llmExecutor.config).toEqual({'model': 'gpt-4', 'temperature': 0.3});
    expect(minimalExecutor.config).toBeUndefined();
    expect(minimalExecutor.kind).toBe('shell');
  });

  test('RetryPolicy and HistoryEntry model valid data', () => {
    const retryPolicy: RetryPolicy = {
      'max_attempts': 2,
      'backoff_secs': [5],
      'retry_on': ['timeout', 'invalid_output'],
    };
    const terminatedHistoryEntry: HistoryEntry = {
      'kind': 'run_terminated',
      'run_status': 'failed',
      'reason': 'search_failed',
    };

    expect(retryPolicy.retry_on).toContain('invalid_output');
    expect(terminatedHistoryEntry.run_status).toBe('failed');
  });

  test('type narrowing rejects invalid retry_on and missing RetryPolicy fields', () => {
    const _invalidRetryPolicy: RetryPolicy = {
      'max_attempts': 2,
      'backoff_secs': [5],
      // @ts-expect-error — retry_on must be limited to retryable result statuses.
      'retry_on': ['success'],
    };
    // @ts-expect-error — RetryPolicy requires max_attempts, backoff_secs, and retry_on.
    const _missingRetryPolicyFields: RetryPolicy = {};
    const _invalidTerminatedHistoryEntry: HistoryEntry = {
      'kind': 'run_terminated',
      // @ts-expect-error — run_terminated only allows terminal run statuses.
      'run_status': 'running',
      'reason': 'still_running',
    };
  });
});

// ---- defineSop ----
describe('defineSop', () => {
  test('returns a plain SopDefinition object with all fields preserved', () => {
    const definition = defineSop({
      'sop_id': 'builder_test',
      'name': 'Builder Test',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'test:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'test:${run.input.company}',
        },
      },
      'steps': [
        {
          'id': 'step_a',
          'title': 'Step A',
          'inputs': {'company': '${run.input.company}'},
          'executor': {
            'kind': 'tool',
            'name': 'web_search',
            'config': {'query_template': '${company} news'},
            'timeout_secs': 120,
            'allow_network': true,
            'env': {},
            'resource_limits': {
              'max_output_bytes': 1024,
              'max_artifacts': 1,
            },
          },
          'output_schema': {'type': 'object'},
          'retry_policy': {
            'max_attempts': 2,
            'backoff_secs': [5],
            'retry_on': ['timeout'],
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
          'title': 'Step B',
          'inputs': {},
          'executor': {
            'kind': 'shell',
            'name': 'report',
            'timeout_secs': 30,
            'allow_network': false,
            'env': {},
            'resource_limits': {
              'max_output_bytes': 256,
              'max_artifacts': 0,
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
        },
      ],
      'final_output': {'summary': '${steps.step_a.output.result}'},
    });

    expect(definition.sop_id).toBe('builder_test');
    expect(definition.steps.length).toBe(2);
    expect(definition.steps[0]?.executor.kind).toBe('tool');
    expect(definition.steps[0]?.executor.name).toBe('web_search');
    expect(definition.steps[0]?.executor.config).toEqual({'query_template': '${company} news'});
    expect(definition.steps[1]?.executor.config).toBeUndefined();
    expect(definition.final_output).toEqual({'summary': '${steps.step_a.output.result}'});
  });

  test('output is identity — returns the same object, no clone, no validation, no defaults', () => {
    const input = {
      'sop_id': 'plain',
      'name': 'Plain',
      'version': '1.0.0',
      'entry_step': 'a',
      'input_schema': {},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'k',
        'concurrency': {'mode': 'singleflight', 'key_template': 'k'},
      },
      'steps': [],
      'final_output': {},
    } satisfies SopDefinition;
    const result = defineSop(input);

    expect(result).toBe(input);
    expect(result.steps).toEqual([]);
  });
});
