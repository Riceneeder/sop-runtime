import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {buildStepPacket, CoreError, createRun, getCurrentStep} from './index.js';

const definition: SopDefinition = {
  'sop_id': 'news_report',
  'name': 'News Report',
  'version': '1.0.0',
  'entry_step': 'search_news',
  'input_schema': {'type': 'object'},
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
  'steps': [
    {
      'id': 'search_news',
      'title': 'Search News',
      'inputs': {
        'company': '${run.input.company}',
      },
      'executor': {
        'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search {{company}}', 'path': '/tmp/workspace' },
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
        'continue': {'next_step': 'search_news'},
      },
    },
  ],
  'final_output': {'ok': true},
};

describe('core package', () => {
  test('creates the initial run and builds the first step packet', () => {
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const currentStep = getCurrentStep({
      definition,
      state,
    });
    const packet = buildStepPacket({
      definition,
      state,
    });

    expect(state.current_step_id).toBe('search_news');
    expect(state.current_attempt).toBe(1);
    expect(currentStep?.step_id).toBe('search_news');
    expect(packet.inputs.company).toBe('Acme');
  });

  test('returns current step_state as a copy', () => {
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const currentStep = getCurrentStep({
      definition,
      state,
    });

    if (currentStep === null) {
      throw new Error('Expected current step for running state.');
    }

    expect(currentStep.step_state).not.toBe(state.steps.search_news);
    currentStep.step_state.status = 'failed';
    currentStep.step_state.attempt_count = 999;

    expect(state.steps.search_news?.status).toBe('active');
    expect(state.steps.search_news?.attempt_count).toBe(1);
  });

  test('rejects current-step lookup when definition id/version mismatches run state', () => {
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    let error: unknown;
    try {
      getCurrentStep({
        'definition': {
          ...definition,
          'sop_id': 'other_sop',
        },
        state,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('getCurrentStep returns null for terminated run', () => {
    const state = {
      ...createRun({
        definition,
        'input': {'company': 'Acme'},
        'runId': 'run_001',
      }),
      'phase': 'terminated' as const,
      'current_step_id': null,
      'current_attempt': null,
    };

    expect(getCurrentStep({definition, state})).toBeNull();
  });
});
