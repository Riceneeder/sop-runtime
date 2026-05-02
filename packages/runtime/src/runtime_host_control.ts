import {
  RunState,
  SopDefinition,
} from '@sop-runtime/definition';
import {
  pauseRun,
  resumeRun,
  terminateRun,
} from '@sop-runtime/core';
import { HostDeps } from './runtime_host_types.js';
import { requireRun, assertDefinitionMatchesRun } from './runtime_host_state.js';
import { enforceMaxRunSecs } from './runtime_host_deadline.js';
import { HookControl } from './hook_pipeline.js';

export async function handleControl(
  deps: HostDeps,
  control: HookControl,
  definition: SopDefinition,
  state: RunState,
): Promise<RunState> {
  if (control.action === 'pause') {
    const paused = pauseRun({
      'definition': definition,
      'state': state,
      'reason': control.reason,
      'now': deps.clock.now(),
    });
    await deps.store.saveRunState(paused);
    await deps.eventSink.emit({
      kind: 'run_paused',
      'run_id': paused.run_id,
      at: deps.clock.now(),
      details: {'reason': control.reason},
    });
    return paused;
  }

  const terminated = terminateRun({
    'definition': definition,
    'state': state,
    'runStatus': control.runStatus,
    'reason': control.reason,
    'now': deps.clock.now(),
  });
  await deps.store.saveRunState(terminated);
  await deps.eventSink.emit({
    kind: 'run_terminated',
    'run_id': terminated.run_id,
    at: deps.clock.now(),
    details: {
      'run_status': terminated.terminal?.run_status ?? terminated.status,
      'reason': terminated.terminal?.reason ?? 'terminated',
    },
  });
  return terminated;
}

export async function pauseRunImpl(
  deps: HostDeps,
  definition: SopDefinition,
  runId: string,
  reason: string,
): Promise<RunState> {
  let state = await requireRun(deps.store, runId);
  assertDefinitionMatchesRun(definition, state);
  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  const paused = pauseRun({
    'definition': definition,
    state,
    'reason': reason,
    'now': deps.clock.now(),
  });
  await deps.store.saveRunState(paused);
  await deps.eventSink.emit({
    kind: 'run_paused',
    'run_id': paused.run_id,
    at: deps.clock.now(),
    details: {'reason': reason},
  });

  return paused;
}

export async function resumeRunImpl(
  deps: HostDeps,
  definition: SopDefinition,
  runId: string,
): Promise<RunState> {
  let state = await requireRun(deps.store, runId);
  assertDefinitionMatchesRun(definition, state);
  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  const resumed = resumeRun({
    'definition': definition,
    state,
    'now': deps.clock.now(),
  });
  await deps.store.saveRunState(resumed);
  await deps.eventSink.emit({
    kind: 'run_resumed',
    'run_id': resumed.run_id,
    at: deps.clock.now(),
    details: {'previous_phase': state.pause?.previous_phase ?? null},
  });

  return resumed;
}

export async function terminateRunImpl(
  deps: HostDeps,
  definition: SopDefinition,
  runId: string,
  runStatus: 'cancelled' | 'failed',
  reason: string,
): Promise<RunState> {
  let state = await requireRun(deps.store, runId);
  assertDefinitionMatchesRun(definition, state);
  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  const terminated = terminateRun({
    'definition': definition,
    'state': state,
    'runStatus': runStatus,
    'reason': reason,
    'now': deps.clock.now(),
  });
  await deps.store.saveRunState(terminated);
  await deps.eventSink.emit({
    kind: 'run_terminated',
    'run_id': terminated.run_id,
    at: deps.clock.now(),
    details: {
      'run_status': terminated.terminal?.run_status ?? terminated.status,
      'reason': terminated.terminal?.reason ?? 'terminated',
    },
  });

  return terminated;
}
