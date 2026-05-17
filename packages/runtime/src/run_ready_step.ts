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
import { requireRunSnapshot, assertDefinitionMatchesRun } from './runtime_host_state.js';
import { enforceMaxRunSecs } from './runtime_host_deadline.js';
import { handleControl } from './runtime_host_control.js';
import { dispatchExecutor } from './executor_dispatch.js';
import { runBeforeStepHooks, runAfterStepHooks } from './hook_runners.js';
import { enforceResourceLimits } from './executor_enforcer.js';

/**
 * Orchestrate the execution of a ready step: build packet, run hooks, dispatch executor, apply result.
 *
 * 编排就绪步骤的执行：构建数据包、运行钩子、分发执行器、应用结果。
 *
 * @param deps - The host dependencies.
 * @param definition - The SOP definition.
 * @param runId - The run identifier.
 * @returns The updated run state after step execution.
 * @public
 */
export async function runReadyStepImpl(
  deps: HostDeps,
  definition: SopDefinition,
  runId: string,
): Promise<RunState> {
  let { state, revision } = await requireRunSnapshot(deps.store, runId);
  assertDefinitionMatchesRun(definition, state);
  state = await enforceMaxRunSecs(definition, state, deps, revision);
  if (state.phase === 'terminated') return state;

  const packet = buildStepPacket({ 'definition': definition, state });
  await emitPacketBuilt(deps, state, packet);

  const { currentInputs, currentConfig, control: beforeControl } =
    await runBeforeStepHooks(deps, packet, definition, state);

  state = await enforceMaxRunSecs(definition, state, deps, revision);
  if (state.phase === 'terminated') return state;

  packet.inputs = currentInputs;
  if (currentConfig !== undefined) {
    (packet.executor as { config?: JsonObject }).config = currentConfig;
  }

  if (beforeControl !== null) {
    return handleControl(deps, beforeControl, definition, state, revision);
  }

  const result = await dispatchExecutor(deps, packet, definition, state);
  state = await enforceMaxRunSecs(definition, state, deps, revision);
  if (state.phase === 'terminated') return state;

  return handleAfterStepHookResult(deps, definition, packet, result, state, revision);
}

async function handleAfterStepHookResult(
  deps: HostDeps,
  definition: SopDefinition,
  packet: ReturnType<typeof buildStepPacket>,
  result: StepResult,
  state: RunState,
  expected_revision?: string,
): Promise<RunState> {
  const { currentResult, control: afterControl } =
    await runAfterStepHooks(deps, packet, result, definition, state);

  let nextState = await enforceMaxRunSecs(definition, state, deps, expected_revision);
  if (nextState.phase === 'terminated') return nextState;

  const enforcedResult = enforceLimitsPreserve(currentResult, packet);

  nextState = await enforceMaxRunSecs(definition, nextState, deps, expected_revision);
  if (nextState.phase === 'terminated') return nextState;

  nextState = await applyResultAndEmit({
    deps, definition, state: nextState, enforcedResult, 'stepId': packet.step_id, expected_revision,
  });

  if (afterControl !== null) {
    const stateBeforeControl = await enforceMaxRunSecs(definition, nextState, deps, expected_revision);
    if (stateBeforeControl.phase === 'terminated') return stateBeforeControl;
    return handleControl(deps, afterControl, definition, stateBeforeControl, expected_revision);
  }

  return nextState;
}

async function emitPacketBuilt(
  deps: HostDeps,
  state: RunState,
  packet: ReturnType<typeof buildStepPacket>,
): Promise<void> {
  await deps.eventSink.emit({
    kind: 'step_packet_built',
    'run_id': state.run_id,
    at: deps.clock.now(),
    details: { 'step_id': packet.step_id, 'attempt': packet.attempt },
  });
}

async function applyResultAndEmit(params: {
  deps: HostDeps;
  definition: SopDefinition;
  state: RunState;
  enforcedResult: StepResult;
  stepId: string;
  expected_revision?: string;
}): Promise<RunState> {
  const { deps, definition, state, enforcedResult, stepId, expected_revision } = params;
  const nextState = applyStepResult({
    'definition': definition,
    state,
    'stepResult': enforcedResult,
    'now': deps.clock.now(),
  });
  await deps.store.saveRunState(nextState, { 'expected_revision': expected_revision });
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
