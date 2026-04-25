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

  if (params.state.status !== 'running') {
    throw new CoreError('invalid_state', {
      'message': 'Non-terminated runs must remain in running status.',
      'details': {
        'status': params.state.status,
        'phase': params.state.phase,
      },
    });
  }

  if (params.state.current_step_id === null || params.state.current_attempt === null) {
    throw new CoreError('invalid_state', {
      'message': 'Non-terminated runs must track a current step and attempt.',
      'details': {
        'phase': params.state.phase,
        'current_step_id': params.state.current_step_id,
        'current_attempt': params.state.current_attempt,
      },
    });
  }

  if (!Number.isInteger(params.state.current_attempt) || params.state.current_attempt < 1) {
    throw new CoreError('invalid_state', {
      'message': 'Current attempt must be a positive integer.',
      'details': {
        'current_attempt': params.state.current_attempt,
      },
    });
  }

  const step = params.definition.steps.find((item) => item.id === params.state.current_step_id);
  if (!step) {
    throw new CoreError('invalid_state', {
      'message': 'Current step is not defined in the SOP definition.',
      'details': {
        'current_step_id': params.state.current_step_id,
      },
    });
  }

  const stepState = params.state.steps[step.id];
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

  const expectedStepStatus = params.state.phase === 'ready'
    ? 'active'
    : 'waiting_decision';
  if (stepState.status !== expectedStepStatus) {
    throw new CoreError('invalid_state', {
      'message': 'Current step lifecycle is inconsistent with run phase.',
      'details': {
        'phase': params.state.phase,
        'step_status': stepState.status,
        'expected_step_status': expectedStepStatus,
      },
    });
  }

  if (stepState.attempt_count !== params.state.current_attempt) {
    throw new CoreError('invalid_state', {
      'message': 'Current attempt must match current step attempt count.',
      'details': {
        'current_attempt': params.state.current_attempt,
        'attempt_count': stepState.attempt_count,
        'step_id': step.id,
      },
    });
  }

  return {
    'step_id': step.id,
    'attempt': params.state.current_attempt,
    step,
    'step_state': structuredClone(stepState),
  };
}
