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
  RetryPolicy,
  STEP_LIFECYCLES,
  RunState,
  SopDefinition,
  parseExpressionBody,
  parseExpressionTemplate,
} from './index.js';

describe('definition exports', () => {
  test('exports the shared SOP model types and richer run state contracts', () => {
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
    const state = {} as RunState;

    expect(input.company).toBe('Acme');
    expect(definition.steps[0]?.executor.kind).toBe('web_search');
    expect(state).toBeDefined();
    expect(RUN_STATUSES).toContain('running');
    expect(RUN_PHASES).toContain('ready');
    expect(STEP_LIFECYCLES).toContain('active');
    expect(EXECUTOR_RESULT_STATUSES).toEqual([
      'success',
      'timeout',
      'tool_error',
      'sandbox_error',
    ]);
    expect(ACCEPTED_STEP_RESULT_STATUSES).toContain('invalid_output');
    expect(parseExpressionBody('run.input.company').kind).toBe('reference');
    expect(parseExpressionTemplate('Hello ${run.input.company}').length).toBe(2);
    expect(ExpressionSyntaxError).toBeDefined();
  });

  test('models executors as a generic kind+name config and narrows retry_on to supported statuses', () => {
    const webSearchExecutor: ExecutorConfig = {
      'kind': 'web_search',
      'name': 'google_search',
      'config': { 'region': 'us-east' },
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
      'config': { 'model': 'gpt-4', 'temperature': 0.3 },
      'timeout_secs': 60,
      'allow_network': false,
      'env': { 'API_KEY': 'sk-xxx' },
      'resource_limits': {
        'max_output_bytes': 4096,
        'max_artifacts': 0,
      },
    };
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

    expect(webSearchExecutor.kind).toBe('web_search');
    expect(webSearchExecutor.name).toBe('google_search');
    expect(webSearchExecutor.config).toEqual({ 'region': 'us-east' });
    expect(llmExecutor.kind).toBe('llm');
    expect(llmExecutor.config).toEqual({ 'model': 'gpt-4', 'temperature': 0.3 });
    expect(retryPolicy.retry_on).toContain('invalid_output');
    expect(terminatedHistoryEntry.run_status).toBe('failed');

    // config is optional — executor without config is valid
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
    expect(minimalExecutor.config).toBeUndefined();
    expect(minimalExecutor.kind).toBe('shell');

    const invalidRetryPolicy: RetryPolicy = {
      'max_attempts': 2,
      'backoff_secs': [5],
      // @ts-expect-error retry_on must be limited to retryable result statuses.
      'retry_on': ['success'],
    };
    // @ts-expect-error RetryPolicy requires max_attempts, backoff_secs, and retry_on.
    const missingRetryPolicyFields: RetryPolicy = {};
    const invalidTerminatedHistoryEntry: HistoryEntry = {
      'kind': 'run_terminated',
      // @ts-expect-error run_terminated only allows terminal run statuses.
      'run_status': 'running',
      'reason': 'still_running',
    };

    expect(invalidRetryPolicy).toBeDefined();
    expect(missingRetryPolicyFields).toBeDefined();
    expect(invalidTerminatedHistoryEntry).toBeDefined();
  });

  test('paused phase is included in RUN_PHASES', () => {
    expect(RUN_PHASES).toContain('paused');
    expect(RUN_PHASES).toEqual(['ready', 'awaiting_decision', 'paused', 'terminated']);
  });
});
