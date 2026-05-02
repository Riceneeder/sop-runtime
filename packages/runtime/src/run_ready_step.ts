import {
  JsonObject,
  RunState,
  SopDefinition,
  StepResult,
} from '@sop-runtime/definition';
import {
  applyStepResult,
  buildStepPacket,
} from '@sop-runtime/core';
import { HostDeps } from './runtime_host_types.js';
import { requireRun, assertDefinitionMatchesRun } from './runtime_host_state.js';
import { enforceMaxRunSecs } from './runtime_host_deadline.js';
import { handleControl } from './runtime_host_control.js';
import { dispatchExecutor } from './executor_dispatch.js';
import { runBeforeStepHooks, runAfterStepHooks } from './hook_runners.js';
import { enforceResourceLimits } from './executor_enforcer.js';

interface ApplyResultParams {
  deps: HostDeps;
  definition: SopDefinition;
  state: RunState;
  enforcedResult: StepResult;
  stepId: string;
}

async function applyResultAndEmit(params: ApplyResultParams): Promise<RunState> {
  const { deps, definition, state, enforcedResult, stepId } = params;
  const nextState = applyStepResult({
    'definition': definition,
    state,
    'stepResult': enforcedResult,
    'now': deps.clock.now(),
  });
  await deps.store.saveRunState(nextState);
  const acceptedResult = nextState.accepted_results[stepId]!;
  await deps.eventSink.emit({
    kind: 'step_result_accepted',
    'run_id': nextState.run_id,
    at: deps.clock.now(),
    details: {
      'step_id': acceptedResult.step_id,
      'attempt': acceptedResult.attempt,
      'status': acceptedResult.status,
    },
  });
  return nextState;
}

function enforceLimitsPreserve(
  result: StepResult,
  packet: ReturnType<typeof buildStepPacket>,
): StepResult {
  return enforceResourceLimits({
    'result': result,
    'resourceLimits': packet.executor.resource_limits,
    'runId': packet.run_id,
    'stepId': packet.step_id,
    'attempt': packet.attempt,
    'invalidPayloadPolicy': 'preserve',
  });
}

export async function runReadyStepImpl(
  deps: HostDeps,
  definition: SopDefinition,
  runId: string,
): Promise<RunState> {
  let state = await requireRun(deps.store, runId);
  assertDefinitionMatchesRun(definition, state);
  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  const packet = buildStepPacket({'definition': definition, state});
  await deps.eventSink.emit({
    kind: 'step_packet_built',
    'run_id': state.run_id,
    at: deps.clock.now(),
    details: {'step_id': packet.step_id, 'attempt': packet.attempt},
  });

  const {currentInputs, currentConfig, control: beforeControl} =
    await runBeforeStepHooks(deps, packet, definition, state);

  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  packet.inputs = currentInputs;
  if (currentConfig !== undefined) {
    (packet.executor as {config?: JsonObject}).config = currentConfig;
  }

  if (beforeControl !== null) {
    return handleControl(deps, beforeControl, definition, state);
  }

  const result = await dispatchExecutor(deps, packet, definition, state);
  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  const {currentResult, control: afterControl} =
    await runAfterStepHooks(deps, packet, result, definition, state);

  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  const enforcedResult = enforceLimitsPreserve(currentResult, packet);

  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  const nextState = await applyResultAndEmit({
    deps, definition, state, enforcedResult,
    'stepId': packet.step_id,
  });

  if (afterControl !== null) {
    const stateBeforeControl = await enforceMaxRunSecs(definition, nextState, deps);
    if (stateBeforeControl.phase === 'terminated') return stateBeforeControl;
    return handleControl(deps, afterControl, definition, stateBeforeControl);
  }

  return nextState;
}
