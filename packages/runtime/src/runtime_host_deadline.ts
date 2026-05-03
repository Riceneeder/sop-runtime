import {
  FinalOutput,
  RunState,
  SopDefinition,
} from '@sop-runtime/definition';
import {
  renderFinalOutput,
  terminateRun,
} from '@sop-runtime/core';
import { HostDeps } from './runtime_host_types.js';

/**
 * Check if the run has exceeded max_run_secs and terminate it if so.
 *
 * 检查运行是否超过 max_run_secs，若超时则终止运行。
 *
 * @param definition - The SOP definition with max_run_secs policy.
 * @param state - The current run state.
 * @param deps - The host dependencies for persistence and events.
 * @returns The run state (terminated if exceeded, unchanged otherwise).
 * @public
 */
export async function enforceMaxRunSecs(
  definition: SopDefinition,
  state: RunState,
  deps: HostDeps,
): Promise<RunState> {
  if (state.phase === 'terminated') {
    return state;
  }

  const startedAt = state.created_at;
  if (startedAt === undefined) {
    return state;
  }

  const startedMs = Date.parse(startedAt);
  const now = deps.clock.now();
  const nowMs = Date.parse(now);
  if (!Number.isFinite(startedMs) || !Number.isFinite(nowMs)) {
    return state;
  }

  if (nowMs - startedMs <= definition.policies.max_run_secs * 1000) {
    return state;
  }

  const terminated = terminateRun({
    'definition': definition,
    'state': state,
    'runStatus': 'failed',
    'reason': 'max_run_secs_exceeded',
    'now': now,
  });
  await deps.store.saveRunState(terminated);
  await deps.eventSink.emit({
    kind: 'run_terminated',
    'run_id': terminated.run_id,
    at: now,
    details: {
      'run_status': terminated.terminal?.run_status ?? terminated.status,
      'reason': terminated.terminal?.reason ?? 'terminated',
    },
  });
  return terminated;
}

/**
 * Build the completed result for a succeeded run, rendering the final output.
 *
 * 构建成功运行的完成结果，渲染最终输出。
 *
 * @param definition - The SOP definition with final_output template.
 * @param state - The terminated run state.
 * @returns An object with the state and optional final_output.
 * @public
 */
export function buildCompletedResult(definition: SopDefinition, state: RunState): {
  state: RunState;
  final_output?: FinalOutput;
} {
  if (state.status !== 'succeeded') {
    return {state};
  }

  return {
    state,
    'final_output': renderFinalOutput({definition, state}),
  };
}
