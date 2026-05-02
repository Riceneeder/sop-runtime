import {RunState, SopDefinition, StepDefinition, StepState} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';

export interface CurrentStepView {
  step_id: string;
  attempt: number;
  step: StepDefinition;
  step_state: StepState;
}

export function assertDefinitionMatchesRun(params: {
  definition: SopDefinition;
  state: RunState;
}): void {
  if (
    params.definition.sop_id === params.state.sop_id
    && params.definition.version === params.state.sop_version
  ) {
    return;
  }

  throw new CoreError('invalid_state', {
    'message': 'Provided definition does not match the run SOP identity/version.',
    'details': {
      'run_sop_id': params.state.sop_id,
      'run_sop_version': params.state.sop_version,
      'definition_sop_id': params.definition.sop_id,
      'definition_version': params.definition.version,
    },
  });
}

export function getCurrentStep(params: {
  definition: SopDefinition;
  state: RunState;
}): CurrentStepView | null {
  assertDefinitionMatchesRun(params);

  if (params.state.phase === 'terminated') {
    return null;
  }

  validateRunForStepAccess(params.state);
  const step = resolveStepDefinition(params);
  const stepState = resolveStepState(params.state, step);

  return {
    'step_id': step.id,
    'attempt': params.state.current_attempt as number,
    step,
    'step_state': structuredClone(stepState),
  };
}

function validateRunForStepAccess(state: RunState): void {
  if (state.status !== 'running') {
    throw new CoreError('invalid_state', {
      'message': 'Non-terminated runs must remain in running status.',
      'details': {
        'status': state.status,
        'phase': state.phase,
      },
    });
  }

  if (state.current_step_id === null || state.current_attempt === null) {
    throw new CoreError('invalid_state', {
      'message': 'Non-terminated runs must track a current step and attempt.',
      'details': {
        'phase': state.phase,
        'current_step_id': state.current_step_id,
        'current_attempt': state.current_attempt,
      },
    });
  }

  if (!Number.isInteger(state.current_attempt) || state.current_attempt < 1) {
    throw new CoreError('invalid_state', {
      'message': 'Current attempt must be a positive integer.',
      'details': {
        'current_attempt': state.current_attempt,
      },
    });
  }
}

function resolveStepDefinition(params: {
  definition: SopDefinition;
  state: RunState;
}): StepDefinition {
  const step = params.definition.steps.find((item) => item.id === params.state.current_step_id);
  if (!step) {
    throw new CoreError('invalid_state', {
      'message': 'Current step is not defined in the SOP definition.',
      'details': {
        'current_step_id': params.state.current_step_id,
      },
    });
  }
  return step;
}

function resolveStepState(state: RunState, step: StepDefinition): StepState {
  const stepState = state.steps[step.id];
  if (!stepState) {
    throw new CoreError('invalid_state', {
      'message': 'Current step state is missing in run snapshot.',
      'details': {
        'current_step_id': step.id,
      },
    });
  }

  if (stepState.step_id !== step.id) {
    throw new CoreError('invalid_state', {
      'message': 'Current step state references a mismatched step id.',
      'details': {
        'current_step_id': step.id,
        'step_state_id': stepState.step_id,
      },
    });
  }

  const expectedStepStatus = state.phase === 'ready'
    ? 'active'
    : 'waiting_decision';
  if (stepState.status !== expectedStepStatus) {
    throw new CoreError('invalid_state', {
      'message': 'Current step lifecycle is inconsistent with run phase.',
      'details': {
        'phase': state.phase,
        'step_status': stepState.status,
        'expected_step_status': expectedStepStatus,
      },
    });
  }

  if (stepState.attempt_count !== state.current_attempt) {
    throw new CoreError('invalid_state', {
      'message': 'Current attempt must match current step attempt count.',
      'details': {
        'current_attempt': state.current_attempt,
        'attempt_count': stepState.attempt_count,
        'step_id': step.id,
      },
    });
  }

  return stepState;
}
