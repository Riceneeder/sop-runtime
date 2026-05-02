import {describe, expect, test} from 'bun:test';
import {applyStepResult, createRun} from './index.js';
import {buildDefinition} from './apply_step_result_test_helpers.js';

describe('applyStepResult', () => {
  test('accepts a matching success result and moves the run to awaiting_decision', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const nextState = applyStepResult({
      definition,
      state,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'success',
        'output': {'summary': 'ok'},
      },
      'now': '2026-04-20T12:10:00Z',
    });

    expect(nextState.phase).toBe('awaiting_decision');
    expect(nextState.steps.step_a?.status).toBe('waiting_decision');
    expect(nextState.steps.step_a?.last_result_status).toBe('success');
    expect(nextState.accepted_results.step_a?.status).toBe('success');
    expect(nextState.updated_at).toBe('2026-04-20T12:10:00Z');
  });
});
