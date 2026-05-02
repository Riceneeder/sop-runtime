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
