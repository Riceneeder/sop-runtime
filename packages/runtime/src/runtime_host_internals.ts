import {
  AcceptedStepResult,
  Decision,
  FinalOutput,
  JsonObject,
  RunState,
  SopDefinition,
  StepResult,
} from '@sop-runtime/definition';
import {
  applyDecision as applyCoreDecision,
  applyStepResult,
  buildStepPacket,
  evaluateExpressionTemplate,
  getCurrentStep,
  CurrentStepView,
  pauseRun,
  renderFinalOutput,
  resumeRun,
  terminateRun,
} from '@sop-runtime/core';
import { Clock } from './clock.js';
import {
  AFTER_STEP_HOOK_RESULT_KEYS,
  AFTER_STEP_RESULT_PATCH_KEYS,
  AfterStepHook,
  BeforeStepHook,
  BEFORE_STEP_HOOK_RESULT_KEYS,
  HookControl,
  assertAllowedHookKeys,
  assertHookResultObject,
  assertJsonSafeObject,
  clonePacketForHook,
  validateHookControl,
} from './hook_pipeline.js';
import { RuntimeError } from './runtime_error.js';
import { StateStore } from './state_store.js';
import { DecisionProvider } from './decision_provider.js';
import { EventSink } from './event_sink.js';
import { executeHandlerWithTimeout, enforceResourceLimits } from './executor_enforcer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HostDeps {
  store: StateStore;
  decisionProvider: DecisionProvider;
  clock: Clock;
  eventSink: EventSink;
  executors: Map<string, Map<string, ExecutorHandler>>;
  beforeStepHooks: BeforeStepHook[];
  afterStepHooks: AfterStepHook[];
}

export interface ExecutorHandlerInput {
  packet: {
    run_id: string;
    step_id: string;
    attempt: number;
    inputs: JsonObject;
    output_schema?: JsonObject;
    executor: {
      kind: string;
      name: string;
      config?: JsonObject;
      timeout_secs: number;
      allow_network: boolean;
      env: Record<string, string>;
      resource_limits: {
        max_output_bytes: number;
        max_artifacts: number;
      };
    };
  };
  definition: SopDefinition;
  state: RunState;
  config: JsonObject;
}

export type ExecutorHandler = (input: ExecutorHandlerInput) => Promise<StepResult> | StepResult;

// ---------------------------------------------------------------------------
// Module-level helpers (moved from runtime_host.ts)
// ---------------------------------------------------------------------------

export function renderPolicyKey(params: {
  template: string;
  state: RunState;
  field: string;
}): string {
  const rendered = evaluateExpressionTemplate({
    'template': params.template,
    'state': params.state,
  });
  if (typeof rendered !== 'string') {
    throw new RuntimeError('runtime_key_render_failed', {
      'message': 'Runtime policy key templates must render to strings.',
      'details': {
        'field': params.field,
        'rendered_type': Array.isArray(rendered) ? 'array' : typeof rendered,
      },
    });
  }

  return rendered;
}

export function getCurrentAcceptedResult(state: RunState): AcceptedStepResult {
  if (state.current_step_id === null) {
    throw new RuntimeError('invalid_runtime_state', {
      'message': 'A decision requires a current step.',
    });
  }

  const acceptedResult = state.accepted_results[state.current_step_id];
  if (acceptedResult === undefined) {
    throw new RuntimeError('invalid_runtime_state', {
      'message': 'A decision requires an accepted step result.',
      'details': {'step_id': state.current_step_id},
    });
  }

  return acceptedResult;
}

export function assertDefinitionMatchesRun(definition: SopDefinition, state: RunState): void {
  if (definition.sop_id === state.sop_id && definition.version === state.sop_version) {
    return;
  }

  throw new RuntimeError('invalid_runtime_state', {
    'message': 'Provided definition does not match the run SOP identity/version.',
    'details': {
      'run_sop_id': state.sop_id,
      'run_sop_version': state.sop_version,
      'definition_sop_id': definition.sop_id,
      'definition_version': definition.version,
    },
  });
}

// ---------------------------------------------------------------------------
// Internal helpers (extracted from RuntimeHost private methods)
// ---------------------------------------------------------------------------

export async function requireRun(store: StateStore, runId: string): Promise<RunState> {
  const state = await store.loadRun(runId);
  if (state === null) {
    throw new RuntimeError('run_not_found', {
      'message': `Run not found: ${runId}`,
      'details': {'run_id': runId},
    });
  }

  return state;
}

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

