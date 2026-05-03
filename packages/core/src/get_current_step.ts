import {RunState, SopDefinition, StepDefinition, StepState} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';

/**
 * Resolved view of the currently executing step.
 *
 * 当前正在执行的步骤的已解析视图。
 *
 * @public
 */
export interface CurrentStepView {
  /** Identifier of the current step. 当前步骤的标识符。 */
  step_id: string;
  /** Current execution attempt number (1-based). 当前执行尝试次数（从 1 开始）。 */
  attempt: number;
  /** Resolved step definition from the SOP. 从 SOP 解析的步骤定义。 */
  step: StepDefinition;
  /** Current state of the step within the run. 步骤在运行中的当前状态。 */
  step_state: StepState;
}

/**
 * Assert that a given SOP definition matches the identity of an existing run.
 *
 * 断言给定 SOP 定义与现有运行的身份匹配。
 *
 * @param params - Object containing the definition and run state.
 * @param params.definition - The SOP definition to check.
 * @param params.state - The run state to match against.
 * @throws {CoreError} If the sop_id or version do not match.
 * @public
 */
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

/**
 * Resolve the current step definition and state from a run snapshot.
 *
 * 从运行快照中解析当前步骤的定义和状态。
 *
 * @param params - Object containing the definition and run state.
 * @param params.definition - The SOP definition to resolve from.
 * @param params.state - The run state to inspect.
 * @returns The current step view, or null if the run is terminated.
 * @throws {CoreError} If the run state is inconsistent with the definition.
 * @public
 */
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

/**
 * Validate that a run is in a suitable state for step-level access.
 *
 * 验证运行状态是否适合进行步骤级访问。
 */
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

/**
 * Look up the current step definition by its identifier.
 *
 * 根据当前步骤标识符查找步骤定义。
 */
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

/**
 * Map the run phase to the expected step lifecycle status.
 *
 * 将运行阶段映射到期望的步骤生命周期状态。
 */
function getExpectedStepStatus(state: RunState): StepState['status'] {
  if (state.phase === 'ready') return 'active';
  if (state.phase === 'awaiting_decision') return 'waiting_decision';
  if (state.phase === 'paused') {
    if (state.pause?.previous_phase === 'ready') return 'active';
    if (state.pause?.previous_phase === 'awaiting_decision') return 'waiting_decision';
    throw new CoreError('invalid_state', {
      'message': 'Paused run must preserve the previous phase.',
      'details': {
        'phase': state.phase,
        'pause': state.pause ?? null,
      },
    });
  }
  throw new CoreError('invalid_state', {
    'message': 'Cannot determine expected step status for current run phase.',
    'details': {
      'phase': state.phase,
    },
  });
}

/**
 * Resolve the step state for a given step and verify consistency with the run phase.
 *
 * 解析给定步骤的状态，并验证与运行阶段的一致性。
 */
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

  const expectedStepStatus = getExpectedStepStatus(state);
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
