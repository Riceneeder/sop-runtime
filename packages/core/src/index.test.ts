import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-exec/definition';
import {buildStepPacket, createRun, getCurrentStep} from './index';

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
        'kind': 'sandbox_tool',
      },
      'output_schema': {},
      'retry_policy': {},
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
});
