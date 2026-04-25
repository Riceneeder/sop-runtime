import {
  AcceptedStepResultStatus,
  Decision,
  RunState,
  SopDefinition,
  StepLifecycle,
} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {assertDefinitionMatchesRun, getCurrentStep} from './get_current_step.js';

export function applyDecision(params: {
  definition: SopDefinition;
  state: RunState;
  decision: Decision;
  now?: string;
}): RunState {
  assertDefinitionMatchesRun(params);
  assertAcceptingDecision(params.state);
  validateDecisionShape(params.decision);

  const currentStep = getCurrentStep({
    'definition': params.definition,
    'state': params.state,
  });
  if (currentStep === null) {
    throw new CoreError('invalid_state', {
      'message': 'Cannot apply a decision to a terminated run.',
    });
  }

  if (params.decision.run_id !== params.state.run_id) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision run_id does not match the current run.',
      'details': {
        'expected_run_id': params.state.run_id,
        'actual_run_id': params.decision.run_id,
      },
    });
  }
  if (params.decision.step_id !== currentStep.step_id) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision step_id does not match the current step.',
      'details': {
        'expected_step_id': currentStep.step_id,
        'actual_step_id': params.decision.step_id,
      },
    });
  }
  if (params.decision.attempt !== currentStep.attempt) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision attempt does not match the current attempt.',
      'details': {
        'expected_attempt': currentStep.attempt,
        'actual_attempt': params.decision.attempt,
      },
    });
  }

  const acceptedResult = params.state.accepted_results[currentStep.step_id];
  if (acceptedResult === undefined) {
    throw new CoreError('invalid_state', {
      'message': 'Current step is awaiting decision without an accepted result.',
      'details': {'step_id': currentStep.step_id},
    });
  }
  if (acceptedResult.step_id !== currentStep.step_id || acceptedResult.attempt !== currentStep.attempt) {
    throw new CoreError('invalid_state', {
      'message': 'Accepted result does not match the current decision context.',
      'details': {
        'accepted_result_step_id': acceptedResult.step_id,
        'accepted_result_attempt': acceptedResult.attempt,
        'current_step_id': currentStep.step_id,
        'current_attempt': currentStep.attempt,
      },
    });
  }

  const allowedOutcomeIds = currentStep.step.supervision.allowed_outcomes.map((outcome) => outcome.id);
  if (!allowedOutcomeIds.includes(params.decision.outcome_id)) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision outcome is not allowed for the current step.',
      'details': {
        'outcome_id': params.decision.outcome_id,
        'allowed_outcomes': allowedOutcomeIds,
      },
    });
  }

  const transition = currentStep.step.transitions[params.decision.outcome_id];
  if (transition === undefined) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision outcome has no transition defined.',
      'details': {'outcome_id': params.decision.outcome_id},
    });
  }

  const historyWithDecision = [
    ...params.state.history,
    buildDecisionAppliedHistory({
      'step_id': currentStep.step_id,
      'attempt': currentStep.attempt,
      'outcome_id': params.decision.outcome_id,
      'now': params.now,
    }),
  ];

  if (transition.next_step !== undefined) {
    const isSameStepTransition = transition.next_step === currentStep.step_id;
    if (isSameStepTransition) {
      const shouldEnforceRetryOn = acceptedResult.status !== 'success'
        || isRetryLikeOutcome(params.decision.outcome_id);
      assertRetryAllowed({
        'step': currentStep.step,
        'attempt': currentStep.attempt,
        'acceptedStatus': acceptedResult.status,
        'enforceRetryOn': shouldEnforceRetryOn,
      });

      const nextAttempt = currentStep.step_state.attempt_count + 1;
      return {
        ...params.state,
        'phase': 'ready',
        'current_step_id': currentStep.step_id,
        'current_attempt': nextAttempt,
        'steps': {
          ...params.state.steps,
          [currentStep.step_id]: {
            ...currentStep.step_state,
            'status': 'active',
            'attempt_count': nextAttempt,
            'last_outcome_id': params.decision.outcome_id,
          },
        },
        'history': historyWithDecision,
        'updated_at': params.now ?? params.state.updated_at,
      };
    }

    const nextStepState = params.state.steps[transition.next_step];
    if (nextStepState === undefined) {
      throw new CoreError('invalid_state', {
        'message': 'Transition points to a step that is missing in run state.',
        'details': {'next_step': transition.next_step},
      });
    }

    const nextAttempt = nextStepState.attempt_count + 1;
    return {
      ...params.state,
      'phase': 'ready',
      'current_step_id': transition.next_step,
      'current_attempt': nextAttempt,
      'steps': {
        ...params.state.steps,
        [currentStep.step_id]: {
          ...currentStep.step_state,
          'status': toCompletedStepLifecycle(acceptedResult.status),
          'last_outcome_id': params.decision.outcome_id,
        },
        [transition.next_step]: {
          ...nextStepState,
          'status': 'active',
          'attempt_count': nextAttempt,
        },
      },
      'history': historyWithDecision,
      'updated_at': params.now ?? params.state.updated_at,
    };
  }

  if (transition.terminate !== undefined) {
    return {
      ...params.state,
      'status': transition.terminate.run_status,
      'phase': 'terminated',
      'current_step_id': null,
      'current_attempt': null,
      'terminal': {
        'run_status': transition.terminate.run_status,
        'reason': transition.terminate.reason,
      },
      'steps': {
        ...params.state.steps,
        [currentStep.step_id]: {
          ...currentStep.step_state,
          'status': toCompletedStepLifecycle(acceptedResult.status),
          'last_outcome_id': params.decision.outcome_id,
        },
      },
      'history': [
        ...historyWithDecision,
        buildRunTerminatedHistory({
          'run_status': transition.terminate.run_status,
          'reason': transition.terminate.reason,
          'now': params.now,
        }),
      ],
      'updated_at': params.now ?? params.state.updated_at,
    };
  }

  throw new CoreError('invalid_state', {
    'message': 'Transition must define either next_step or terminate.',
    'details': {'outcome_id': params.decision.outcome_id},
  });
}

