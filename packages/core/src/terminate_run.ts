import {RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';

/**
 * Valid final statuses for a terminated run.
 *
 * 已终止运行的有效最终状态。
 */
const VALID_TERMINATION_STATUSES = new Set(['cancelled', 'failed']);

/**
 * Terminate a running run with a final status, marking its current step as failed.
 *
 * 以最终状态终止正在运行的运行，并将当前步骤标记为 failed。
 *
 * @param params - Object containing the definition, state, termination details, and optional timestamp.
 * @param params.definition - The SOP definition.
 * @param params.state - The current run state.
 * @param params.runStatus - The terminal status (cancelled or failed).
 * @param params.reason - Human-readable termination reason.
 * @param params.now - Optional timestamp for history entries.
 * @returns The terminated run state.
 * @throws {CoreError} If the run cannot be terminated.
 * @public
 */
export function terminateRun(params: {
  definition: SopDefinition;
  state: RunState;
  runStatus: 'cancelled' | 'failed';
  reason: string;
  now?: string;
}): RunState {
  assertCanTerminate(params);
  const steps = buildTerminatedSteps(params.state);

  return {
    ...params.state,
    'status': params.runStatus,
    'phase': 'terminated',
    'current_step_id': null,
    'current_attempt': null,
    steps,
    'terminal': {
      'run_status': params.runStatus,
      'reason': params.reason,
    },
    'pause': undefined,
    'history': [
      ...params.state.history,
      buildRunTerminatedHistory({
        'run_status': params.runStatus,
        'reason': params.reason,
        'now': params.now,
      }),
    ],
    'updated_at': params.now ?? params.state.updated_at,
  };
}

/**
 * Assert that the run can be terminated (matching definition, running, not already terminated, valid status).
 *
 * 断言运行可以终止（定义匹配、运行中、未终止、状态有效）。
 */
function assertCanTerminate(params: {
  definition: SopDefinition;
  state: RunState;
  runStatus: 'cancelled' | 'failed';
}): void {
  if (params.definition.sop_id !== params.state.sop_id || params.definition.version !== params.state.sop_version) {
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

  if (params.state.status !== 'running') {
    throw new CoreError('invalid_state', {
      'message': 'Only running runs can be terminated.',
      'details': {
        'status': params.state.status,
        'phase': params.state.phase,
      },
    });
  }

  if (params.state.phase === 'terminated') {
    throw new CoreError('invalid_state', {
      'message': 'The run is already terminated.',
      'details': {
        'phase': params.state.phase,
      },
    });
  }

  if (!VALID_TERMINATION_STATUSES.has(params.runStatus)) {
    throw new CoreError('invalid_state', {
      'message': 'Invalid termination status.',
      'details': {
        'run_status': params.runStatus,
        'allowed_statuses': [...VALID_TERMINATION_STATUSES],
      },
    });
  }
}

/**
 * Mark the current step state as failed if it is still active or waiting for decision.
 *
 * 如果当前步骤状态仍为 active 或 waiting_decision，则将其标记为 failed。
 */
function buildTerminatedSteps(state: RunState): RunState['steps'] {
  const hasCurrentStep = state.current_step_id !== null && state.current_attempt !== null;
  if (!hasCurrentStep) return state.steps;

  const stepId = state.current_step_id as string;
  const stepState = state.steps[stepId];
  if (stepState === undefined) return state.steps;
  if (stepState.status !== 'active' && stepState.status !== 'waiting_decision') return state.steps;

  return {
    ...state.steps,
    [stepId]: {
      ...stepState,
      'status': 'failed' as const,
    },
  };
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
