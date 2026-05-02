import {
  AcceptedStepResult,
  Decision,
  RunState,
  SopDefinition,
} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {assertDefinitionMatchesRun, getCurrentStep, CurrentStepView} from './get_current_step.js';
import {
  assertAcceptingDecision,
  validateDecisionContext,
  validateDecisionShape,
} from './decision_validation.js';
import {
  applyNextStepTransition,
  applySameStepRetry,
  applyTerminateTransition,
} from './decision_transition.js';

export function applyDecision(params: {
  definition: SopDefinition;
  state: RunState;
  decision: Decision;
  now?: string;
}): RunState {
  assertDefinitionMatchesRun(params);
  assertAcceptingDecision(params.state);
  validateDecisionShape(params.decision);
  const currentStep = resolveCurrentStep(params);
  validateDecisionContext({
    'decision': params.decision,
    currentStep,
    'state': params.state,
  });

  const outcomeId = params.decision.outcome_id;
  const transition = currentStep.step.transitions[outcomeId];
  if (transition === undefined) {
    throw new CoreError('decision_rejected', {
      'message': 'Decision outcome has no transition defined.',
      'details': {'outcome_id': outcomeId},
    });
  }

  const accepted = params.state.accepted_results[currentStep.step_id] as AcceptedStepResult;
  if (transition.next_step !== undefined) {
    return dispatchNextStep(transition.next_step, currentStep, accepted, params);
  }
  if (transition.terminate !== undefined) {
    return applyTerminateTransition({
      'state': params.state,
      'currentStepId': currentStep.step_id,
      'currentStepState': currentStep.step_state,
      'attempt': currentStep.attempt,
      'acceptedResult': accepted,
      'outcomeId': outcomeId,
      'terminate': transition.terminate,
      'now': params.now,
    });
  }

  throw new CoreError('invalid_state', {
    'message': 'Transition must define either next_step or terminate.',
    'details': {'outcome_id': outcomeId},
  });
}

function resolveCurrentStep(params: {
  definition: SopDefinition;
  state: RunState;
}): CurrentStepView {
  const step = getCurrentStep({
    'definition': params.definition,
    'state': params.state,
  });
  if (step === null) {
    throw new CoreError('invalid_state', {
      'message': 'Cannot apply a decision to a terminated run.',
    });
  }
  return step;
}

function dispatchNextStep(
  nextStepId: string,
  currentStep: CurrentStepView,
  accepted: AcceptedStepResult,
  params: {state: RunState; decision: Decision; now?: string},
): RunState {
  if (nextStepId === currentStep.step_id) {
    return applySameStepRetry({
      'state': params.state,
      'step': currentStep.step,
      'stepState': currentStep.step_state,
      'attempt': currentStep.attempt,
      'outcomeId': params.decision.outcome_id,
      'acceptedResult': accepted,
      'now': params.now,
    });
  }

  return applyNextStepTransition({
    'state': params.state,
    'currentStepId': currentStep.step_id,
    'currentStepState': currentStep.step_state,
    'nextStepId': nextStepId,
    'attempt': currentStep.attempt,
    'acceptedResult': accepted,
    'outcomeId': params.decision.outcome_id,
    'now': params.now,
  });
}
