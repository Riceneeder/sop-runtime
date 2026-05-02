import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, applyDecision, applyStepResult, createRun} from './index.js';
import {buildDefinition, runAwaitingDecision} from './apply_decision_test_helpers.js';

describe('applyDecision retry transitions', () => {
  test('rejects success same-step loops when max_attempts is reached', () => {
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
    const firstAwaitingDecision = runAwaitingDecision(sameStepContinueDefinition, 'success');
    const secondAttemptReady = applyDecision({
      'definition': sameStepContinueDefinition,
      'state': firstAwaitingDecision,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'outcome_id': 'continue',
      },
    });
    const secondAwaitingDecision = applyStepResult({
      'definition': sameStepContinueDefinition,
      'state': secondAttemptReady,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 2,
        'status': 'success',
        'output': {'summary': 'ok-again'},
      },
    });

    let error: unknown;
    try {
      applyDecision({
        'definition': sameStepContinueDefinition,
        'state': secondAwaitingDecision,
        'decision': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 2,
          'outcome_id': 'continue',
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect((error as CoreError).code).toBe('decision_rejected');
  });

  test('supports self-loop retries and enforces retry_on/max_attempts', () => {
    const definition = buildDefinition();
    const awaitingRetry = runAwaitingDecision(definition, 'tool_error');
    const retriedState = applyDecision({
      definition,
      'state': awaitingRetry,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'outcome_id': 'retry',
      },
    });

    expect(retriedState.phase).toBe('ready');
    expect(retriedState.current_step_id).toBe('step_a');
    expect(retriedState.current_attempt).toBe(2);
    expect(retriedState.steps.step_a?.status).toBe('active');
    expect(retriedState.steps.step_a?.attempt_count).toBe(2);

    let retryStatusError: unknown;
    try {
      applyDecision({
        definition,
        'state': runAwaitingDecision(definition, 'success'),
        'decision': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'outcome_id': 'retry',
        },
      });
    } catch (caught) {
      retryStatusError = caught;
    }

    let retryLimitError: unknown;
    try {
      applyDecision({
        definition,
        'state': {
          ...awaitingRetry,
          'current_attempt': 2,
          'steps': {
            ...awaitingRetry.steps,
            'step_a': {
              ...awaitingRetry.steps.step_a!,
              'attempt_count': 2,
            },
          },
          'accepted_results': {
            ...awaitingRetry.accepted_results,
            'step_a': {
              ...awaitingRetry.accepted_results.step_a!,
              'attempt': 2,
            },
          },
        },
        'decision': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 2,
          'outcome_id': 'retry',
        },
      });
    } catch (caught) {
      retryLimitError = caught;
    }

    expect((retryStatusError as CoreError).code).toBe('decision_rejected');
    expect((retryLimitError as CoreError).code).toBe('decision_rejected');
  });

  test('enforces retry policy for non-success same-step loops even when outcome is not named retry', () => {
    const definition = buildDefinition();
    const sameStepRerunDefinition: SopDefinition = {
      ...definition,
      'steps': definition.steps.map((step) => {
        if (step.id !== 'step_a') {
          return step;
        }

        return {
          ...step,
          'supervision': {
            ...step.supervision,
            'allowed_outcomes': [
              ...step.supervision.allowed_outcomes,
              {'id': 'rerun', 'description': 'rerun'},
            ],
          },
          'transitions': {
            ...step.transitions,
            'rerun': {'next_step': 'step_a'},
          },
        };
      }),
    };
    const created = createRun({
      'definition': sameStepRerunDefinition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const awaitingDecision = applyStepResult({
      'definition': sameStepRerunDefinition,
      'state': created,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'timeout',
        'output': {'summary': 'partial'} as never,
      },
    });

    let error: unknown;
    try {
      applyDecision({
        'definition': sameStepRerunDefinition,
        'state': awaitingDecision,
        'decision': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'outcome_id': 'rerun',
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect((error as CoreError).code).toBe('decision_rejected');
  });
});
