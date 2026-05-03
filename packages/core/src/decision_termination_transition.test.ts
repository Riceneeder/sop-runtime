import {describe, expect, test} from 'bun:test';
import {applyDecision, applyStepResult} from './index.js';
import {buildDefinition, runAwaitingDecision} from './apply_decision_test_helpers.js';

describe('applyDecision termination transitions', () => {
  test('uses cumulative attempts when re-entering a step via non-self transition and still supports termination', () => {
    const definition = buildDefinition();
    const stepAComplete = runAwaitingDecision(definition);
    const onStepB = applyDecision({
      definition,
      'state': stepAComplete,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'outcome_id': 'continue',
      },
    });
    const stepBAwaiting = applyStepResult({
      definition,
      'state': onStepB,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_b',
        'attempt': 1,
        'status': 'success',
        'output': {'summary': 'done'},
      },
    });
    const backToStepA = applyDecision({
      definition,
      'state': stepBAwaiting,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_b',
        'attempt': 1,
        'outcome_id': 'back',
      },
    });

    expect(backToStepA.status).toBe('running');
    expect(backToStepA.phase).toBe('ready');
    expect(backToStepA.current_step_id).toBe('step_a');
    expect(backToStepA.current_attempt).toBe(2);
    expect(backToStepA.steps.step_b?.status).toBe('completed');
    expect(backToStepA.steps.step_a?.status).toBe('active');
    expect(backToStepA.steps.step_a?.attempt_count).toBe(2);

    const failingAwait = runAwaitingDecision(definition, 'tool_error');
    const terminated = applyDecision({
      definition,
      'state': failingAwait,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'outcome_id': 'fail_run',
      },
      'now': '2026-04-20T12:20:00Z',
    });

    expect(terminated.status).toBe('failed');
    expect(terminated.phase).toBe('terminated');
    expect(terminated.current_step_id).toBeNull();
    expect(terminated.current_attempt).toBeNull();
    expect(terminated.steps.step_a?.status).toBe('failed');
    expect(terminated.terminal).toEqual({
      'run_status': 'failed',
      'reason': 'step_a_failed',
    });
    expect(terminated.history.at(-2)).toEqual({
      'kind': 'decision_applied',
      'step_id': 'step_a',
      'attempt': 1,
      'outcome_id': 'fail_run',
      'at': '2026-04-20T12:20:00Z',
    });
    expect(terminated.history.at(-1)).toEqual({
      'kind': 'run_terminated',
      'run_status': 'failed',
      'reason': 'step_a_failed',
      'at': '2026-04-20T12:20:00Z',
    });
  });
});