function assertAcceptingDecision(state: RunState): void {
  if (state.status !== 'running' || state.phase !== 'awaiting_decision') {
    throw new CoreError('invalid_state', {
      'message': 'Decisions can only be applied while the run is awaiting decision.',
      'details': {
        'status': state.status,
        'phase': state.phase,
      },
    });
  }
}

function validateDecisionShape(decision: Decision): void {
  const value = decision as unknown;
  if (!isPlainObject(value)) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision must be an object.',
    });
  }

  if (typeof value.run_id !== 'string') {
    throw new CoreError('decision_rejected', {'message': 'Decision run_id must be a string.'});
  }
  if (typeof value.step_id !== 'string') {
    throw new CoreError('decision_rejected', {'message': 'Decision step_id must be a string.'});
  }
  if (typeof value.attempt !== 'number' || !Number.isInteger(value.attempt) || value.attempt < 1) {
    throw new CoreError('decision_rejected', {'message': 'Decision attempt must be a positive integer.'});
  }
  if (typeof value.outcome_id !== 'string') {
    throw new CoreError('decision_rejected', {'message': 'Decision outcome_id must be a string.'});
  }
  if (value.reason !== undefined && typeof value.reason !== 'string') {
    throw new CoreError('decision_rejected', {'message': 'Decision reason must be a string when present.'});
  }
  if (value.metadata !== undefined && !isPlainObject(value.metadata)) {
    throw new CoreError('decision_rejected', {'message': 'Decision metadata must be a JSON object when present.'});
  }
}

function assertRetryAllowed(params: {
  step: SopDefinition['steps'][number];
  attempt: number;
  acceptedStatus: AcceptedStepResultStatus;
  enforceRetryOn: boolean;
}): void {
  if (params.attempt >= params.step.retry_policy.max_attempts) {
    throw new CoreError('decision_rejected', {
      'message': 'Retry exceeds the configured max_attempts.',
      'details': {
        'attempt': params.attempt,
        'max_attempts': params.step.retry_policy.max_attempts,
      },
    });
  }

  if (!params.enforceRetryOn) {
    return;
  }

  if (params.acceptedStatus === 'success' || !params.step.retry_policy.retry_on.includes(params.acceptedStatus)) {
    throw new CoreError('decision_rejected', {
      'message': 'Retry is not allowed for the current accepted result status.',
      'details': {
        'accepted_status': params.acceptedStatus,
        'retry_on': params.step.retry_policy.retry_on,
      },
    });
  }
}

function toCompletedStepLifecycle(status: AcceptedStepResultStatus): StepLifecycle {
  return status === 'success' ? 'completed' : 'failed';
}

function buildDecisionAppliedHistory(params: {
  step_id: string;
  attempt: number;
  outcome_id: string;
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'decision_applied',
    'step_id': params.step_id,
    'attempt': params.attempt,
    'outcome_id': params.outcome_id,
  };

  if (params.now !== undefined) {
    return {
      ...entry,
      'at': params.now,
    };
  }

  return entry;
}

function buildRunTerminatedHistory(params: {
  run_status: Exclude<RunState['status'], 'running'>;
  reason: string;
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'run_terminated',
    'run_status': params.run_status,
    'reason': params.reason,
  };

  if (params.now !== undefined) {
    return {
      ...entry,
      'at': params.now,
    };
  }

  return entry;
}

function isRetryLikeOutcome(outcomeId: string): boolean {
  return outcomeId.toLowerCase() === 'retry';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
