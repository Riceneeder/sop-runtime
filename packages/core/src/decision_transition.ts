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

/**
 * Apply a decision outcome that retries the current step (increments attempt).
 *
 * 应用重试当前步骤的决策结果（递增尝试次数）。
 *
 * @param params - Object containing the state, step, and retry configuration.
 * @param params.state - The current run state.
 * @param params.step - The step definition for retry-policy validation.
 * @param params.stepState - The current step state.
 * @param params.attempt - The current attempt number.
 * @param params.outcomeId - The outcome identifier.
 * @param params.acceptedResult - The accepted step result.
 * @param params.now - Optional timestamp for history entries.
 * @returns The updated run state with phase reset to ready.
 * @throws {CoreError} If retry is not allowed by policy.
 * @public
 */
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

/**
 * Apply a decision outcome that transitions to the next step in the workflow.
 *
 * 应用转移到工作流中下一步骤的决策结果。
 *
 * @param params - Object containing the state and transition configuration.
 * @param params.state - The current run state.
 * @param params.currentStepId - The current step identifier.
 * @param params.currentStepState - The state of the current step.
 * @param params.nextStepId - The target step identifier to transition to.
 * @param params.attempt - The current attempt number.
 * @param params.acceptedResult - The accepted step result.
 * @param params.outcomeId - The outcome identifier.
 * @param params.now - Optional timestamp for history entries.
 * @returns The updated run state with the next step activated.
 * @throws {CoreError} If the next step state is missing.
 * @public
 */
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
  const nextStepState = getRequiredStepState(params.state, params.nextStepId);
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

/**
 * Apply a decision outcome that terminates the run with a final status.
 *
 * 应用终止运行并设置最终状态的决策结果。
 *
 * @param params - Object containing the state and termination configuration.
 * @param params.state - The current run state.
 * @param params.currentStepId - The current step identifier.
 * @param params.currentStepState - The state of the current step.
 * @param params.attempt - The current attempt number.
 * @param params.acceptedResult - The accepted step result.
 * @param params.outcomeId - The outcome identifier.
 * @param params.terminate - Termination configuration (run_status and reason).
 * @param params.now - Optional timestamp for history entries.
 * @returns The terminated run state.
 * @public
 */
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

/**
 * Assert that a retry is permitted under the step's retry policy.
 *
 * 断言重试在步骤的重试策略下是允许的。
 */
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

/**
 * Look up a step state and throw if it is missing.
 *
 * 查找步骤状态，若缺失则抛出异常。
 */
function getRequiredStepState(state: RunState, stepId: string): StepState {
  const stepState = state.steps[stepId];
  if (stepState === undefined) {
    throw new CoreError('invalid_state', {
      'message': 'Transition points to a step that is missing in run state.',
      'details': {'next_step': stepId},
    });
  }
  return stepState;
}

/**
 * Convert an accepted result status to a terminal step lifecycle.
 *
 * 将已接纳结果状态转换为终止的步骤生命周期。
 */
function toCompletedStepLifecycle(status: AcceptedStepResultStatus): StepLifecycle {
  return status === 'success' ? 'completed' : 'failed';
}

/**
 * Check whether an outcome identifier signals a retry (case-insensitive).
 *
 * 检查结果标识符是否表示重试（不区分大小写）。
 */
function isRetryLikeOutcome(outcomeId: string): boolean {
  return outcomeId.toLowerCase() === 'retry';
}
