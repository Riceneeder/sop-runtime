import {RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {assertDefinitionMatchesRun} from './get_current_step.js';

/**
 * Resume a paused run, restoring its previous phase (ready or awaiting_decision).
 *
 * 恢复已暂停的运行，还原其之前的阶段（ready 或 awaiting_decision）。
 *
 * @param params - Object containing the definition, state, and optional timestamp.
 * @param params.definition - The SOP definition.
 * @param params.state - The current run state (must be paused).
 * @param params.now - Optional timestamp for history entries.
 * @returns The resumed run state.
 * @throws {CoreError} If the run cannot be resumed.
 * @public
 */
export function resumeRun(params: {
  definition: SopDefinition;
  state: RunState;
  now?: string;
}): RunState {
  assertDefinitionMatchesRun(params);
  assertResumable(params.state);

  const previousPhase = params.state.pause!.previous_phase;

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

/**
 * Assert that the run is in a resumable state (running, paused, with pause metadata).
 *
 * 断言运行处于可恢复状态（running、paused、带有 pause 元数据）。
 */
function assertResumable(state: RunState): void {
  if (state.status !== 'running') {
    throw new CoreError('invalid_state', {
      'message': 'Only running runs can be resumed.',
      'details': {'status': state.status, 'phase': state.phase},
    });
  }
  if (state.phase !== 'paused') {
    throw new CoreError('invalid_state', {
      'message': 'Only paused runs can be resumed.',
      'details': {'phase': state.phase},
    });
  }
  if (state.pause === undefined) {
    throw new CoreError('invalid_state', {
      'message': 'Paused run is missing pause metadata.',
      'details': {'phase': state.phase},
    });
  }
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
