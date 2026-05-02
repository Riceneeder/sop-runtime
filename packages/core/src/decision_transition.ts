import {
  AcceptedStepResult,
  AcceptedStepResultStatus,
  RunState,
  SopDefinition,
  StepLifecycle,
  StepState,
} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {
  buildDecisionAppliedHistory,
  buildRunTerminatedHistory,
} from './decision_history.js';

export function applySameStepRetry(params: {
  state: RunState;
  step: SopDefinition['steps'][number];
  stepState: StepState;
  attempt: number;
  outcomeId: string;
  acceptedResult: AcceptedStepResult;
  now?: string;
}): RunState {
  const shouldEnforceRetryOn = params.acceptedResult.status !== 'success'
    || isRetryLikeOutcome(params.outcomeId);
  assertRetryAllowed({
    'step': params.step,
    'attempt': params.attempt,
    'acceptedStatus': params.acceptedResult.status,
    'enforceRetryOn': shouldEnforceRetryOn,
  });

  const nextAttempt = params.stepState.attempt_count + 1;
  const historyWithDecision = [
    ...params.state.history,
    buildDecisionAppliedHistory({
      'step_id': params.stepState.step_id,
      'attempt': params.attempt,
      'outcome_id': params.outcomeId,
      'now': params.now,
    }),
  ];

  return {
    ...params.state,
    'phase': 'ready',
    'current_step_id': params.stepState.step_id,
    'current_attempt': nextAttempt,
    'steps': {
      ...params.state.steps,
      [params.stepState.step_id]: {
        ...params.stepState,
        'status': 'active',
        'attempt_count': nextAttempt,
        'last_outcome_id': params.outcomeId,
      },
    },
    'history': historyWithDecision,
    'updated_at': params.now ?? params.state.updated_at,
  };
}

export function applyNextStepTransition(params: {
  state: RunState;
  currentStepId: string;
  currentStepState: StepState;
  nextStepId: string;
  attempt: number;
  acceptedResult: AcceptedStepResult;
  outcomeId: string;
  now?: string;
}): RunState {
  const nextStepState = params.state.steps[params.nextStepId];
  if (nextStepState === undefined) {
    throw new CoreError('invalid_state', {
      'message': 'Transition points to a step that is missing in run state.',
      'details': {'next_step': params.nextStepId},
    });
  }

  const nextAttempt = nextStepState.attempt_count + 1;
  const historyWithDecision = [
    ...params.state.history,
    buildDecisionAppliedHistory({
      'step_id': params.currentStepId,
      'attempt': params.attempt,
      'outcome_id': params.outcomeId,
      'now': params.now,
    }),
  ];

  return {
    ...params.state,
    'phase': 'ready',
    'current_step_id': params.nextStepId,
    'current_attempt': nextAttempt,
    'steps': {
      ...params.state.steps,
      [params.currentStepId]: {
        ...params.currentStepState,
        'status': toCompletedStepLifecycle(params.acceptedResult.status),
        'last_outcome_id': params.outcomeId,
      },
      [params.nextStepId]: {
        ...nextStepState,
        'status': 'active',
        'attempt_count': nextAttempt,
      },
    },
    'history': historyWithDecision,
    'updated_at': params.now ?? params.state.updated_at,
  };
}

export function applyTerminateTransition(params: {
  state: RunState;
  currentStepId: string;
  currentStepState: StepState;
  attempt: number;
  acceptedResult: AcceptedStepResult;
  outcomeId: string;
  terminate: {run_status: Exclude<RunState['status'], 'running'>; reason: string};
  now?: string;
}): RunState {
  const historyWithDecision = [
    ...params.state.history,
    buildDecisionAppliedHistory({
      'step_id': params.currentStepId,
      'attempt': params.attempt,
      'outcome_id': params.outcomeId,
      'now': params.now,
    }),
  ];

  return {
    ...params.state,
    'status': params.terminate.run_status,
    'phase': 'terminated',
    'current_step_id': null,
    'current_attempt': null,
    'terminal': {
      'run_status': params.terminate.run_status,
      'reason': params.terminate.reason,
    },
    'steps': {
      ...params.state.steps,
      [params.currentStepId]: {
        ...params.currentStepState,
        'status': toCompletedStepLifecycle(params.acceptedResult.status),
        'last_outcome_id': params.outcomeId,
      },
    },
    'history': [
      ...historyWithDecision,
      buildRunTerminatedHistory({
        'run_status': params.terminate.run_status,
        'reason': params.terminate.reason,
        'now': params.now,
      }),
    ],
    'updated_at': params.now ?? params.state.updated_at,
  };
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

function isRetryLikeOutcome(outcomeId: string): boolean {
  return outcomeId.toLowerCase() === 'retry';
}
