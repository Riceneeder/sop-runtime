import {RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {assertDefinitionMatchesRun} from './get_current_step.js';

export function resumeRun(params: {
  definition: SopDefinition;
  state: RunState;
  now?: string;
}): RunState {
  assertDefinitionMatchesRun(params);

  if (params.state.status !== 'running') {
    throw new CoreError('invalid_state', {
      'message': 'Only running runs can be resumed.',
      'details': {
        'status': params.state.status,
        'phase': params.state.phase,
      },
    });
  }

  if (params.state.phase !== 'paused') {
    throw new CoreError('invalid_state', {
      'message': 'Only paused runs can be resumed.',
      'details': {
        'phase': params.state.phase,
      },
    });
  }

  if (params.state.pause === undefined) {
    throw new CoreError('invalid_state', {
      'message': 'Paused run is missing pause metadata.',
      'details': {
        'phase': params.state.phase,
      },
    });
  }

  const previousPhase = params.state.pause.previous_phase;

  return {
    ...params.state,
    'phase': previousPhase,
    'pause': undefined,
    'history': [
      ...params.state.history,
      buildRunResumedHistory({
        previousPhase,
        'now': params.now,
      }),
    ],
    'updated_at': params.now ?? params.state.updated_at,
  };
}

function buildRunResumedHistory(params: {
  previousPhase: 'ready' | 'awaiting_decision';
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'run_resumed',
    'previous_phase': params.previousPhase,
  };

  if (params.now !== undefined) {
    return {
      ...entry,
      'at': params.now,
    };
  }

  return entry;
}