export async function dispatchExecutor(
  deps: HostDeps,
  packet: ReturnType<typeof buildStepPacket>,
  definition: SopDefinition,
  state: RunState,
): Promise<StepResult> {
  const inner = deps.executors.get(packet.executor.kind);
  const handler = inner?.get(packet.executor.name);
  if (handler === undefined) {
    throw new RuntimeError('executor_not_registered', {
      'message': `No executor registered for ${packet.executor.kind}:${packet.executor.name}.`,
      'details': {
        'kind': packet.executor.kind,
        'name': packet.executor.name,
      },
    });
  }

  const handlerInput: ExecutorHandlerInput = {
    packet: {
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'inputs': packet.inputs,
      'output_schema': packet.output_schema !== undefined ? structuredClone(packet.output_schema) : undefined,
      'executor': packet.executor,
    },
    definition: structuredClone(definition) as SopDefinition,
    state: structuredClone(state) as RunState,
    'config': packet.executor.config ?? {},
  };

  const invocation = await executeHandlerWithTimeout(
    () => handler(handlerInput),
    packet.executor.timeout_secs,
  );

  if (invocation.kind === 'timeout') {
    return {
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'status': 'timeout',
      'error': {
        'code': 'executor_timeout',
        'message': `Executor ${packet.executor.kind}:${packet.executor.name} timed out after ${packet.executor.timeout_secs} seconds.`,
        'details': {
          'timeout_secs': packet.executor.timeout_secs,
        },
      },
    };
  }

  if (invocation.kind === 'error') {
    throw invocation.error;
  }

  return enforceResourceLimits({
    'result': invocation.result,
    'resourceLimits': packet.executor.resource_limits,
    'runId': packet.run_id,
    'stepId': packet.step_id,
    'attempt': packet.attempt,
  });
}

// ---------------------------------------------------------------------------
// Hook runners (extracted from runReadyStep)
// ---------------------------------------------------------------------------

export async function runBeforeStepHooks(
  deps: HostDeps,
  packet: ReturnType<typeof buildStepPacket>,
  definition: SopDefinition,
  state: RunState,
): Promise<{
  currentInputs: JsonObject;
  currentConfig: JsonObject | undefined;
  control: HookControl | null;
}> {
  let control: HookControl | null = null;
  let currentInputs = structuredClone(packet.inputs) as JsonObject;
  let currentConfig = structuredClone(packet.executor.config) as JsonObject | undefined;

  for (let i = 0; i < deps.beforeStepHooks.length; i += 1) {
    const hook = deps.beforeStepHooks[i]!;
    let hookResult;
    try {
      hookResult = hook({
        'packet': clonePacketForHook(packet, currentInputs, currentConfig),
        'definition': structuredClone(definition) as SopDefinition,
        state: structuredClone(state) as RunState,
      });
    } catch (err: unknown) {
      throw new RuntimeError('hook_rejected', {
        'message': 'beforeStep hook threw an error.',
        'details': {
          'stage': 'beforeStep',
          'index': i,
          'error': err instanceof Error ? err.message : String(err),
        },
      });
    }

    if (hookResult === undefined || hookResult === null) {
      continue;
    }

    assertHookResultObject(hookResult, 'beforeStep', i);
    assertAllowedHookKeys(hookResult, BEFORE_STEP_HOOK_RESULT_KEYS, 'beforeStep', i, 'beforeStep hook result');

    if (hookResult.control !== undefined) {
      validateHookControl(hookResult.control, 'beforeStep', i);
      control = hookResult.control as HookControl;
    }
    if (hookResult.inputs !== undefined) {
      assertJsonSafeObject(hookResult.inputs, 'beforeStep', i, 'inputs');
      currentInputs = structuredClone(hookResult.inputs) as JsonObject;
    }
    if (hookResult.config !== undefined) {
      assertJsonSafeObject(hookResult.config, 'beforeStep', i, 'config');
      currentConfig = structuredClone(hookResult.config) as JsonObject;
    }
  }

  return {currentInputs, currentConfig, control};
}

export async function runAfterStepHooks(
  deps: HostDeps,
  packet: ReturnType<typeof buildStepPacket>,
  result: StepResult,
  definition: SopDefinition,
  state: RunState,
): Promise<{
  currentResult: StepResult;
  control: HookControl | null;
}> {
  let control: HookControl | null = null;
  let currentResult: StepResult = result;

  for (let i = 0; i < deps.afterStepHooks.length; i += 1) {
    const hook = deps.afterStepHooks[i]!;
    let clonedResult: StepResult;
    try {
      clonedResult = structuredClone(currentResult) as StepResult;
    } catch (err: unknown) {
      throw new RuntimeError('hook_rejected', {
        'message': 'afterStep hook received a non-structured-cloneable step result.',
        'details': {
          'stage': 'afterStep',
          'index': i,
          'error': err instanceof Error ? err.message : String(err),
        },
      });
    }
    let hookResult;
    try {
      hookResult = hook({
        'packet': clonePacketForHook(packet, packet.inputs, packet.executor.config),
        'result': clonedResult,
        'definition': structuredClone(definition) as SopDefinition,
        state: structuredClone(state) as RunState,
      });
    } catch (err: unknown) {
      throw new RuntimeError('hook_rejected', {
        'message': 'afterStep hook threw an error.',
        'details': {
          'stage': 'afterStep',
          'index': i,
          'error': err instanceof Error ? err.message : String(err),
        },
      });
    }

    if (hookResult === undefined || hookResult === null) {
      continue;
    }

    assertHookResultObject(hookResult, 'afterStep', i);
    assertAllowedHookKeys(hookResult, AFTER_STEP_HOOK_RESULT_KEYS, 'afterStep', i, 'afterStep hook result');

    if (hookResult.control !== undefined) {
      validateHookControl(hookResult.control, 'afterStep', i);
      control = hookResult.control as HookControl;
    }
    if (hookResult.result !== undefined) {
      assertHookResultObject(hookResult.result, 'afterStep', i);
      assertAllowedHookKeys(hookResult.result, AFTER_STEP_RESULT_PATCH_KEYS, 'afterStep', i, 'afterStep result patch');
      currentResult = {...currentResult, ...(hookResult.result as Partial<StepResult>)};
    }
  }

  return {currentResult, control};
}

