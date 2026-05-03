import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {applyDecision} from './index.js';
import {buildDefinition, runAwaitingDecision} from './apply_decision_test_helpers.js';

describe('applyDecision next-step transitions', () => {
  test('continues to the next step and activates it', () => {
    const definition = buildDefinition();
    const awaitingDecision = runAwaitingDecision(definition);
    const nextState = applyDecision({
      definition,
      'state': awaitingDecision,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'outcome_id': 'continue',
      },
    });

    expect(nextState.status).toBe('running');
    expect(nextState.phase).toBe('ready');
    expect(nextState.current_step_id).toBe('step_b');
    expect(nextState.current_attempt).toBe(1);
    expect(nextState.steps.step_a?.status).toBe('completed');
    expect(nextState.steps.step_b?.status).toBe('active');
    expect(nextState.steps.step_b?.attempt_count).toBe(1);
    expect(nextState.history.at(-1)).toEqual({
      'kind': 'decision_applied',
      'step_id': 'step_a',
      'attempt': 1,
      'outcome_id': 'continue',
    });
  });

  test('allows non-retry same-step loops on success and advances the attempt', () => {
    const definition = buildDefinition();
    const sameStepContinueDefinition: SopDefinition = {
      ...definition,
      'steps': definition.steps.map((step) => {
        if (step.id !== 'step_a') {
          return step;
        }

        return {
          ...step,
          'transitions': {
            ...step.transitions,
            'continue': {'next_step': 'step_a'},
          },
        };
      }),
    };
    const awaitingDecision = runAwaitingDecision(sameStepContinueDefinition, 'success');
    const nextState = applyDecision({
      'definition': sameStepContinueDefinition,
      'state': awaitingDecision,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'outcome_id': 'continue',
      },
    });

    expect(nextState.status).toBe('running');
    expect(nextState.phase).toBe('ready');
    expect(nextState.current_step_id).toBe('step_a');
    expect(nextState.current_attempt).toBe(2);
    expect(nextState.steps.step_a?.status).toBe('active');
    expect(nextState.steps.step_a?.attempt_count).toBe(2);
    expect(nextState.steps.step_a?.last_outcome_id).toBe('continue');
    expect(nextState.history.at(-1)).toEqual({
      'kind': 'decision_applied',
      'step_id': 'step_a',
      'attempt': 1,
      'outcome_id': 'continue',
    });
  });
});
