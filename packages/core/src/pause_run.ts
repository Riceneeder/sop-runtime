import {RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {assertDefinitionMatchesRun} from './get_current_step.js';

/**
 * Pause a running run, preserving its current phase for later resumption.
 *
 * 暂停正在运行的运行，保留当前阶段以便后续恢复。
 *
 * @param params - Object containing the definition, state, reason, and optional timestamp.
 * @param params.definition - The SOP definition.
 * @param params.state - The current run state (must be in ready or awaiting_decision phase).
 * @param params.reason - Human-readable pause reason.
 * @param params.now - Optional timestamp for history entries.
 * @returns The paused run state.
 * @throws {CoreError} If the run cannot be paused.
 * @public
 */
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

/**
 * Build a history entry recording that the run was paused.
 *
 * 构建记录运行已暂停的历史条目。
 */
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