// ---------------------------------------------------------------------------
// runReadyStep implementation
// ---------------------------------------------------------------------------

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

  const enforcedResult = enforceResourceLimits({
    'result': currentResult,
    'resourceLimits': packet.executor.resource_limits,
    'runId': packet.run_id,
    'stepId': packet.step_id,
    'attempt': packet.attempt,
    'invalidPayloadPolicy': 'preserve',
  });

  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  const nextState = applyStepResult({
    'definition': definition,
    state,
    'stepResult': enforcedResult,
    'now': deps.clock.now(),
  });
  await deps.store.saveRunState(nextState);
  const acceptedResult = nextState.accepted_results[packet.step_id]!;
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

  if (afterControl !== null) {
    const stateBeforeControl = await enforceMaxRunSecs(definition, nextState, deps);
    if (stateBeforeControl.phase === 'terminated') return stateBeforeControl;
    return handleControl(deps, afterControl, definition, stateBeforeControl);
  }

  return nextState;
}

// ---------------------------------------------------------------------------
// Control API implementations
// ---------------------------------------------------------------------------

export async function getRunStateImpl(deps: HostDeps, runId: string): Promise<RunState> {
  return requireRun(deps.store, runId);
}

export async function getCurrentStepImpl(
  deps: HostDeps,
  definition: SopDefinition,
  runId: string,
): Promise<CurrentStepView | null> {
  const state = await requireRun(deps.store, runId);
  assertDefinitionMatchesRun(definition, state);
  return getCurrentStep({'definition': definition, state});
}

export async function decideOutcomeImpl(
  deps: HostDeps,
  definition: SopDefinition,
  runId: string,
  outcomeId: string,
  reason?: string,
  metadata?: JsonObject,
): Promise<RunState> {
  let state = await requireRun(deps.store, runId);
  assertDefinitionMatchesRun(definition, state);
  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  if (state.phase !== 'awaiting_decision') {
    throw new RuntimeError('invalid_runtime_state', {
      'message': 'Decisions can only be applied while the run is awaiting decision.',
      'details': {'phase': state.phase},
    });
  }

  const acceptedResult = getCurrentAcceptedResult(state);
  const decision: Decision = {
    'run_id': state.run_id,
    'step_id': acceptedResult.step_id,
    'attempt': acceptedResult.attempt,
    'outcome_id': outcomeId,
    'reason': reason ?? 'decided by agent',
    'metadata': metadata,
  };

  return applyDecisionAndEmit(deps, definition, state, decision);
}

export async function applyDecisionImpl(
  deps: HostDeps,
  definition: SopDefinition,
  runId: string,
  decisionOverride?: Decision,
): Promise<RunState> {
  let state = await requireRun(deps.store, runId);
  assertDefinitionMatchesRun(definition, state);
  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  if (state.phase !== 'awaiting_decision') {
    throw new RuntimeError('invalid_runtime_state', {
      'message': 'Decisions can only be applied while the run is awaiting decision.',
      'details': {'phase': state.phase},
    });
  }

  const acceptedResult = getCurrentAcceptedResult(state);
  const decision = decisionOverride ?? await deps.decisionProvider.decide({
    'definition': definition,
    state,
    'accepted_result': acceptedResult,
  });
  state = await enforceMaxRunSecs(definition, state, deps);
  if (state.phase === 'terminated') return state;

  return applyDecisionAndEmit(deps, definition, state, decision);
}

async function applyDecisionAndEmit(
  deps: HostDeps,
  definition: SopDefinition,
  state: RunState,
  decision: Decision,
): Promise<RunState> {
  const nextState = applyCoreDecision({
    'definition': definition,
    state,
    decision,
    'now': deps.clock.now(),
  });
  await deps.store.saveRunState(nextState);
  await deps.eventSink.emit({
    kind: 'decision_applied',
    'run_id': nextState.run_id,
    at: deps.clock.now(),
    details: {
      'step_id': decision.step_id,
      'attempt': decision.attempt,
      'outcome_id': decision.outcome_id,
    },
  });
  if (nextState.phase === 'terminated') {
    await deps.eventSink.emit({
      kind: 'run_terminated',
      'run_id': nextState.run_id,
      at: deps.clock.now(),
      details: {
        'run_status': nextState.terminal?.run_status ?? nextState.status,
        'reason': nextState.terminal?.reason ?? 'terminated',
      },
    });
  }

  return nextState;
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
