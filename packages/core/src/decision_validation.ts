import {
  Decision,
  RunState,
} from '@sop-runtime/definition';
import {isStrictPlainObject} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {CurrentStepView} from './get_current_step.js';

/**
 * Assert that the run is in the awaiting_decision phase and can accept decisions.
 *
 * 断言运行处于 awaiting_decision 阶段，可以接收决策。
 *
 * @param state - The run state to validate.
 * @throws {CoreError} If the run is not awaiting a decision.
 * @public
 */
export function assertAcceptingDecision(state: RunState): void {
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

/**
 * Validate the shape and types of an incoming Decision object.
 *
 * 校验入站 Decision 对象的形状和类型。
 *
 * @param decision - The decision to validate.
 * @throws {CoreError} If any field is missing or has an invalid type.
 * @public
 */
export function validateDecisionShape(decision: Decision): void {
  const value = decision as unknown;
  if (!isStrictPlainObject(value)) {
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
  if (value.metadata !== undefined && !isStrictPlainObject(value.metadata)) {
    throw new CoreError('decision_rejected', {'message': 'Decision metadata must be a JSON object when present.'});
  }
}

/**
 * Validate that a decision matches the current run context (step, attempt, outcome).
 *
 * 校验决策与当前运行上下文（步骤、尝试次数、结果）一致。
 *
 * @param params - Object containing the decision, current step view, and run state.
 * @param params.decision - The decision to validate.
 * @param params.currentStep - The resolved current step view.
 * @param params.state - The run state.
 * @returns The matched accepted result.
 * @throws {CoreError} If the decision does not match the current context.
 * @public
 */
export function validateDecisionContext(params: {
  decision: Decision;
  currentStep: CurrentStepView;
  state: RunState;
}): void {
  validateDecisionMatchesCurrentStep(params);
  validateAcceptedResultPresentAndMatch(params);
  validateOutcomeIsAllowed(params.decision.outcome_id, params.currentStep);
}

/**
 * Verify that the decision targets the correct run, step, and attempt.
 *
 * 验证决策指向正确的运行、步骤和尝试次数。
 */
function validateDecisionMatchesCurrentStep(params: {
  decision: Decision;
  currentStep: CurrentStepView;
  state: RunState;
}): void {
  const {decision, currentStep, state} = params;

  if (decision.run_id !== state.run_id) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision run_id does not match the current run.',
      'details': {
        'expected_run_id': state.run_id,
        'actual_run_id': decision.run_id,
      },
    });
  }
  if (decision.step_id !== currentStep.step_id) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision step_id does not match the current step.',
      'details': {
        'expected_step_id': currentStep.step_id,
        'actual_step_id': decision.step_id,
      },
    });
  }
  if (decision.attempt !== currentStep.attempt) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision attempt does not match the current attempt.',
      'details': {
        'expected_attempt': currentStep.attempt,
        'actual_attempt': decision.attempt,
      },
    });
  }
}

/**
 * Verify that an accepted result exists for the current step and matches the context.
 *
 * 验证当前步骤存在已接纳的结果且与上下文匹配。
 */
function validateAcceptedResultPresentAndMatch(params: {
  currentStep: CurrentStepView;
  state: RunState;
}): NonNullable<RunState['accepted_results'][string]> {
  const acceptedResult = params.state.accepted_results[params.currentStep.step_id];
  if (acceptedResult === undefined) {
    throw new CoreError('invalid_state', {
      'message': 'Current step is awaiting decision without an accepted result.',
      'details': {'step_id': params.currentStep.step_id},
    });
  }
  if (acceptedResult.step_id !== params.currentStep.step_id || acceptedResult.attempt !== params.currentStep.attempt) {
    throw new CoreError('invalid_state', {
      'message': 'Accepted result does not match the current decision context.',
      'details': {
        'accepted_result_step_id': acceptedResult.step_id,
        'accepted_result_attempt': acceptedResult.attempt,
        'current_step_id': params.currentStep.step_id,
        'current_attempt': params.currentStep.attempt,
      },
    });
  }
  return acceptedResult;
}

/**
 * Verify that the outcome is listed in the step's allowed outcomes.
 *
 * 验证结果属于步骤允许的结果列表。
 */
function validateOutcomeIsAllowed(outcomeId: string, currentStep: CurrentStepView): void {
  const allowedOutcomeIds = currentStep.step.supervision.allowed_outcomes.map((outcome) => outcome.id);
  if (!allowedOutcomeIds.includes(outcomeId)) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision outcome is not allowed for the current step.',
      'details': {
        'outcome_id': outcomeId,
        'allowed_outcomes': allowedOutcomeIds,
      },
    });
  }
}
