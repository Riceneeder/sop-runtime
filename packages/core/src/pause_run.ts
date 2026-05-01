import {RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {assertDefinitionMatchesRun} from './get_current_step.js';

export function pauseRun(params: {
  definition: SopDefinition;
  state: RunState;
  reason: string;
  now?: string;
}): RunState {
  assertDefinitionMatchesRun(params);

  if (params.state.status !== 'running') {
    throw new CoreError('invalid_state', {
      'message': 'Only running runs can be paused.',
      'details': {
        'status': params.state.status,
        'phase': params.state.phase,
      },
    });
  }

  if (params.state.phase !== 'ready' && params.state.phase !== 'awaiting_decision') {
    throw new CoreError('invalid_state', {
      'message': 'A run can only be paused while ready or awaiting decision.',
      'details': {
        'phase': params.state.phase,
      },
    });
  }

  return {
    ...params.state,
    'phase': 'paused',
    'pause': {
      'previous_phase': params.state.phase,
      'reason': params.reason,
      'paused_at': params.now ?? new Date().toISOString(),
    },
    'history': [
      ...params.state.history,
      buildRunPausedHistory({
        'reason': params.reason,
        'now': params.now,
      }),
    ],
    'updated_at': params.now ?? params.state.updated_at,
  };
}

function buildRunPausedHistory(params: {
  reason: string;
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'run_paused',
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
