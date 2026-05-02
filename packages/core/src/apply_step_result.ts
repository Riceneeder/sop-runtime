import {
  RunState,
  SopDefinition,
  StepResult,
} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {normalizeAcceptedResult} from './accepted_result.js';
import {assertDefinitionMatchesRun, getCurrentStep} from './get_current_step.js';
import {buildStepResultAcceptedHistory} from './step_result_history.js';
import {validateStepResultShape} from './step_result_validation.js';

export function applyStepResult(params: {
  definition: SopDefinition;
  state: RunState;
  stepResult: StepResult;
  now?: string;
}): RunState {
  assertDefinitionMatchesRun(params);
  assertAcceptingStepResult(params.state);
  validateStepResultShape(params.stepResult);

  const currentStep = resolveCurrentStep(params);
  validateStepResultContext({
    stepResult: params.stepResult,
    currentStep,
    state: params.state,
  });

  const acceptedResult = normalizeAcceptedResult({
    'step': currentStep.step,
    'stepResult': params.stepResult,
  });

  return {
    ...params.state,
    'phase': 'awaiting_decision',
    'accepted_results': {
      ...params.state.accepted_results,
      [currentStep.step_id]: acceptedResult,
    },
    'steps': {
      ...params.state.steps,
      [currentStep.step_id]: {
        ...currentStep.step_state,
        'status': 'waiting_decision',
        'last_result_status': acceptedResult.status,
      },
    },
    'history': [
      ...params.state.history,
      buildStepResultAcceptedHistory({
        'step_id': currentStep.step_id,
        'attempt': currentStep.attempt,
        'result_status': acceptedResult.status,
        'now': params.now,
      }),
    ],
    'updated_at': params.now ?? params.state.updated_at,
  };
}

function assertAcceptingStepResult(state: RunState): void {
  if (state.status !== 'running' || state.phase !== 'ready') {
    throw new CoreError('invalid_state', {
      'message': 'Step results can only be accepted while the run is running and ready.',
      'details': {
        'status': state.status,
        'phase': state.phase,
      },
    });
  }
}

function resolveCurrentStep(params: {
  definition: SopDefinition;
  state: RunState;
}): ReturnType<typeof getCurrentStep> & NonNullable<unknown> {
  const step = getCurrentStep({
    'definition': params.definition,
    'state': params.state,
  });
  if (step === null) {
    throw new CoreError('invalid_state', {
      'message': 'Cannot accept a step result for a terminated run.',
    });
  }
  return step;
}

function validateStepResultContext(params: {
  stepResult: StepResult;
  currentStep: NonNullable<ReturnType<typeof getCurrentStep>>;
  state: RunState;
}): void {
  const {stepResult, currentStep, state} = params;

  if (stepResult.run_id !== state.run_id) {
    throw new CoreError('step_result_rejected', {
      'message': 'Step result run_id does not match the current run.',
      'details': {
        'expected_run_id': state.run_id,
        'actual_run_id': stepResult.run_id,
      },
    });
  }

  if (stepResult.step_id !== currentStep.step_id) {
    throw new CoreError('step_result_rejected', {
      'message': 'Step result step_id does not match the current step.',
      'details': {
        'expected_step_id': currentStep.step_id,
        'actual_step_id': stepResult.step_id,
      },
    });
  }

  if (stepResult.attempt !== currentStep.attempt) {
    throw new CoreError('step_result_rejected', {
      'message': 'Step result attempt does not match the current attempt.',
      'details': {
        'expected_attempt': currentStep.attempt,
        'actual_attempt': stepResult.attempt,
      },
    });
  }
}
