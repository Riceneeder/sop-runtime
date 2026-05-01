import {RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';

const VALID_TERMINATION_STATUSES = new Set(['cancelled', 'failed']);

export function terminateRun(params: {
  definition: SopDefinition;
  state: RunState;
  runStatus: 'cancelled' | 'failed';
  reason: string;
  now?: string;
}): RunState {
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

  const isPaused = params.state.phase === 'paused';
  const hasCurrentStep = params.state.current_step_id !== null && params.state.current_attempt !== null;

  let steps = params.state.steps;
  if (!isPaused && hasCurrentStep) {
    const stepId = params.state.current_step_id as string;
    const stepState = steps[stepId];
    if (stepState !== undefined && (stepState.status === 'active' || stepState.status === 'waiting_decision')) {
      steps = {
        ...steps,
        [stepId]: {
          ...stepState,
          'status': 'failed',
        },
      };
    }
  }

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
