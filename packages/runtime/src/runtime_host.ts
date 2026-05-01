import {
  AcceptedStepResult,
  Decision,
  FinalOutput,
  JsonObject,
  RunState,
  SopDefinition,
} from '@sop-runtime/definition';
import {
  applyDecision as applyCoreDecision,
  applyStepResult,
  buildStepPacket,
  createRun,
  evaluateExpressionTemplate,
  getCurrentStep,
  CurrentStepView,
  pauseRun,
  renderFinalOutput,
  resumeRun,
  terminateRun,
} from '@sop-runtime/core';
import {Clock, SystemClock} from './clock.js';
import {DecisionProvider, DefaultDecisionProvider} from './decision_provider.js';
import {EventSink, NoopEventSink} from './event_sink.js';
import {IdGenerator, RandomIdGenerator} from './id_generator.js';
import {NoopRuntimeLogger, RuntimeLogger} from './logger.js';
import {RuntimeError} from './runtime_error.js';
import {RunRecord, RunStartClaimReason, StateStore} from './state_store.js';
import {StepResult} from '@sop-runtime/definition';

export type StartRunReason = RunStartClaimReason;

/** Handler signature for a registered executor. Input contains the rendered packet plus the resolved config. */
export interface ExecutorHandlerInput {
  packet: {
    run_id: string;
    step_id: string;
    attempt: number;
    inputs: JsonObject;
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

/** A registered executor handler must return a StepResult. State transitions are only allowed through core applyStepResult. */
export type ExecutorHandler = (input: ExecutorHandlerInput) => Promise<StepResult> | StepResult;

/** Hook control signalling that the hook wants to pause or terminate the run. */
export type HookControl =
  | { action: 'pause'; reason: string }
  | { action: 'terminate'; runStatus: 'failed' | 'cancelled'; reason: string };

/** BeforeStep hooks receive the built packet and may rewrite inputs or config, or request a control action. */
export interface BeforeStepHookInput {
  packet: {
    run_id: string;
    step_id: string;
    attempt: number;
    inputs: JsonObject;
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
}

export type BeforeStepHook = (
  input: BeforeStepHookInput,
) => void | { inputs?: JsonObject; config?: JsonObject; control?: HookControl };

/** AfterStep hooks receive the executor result and may rewrite result fields, or request a control action. */
export interface AfterStepHookInput {
  packet: {
    run_id: string;
    step_id: string;
    attempt: number;
    inputs: JsonObject;
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
  result: StepResult;
  definition: SopDefinition;
  state: RunState;
}

export type AfterStepHook = (
  input: AfterStepHookInput,
) => void | { result?: Partial<Pick<StepResult, 'status' | 'output' | 'artifacts' | 'error' | 'metrics'>>; control?: HookControl };

/** Starts or reuses a run for one validated SOP definition and input payload. */
export interface StartRunParams {
  definition: SopDefinition;
  input: JsonObject;
  runId?: string;
}

/** State, record, and policy reason returned by startRun. */
export interface StartRunResult {
  state: RunState;
  reason: StartRunReason;
  record: RunRecord;
}

/** Drives a persisted run until termination or until the guard limit is reached. */
export interface RunUntilCompleteParams {
  definition: SopDefinition;
  runId: string;
  maxRuntimeSteps?: number;
}

export interface RunUntilCompleteResult {
  state: RunState;
  final_output?: FinalOutput;
}

/** Ports required by RuntimeHost plus optional defaults for local embedding. */
export interface RuntimeHostOptions {
  store: StateStore;
  decisionProvider?: DecisionProvider;
  clock?: Clock;
  idGenerator?: IdGenerator;
  logger?: RuntimeLogger;
  eventSink?: EventSink;
  hooks?: {
    beforeStep?: BeforeStepHook[];
    afterStep?: AfterStepHook[];
  };
}

/**
 * Embeddable orchestrator that connects the pure core engine to runtime ports.
 *
 * RuntimeHost owns orchestration policy checks such as idempotency, concurrency,
 * cooldown, max_run_secs, event emission, and final-output rendering. It does not
 * implement distributed step leases; callers should avoid driving the same run
 * concurrently unless their StateStore/adapter adds that coordination.
 */
export class RuntimeHost {
  private readonly store: StateStore;
  private readonly decisionProvider: DecisionProvider;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly logger: RuntimeLogger;
  private readonly eventSink: EventSink;
  private readonly executors = new Map<string, ExecutorHandler>();
  private readonly beforeStepHooks: BeforeStepHook[];
  private readonly afterStepHooks: AfterStepHook[];

  constructor(options: RuntimeHostOptions) {
    this.store = options.store;
    this.decisionProvider = options.decisionProvider ?? new DefaultDecisionProvider();
    this.clock = options.clock ?? new SystemClock();
    this.idGenerator = options.idGenerator ?? new RandomIdGenerator();
    this.logger = options.logger ?? new NoopRuntimeLogger();
    this.eventSink = options.eventSink ?? new NoopEventSink();
    this.beforeStepHooks = options.hooks?.beforeStep ?? [];
    this.afterStepHooks = options.hooks?.afterStep ?? [];
  }

  /** Registers an executor handler for a given kind + name pair. */
  registerExecutor(kind: string, name: string, handler: ExecutorHandler): void {
    this.executors.set(`${kind}:${name}`, handler);
  }

  async startRun(params: StartRunParams): Promise<StartRunResult> {
    const now = this.clock.now();
    const runId = params.runId ?? this.idGenerator.newRunId();
    const state = createRun({
      'definition': params.definition,
      'input': params.input,
      runId,
      now,
    });
    const idempotencyKey = renderPolicyKey({
      'template': params.definition.policies.idempotency_key_template,
      state,
      'field': 'policies.idempotency_key_template',
    });
    const concurrencyKey = renderPolicyKey({
      'template': params.definition.policies.concurrency.key_template,
      state,
      'field': 'policies.concurrency.key_template',
    });
    const record: RunRecord = {
      'run_id': state.run_id,
      'sop_id': state.sop_id,
      'sop_version': state.sop_version,
      'idempotency_key': idempotencyKey,
      'concurrency_key': concurrencyKey,
      'created_at': now,
      'updated_at': now,
    };
    const claim = await this.store.claimRunStart({
      state,
      record,
      'concurrency_mode': params.definition.policies.concurrency.mode,
      'cooldown_secs': params.definition.policies.cooldown_secs,
      now,
    });

    if (claim.reason === 'created') {
      this.logger.info('run started', {'run_id': claim.state.run_id});
      await this.emit('run_started', claim.state.run_id, now, {'reason': 'created'});
    } else {
      this.logger.info('run reused', {'run_id': claim.state.run_id, 'reason': claim.reason});
      await this.emit('run_reused', claim.state.run_id, now, {'reason': claim.reason});
    }

    return {
      'state': claim.state,
      'reason': claim.reason,
      'record': claim.record,
    };
  }

  async runReadyStep(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<RunState> {
    let state = await this.requireRun(params.runId);
    assertDefinitionMatchesRun(params.definition, state);
    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    const packet = buildStepPacket({
      'definition': params.definition,
      state,
    });
    await this.emit('step_packet_built', state.run_id, this.clock.now(), {
      'step_id': packet.step_id,
      'attempt': packet.attempt,
    });

    let beforeControl: HookControl | null = null;
    let currentInputs = structuredClone(packet.inputs) as JsonObject;
    let currentConfig = structuredClone(packet.executor.config) as JsonObject | undefined;

    for (let i = 0; i < this.beforeStepHooks.length; i += 1) {
      const hook = this.beforeStepHooks[i]!;
      let hookResult;
      try {
        hookResult = hook({
          'packet': clonePacketForHook(packet, currentInputs, currentConfig),
          'definition': structuredClone(params.definition) as SopDefinition,
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
        beforeControl = hookResult.control as HookControl;
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

    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    packet.inputs = currentInputs;
    if (currentConfig !== undefined) {
      (packet.executor as { config?: JsonObject }).config = currentConfig;
    }

    if (beforeControl !== null) {
      return this.handleBeforeStepControl(beforeControl, params.definition, state);
    }

    const result = await this.dispatchExecutor(packet, params.definition, state);
    // External execution can cross the run deadline; do not persist stale results.
    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    // --- afterStep hooks ---
    let afterControl: HookControl | null = null;
    let currentResult: StepResult = structuredClone(result) as StepResult;

    for (let i = 0; i < this.afterStepHooks.length; i += 1) {
      const hook = this.afterStepHooks[i]!;
      let hookResult;
      try {
        hookResult = hook({
          'packet': clonePacketForHook(packet, packet.inputs, packet.executor.config),
          'result': structuredClone(currentResult) as StepResult,
          'definition': structuredClone(params.definition) as SopDefinition,
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
        afterControl = hookResult.control as HookControl;
      }
      if (hookResult.result !== undefined) {
        assertHookResultObject(hookResult.result, 'afterStep', i);
        assertAllowedHookKeys(hookResult.result, AFTER_STEP_RESULT_PATCH_KEYS, 'afterStep', i, 'afterStep result patch');
        currentResult = {...currentResult, ...(hookResult.result as Partial<StepResult>)};
      }
    }

    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    const nextState = applyStepResult({
      'definition': params.definition,
      state,
      'stepResult': currentResult,
      'now': this.clock.now(),
    });
    await this.saveState(nextState);
    const acceptedResult = nextState.accepted_results[currentResult.step_id]!;
    await this.emit('step_result_accepted', nextState.run_id, this.clock.now(), {
      'step_id': acceptedResult.step_id,
      'attempt': acceptedResult.attempt,
      'status': acceptedResult.status,
    });

    if (afterControl !== null) {
      const stateBeforeControl = await this.enforceMaxRunSecs(params.definition, nextState);
      if (stateBeforeControl.phase === 'terminated') {
        return stateBeforeControl;
      }
      return this.handleAfterStepControl(afterControl, params.definition, stateBeforeControl);
    }

    return nextState;
  }

  /** Returns a run state snapshot from the store. */
  async getRunState(params: { runId: string }): Promise<RunState> {
    return this.requireRun(params.runId);
  }

  /** Returns the current step view, or null if the run is terminated. */
  getCurrentStep(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<CurrentStepView | null> {
    return this.requireRun(params.runId).then((state) => {
      assertDefinitionMatchesRun(params.definition, state);
      return getCurrentStep({ 'definition': params.definition, state });
    });
  }

  /** Builds and applies a decision from the current accepted result. */
  async decideOutcome(params: {
    definition: SopDefinition;
    runId: string;
    outcomeId: string;
    reason?: string;
    metadata?: JsonObject;
  }): Promise<RunState> {
    let state = await this.requireRun(params.runId);
    assertDefinitionMatchesRun(params.definition, state);
    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    const acceptedResult = getCurrentAcceptedResult(state);
    const decision: Decision = {
      'run_id': state.run_id,
      'step_id': acceptedResult.step_id,
      'attempt': acceptedResult.attempt,
      'outcome_id': params.outcomeId,
      'reason': params.reason ?? 'decided by agent',
      'metadata': params.metadata,
    };

    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    const nextState = applyCoreDecision({
      'definition': params.definition,
      state,
      decision,
      'now': this.clock.now(),
    });
    await this.saveState(nextState);
    await this.emit('decision_applied', nextState.run_id, this.clock.now(), {
      'step_id': decision.step_id,
      'attempt': decision.attempt,
      'outcome_id': decision.outcome_id,
    });
    if (nextState.phase === 'terminated') {
      await this.emitRunTerminated(nextState, this.clock.now());
    }

    return nextState;
  }

  async applyDecision(params: {
    definition: SopDefinition;
    runId: string;
    decision?: Decision;
  }): Promise<RunState> {
    let state = await this.requireRun(params.runId);
    assertDefinitionMatchesRun(params.definition, state);
    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    const acceptedResult = getCurrentAcceptedResult(state);
    const decision = params.decision ?? await this.decisionProvider.decide({
      'definition': params.definition,
      state,
      'accepted_result': acceptedResult,
    });
    // Decision providers can also cross the deadline before returning.
    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    const nextState = applyCoreDecision({
      'definition': params.definition,
      state,
      decision,
      'now': this.clock.now(),
    });
    await this.saveState(nextState);
    await this.emit('decision_applied', nextState.run_id, this.clock.now(), {
      'step_id': decision.step_id,
      'attempt': decision.attempt,
      'outcome_id': decision.outcome_id,
    });
    if (nextState.phase === 'terminated') {
      await this.emitRunTerminated(nextState, this.clock.now());
    }

    return nextState;
  }

  async pauseRun(params: {
    definition: SopDefinition;
    runId: string;
    reason: string;
  }): Promise<RunState> {
    const state = await this.requireRun(params.runId);
    assertDefinitionMatchesRun(params.definition, state);

    const paused = pauseRun({
      'definition': params.definition,
      'state': state,
      'reason': params.reason,
      'now': this.clock.now(),
    });
    await this.saveState(paused);
    await this.emit('run_paused', paused.run_id, this.clock.now(), {
      'reason': params.reason,
    });

    return paused;
  }

  async resumeRun(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<RunState> {
    const state = await this.requireRun(params.runId);
    assertDefinitionMatchesRun(params.definition, state);

    const resumed = resumeRun({
      'definition': params.definition,
      'state': state,
      'now': this.clock.now(),
    });
    await this.saveState(resumed);
    await this.emit('run_resumed', resumed.run_id, this.clock.now(), {
      'previous_phase': state.pause?.previous_phase ?? null,
    });

    return resumed;
  }

  async terminateRun(params: {
    definition: SopDefinition;
    runId: string;
    runStatus: 'cancelled' | 'failed';
    reason: string;
  }): Promise<RunState> {
    const state = await this.requireRun(params.runId);
    assertDefinitionMatchesRun(params.definition, state);

    const terminated = terminateRun({
      'definition': params.definition,
      'state': state,
      'runStatus': params.runStatus,
      'reason': params.reason,
      'now': this.clock.now(),
    });
    await this.saveState(terminated);
    await this.emitRunTerminated(terminated, this.clock.now());

    return terminated;
  }

  async runUntilComplete(params: RunUntilCompleteParams): Promise<RunUntilCompleteResult> {
    const maxRuntimeSteps = params.maxRuntimeSteps ?? 100;
    let state = await this.requireRun(params.runId);
    assertDefinitionMatchesRun(params.definition, state);

    for (let step = 0; step < maxRuntimeSteps; step += 1) {
      state = await this.enforceMaxRunSecs(params.definition, state);
      if (state.phase === 'terminated') {
        return this.buildCompletedResult(params.definition, state);
      }

      if (state.phase === 'paused') {
        return {state};
      }

      if (state.phase === 'ready') {
        state = await this.runReadyStep({
          'definition': params.definition,
          'runId': state.run_id,
        });
        continue;
      }

      if (state.phase === 'awaiting_decision') {
        state = await this.applyDecision({
          'definition': params.definition,
          'runId': state.run_id,
        });
        continue;
      }

      throw new RuntimeError('invalid_runtime_state', {
        'message': 'Run phase is not supported by RuntimeHost.',
        'details': {'phase': state.phase},
      });
    }

    throw new RuntimeError('runtime_step_limit_exceeded', {
      'message': 'Runtime step guard exceeded before run termination.',
      'details': {
        'run_id': params.runId,
        'max_runtime_steps': maxRuntimeSteps,
      },
    });
  }

  private async dispatchExecutor(
    packet: ReturnType<typeof buildStepPacket>,
    definition: SopDefinition,
    state: RunState,
  ): Promise<StepResult> {
    const key = `${packet.executor.kind}:${packet.executor.name}`;
    const handler = this.executors.get(key);
    if (handler === undefined) {
      throw new RuntimeError('executor_not_registered', {
        'message': `No executor registered for ${key}.`,
        'details': {
          'kind': packet.executor.kind,
          'name': packet.executor.name,
        },
      });
    }

    return handler({
      packet: {
        'run_id': packet.run_id,
        'step_id': packet.step_id,
        'attempt': packet.attempt,
        'inputs': packet.inputs,
        'executor': packet.executor,
      },
      definition,
      state,
      'config': packet.executor.config ?? {},
    });
  }

  private async requireRun(runId: string): Promise<RunState> {
    const state = await this.store.loadRun(runId);
    if (state === null) {
      throw new RuntimeError('run_not_found', {
        'message': `Run not found: ${runId}`,
        'details': {'run_id': runId},
      });
    }

    return state;
  }

  private async saveState(state: RunState): Promise<void> {
    await this.store.saveRunState(state);
  }

  private async enforceMaxRunSecs(definition: SopDefinition, state: RunState): Promise<RunState> {
    if (state.phase === 'terminated') {
      return state;
    }

    const startedAt = state.created_at;
    if (startedAt === undefined) {
      return state;
    }

    const startedMs = Date.parse(startedAt);
    const now = this.clock.now();
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
    await this.saveState(terminated);
    await this.emitRunTerminated(terminated, now);
    return terminated;
  }

  private buildCompletedResult(definition: SopDefinition, state: RunState): RunUntilCompleteResult {
    if (state.status !== 'succeeded') {
      return {state};
    }

    return {
      state,
      'final_output': renderFinalOutput({
        definition,
        state,
      }),
    };
  }

  private async emit(kind: Parameters<EventSink['emit']>[0]['kind'], runId: string, at: string, details?: JsonObject): Promise<void> {
    await this.eventSink.emit({
      kind,
      'run_id': runId,
      at,
      details,
    });
  }

  private async emitRunTerminated(state: RunState, at: string): Promise<void> {
    await this.emit('run_terminated', state.run_id, at, {
      'run_status': state.terminal?.run_status ?? state.status,
      'reason': state.terminal?.reason ?? 'terminated',
    });
  }

  private async handleBeforeStepControl(
    control: HookControl,
    definition: SopDefinition,
    state: RunState,
  ): Promise<RunState> {
    if (control.action === 'pause') {
      const paused = pauseRun({
        'definition': definition,
        'state': state,
        'reason': control.reason,
        'now': this.clock.now(),
      });
      await this.saveState(paused);
      await this.emit('run_paused', paused.run_id, this.clock.now(), {
        'reason': control.reason,
      });
      return paused;
    }

    const terminated = terminateRun({
      'definition': definition,
      'state': state,
      'runStatus': control.runStatus,
      'reason': control.reason,
      'now': this.clock.now(),
    });
    await this.saveState(terminated);
    await this.emitRunTerminated(terminated, this.clock.now());
    return terminated;
  }

  private async handleAfterStepControl(
    control: HookControl,
    definition: SopDefinition,
    state: RunState,
  ): Promise<RunState> {
    if (control.action === 'pause') {
      const paused = pauseRun({
        'definition': definition,
        'state': state,
        'reason': control.reason,
        'now': this.clock.now(),
      });
      await this.saveState(paused);
      await this.emit('run_paused', paused.run_id, this.clock.now(), {
        'reason': control.reason,
      });
      return paused;
    }

    const terminated = terminateRun({
      'definition': definition,
      'state': state,
      'runStatus': control.runStatus,
      'reason': control.reason,
      'now': this.clock.now(),
    });
    await this.saveState(terminated);
    await this.emitRunTerminated(terminated, this.clock.now());
    return terminated;
  }
}

const BEFORE_STEP_HOOK_RESULT_KEYS = new Set(['inputs', 'config', 'control']);
const AFTER_STEP_HOOK_RESULT_KEYS = new Set(['result', 'control']);
const AFTER_STEP_RESULT_PATCH_KEYS = new Set(['status', 'output', 'artifacts', 'error', 'metrics']);

function clonePacketForHook(
  packet: ReturnType<typeof buildStepPacket>,
  inputs: JsonObject,
  config: JsonObject | undefined,
): BeforeStepHookInput['packet'] {
  const packetForHook = {
    'run_id': packet.run_id,
    'step_id': packet.step_id,
    'attempt': packet.attempt,
    inputs,
    'executor': {
      'kind': packet.executor.kind,
      'name': packet.executor.name,
      ...(config === undefined ? {} : {'config': config}),
      'timeout_secs': packet.executor.timeout_secs,
      'allow_network': packet.executor.allow_network,
      'env': packet.executor.env,
      'resource_limits': packet.executor.resource_limits,
    },
  };

  return structuredClone(packetForHook) as BeforeStepHookInput['packet'];
}

function assertHookResultObject(
  value: unknown,
  stage: 'beforeStep' | 'afterStep',
  index: number,
): asserts value is Record<string, unknown> {
  if (isStrictPlainObject(value)) {
    return;
  }

  throw new RuntimeError('hook_rejected', {
    'message': `${stage} hook must return an object when it returns a value.`,
    'details': {stage, index},
  });
}

function assertAllowedHookKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  stage: 'beforeStep' | 'afterStep',
  index: number,
  container: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new RuntimeError('hook_rejected', {
        'message': `${container} returned unsupported field: ${key}.`,
        'details': {stage, index, 'field': key},
      });
    }
  }
}

function assertJsonSafeObject(
  value: unknown,
  stage: 'beforeStep' | 'afterStep',
  index: number,
  field: string,
): asserts value is JsonObject {
  if (isJsonSafeObject(value, new Set<object>())) {
    return;
  }

  throw new RuntimeError('hook_rejected', {
    'message': `${stage} hook returned non JSON-safe ${field}.`,
    'details': {stage, index, field},
  });
}

function isJsonSafeObject(value: unknown, seen: Set<object>): value is JsonObject {
  if (!isStrictPlainObject(value)) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }

  seen.add(value);
  for (const item of Object.values(value)) {
    if (!isJsonSafeValue(item, seen)) {
      seen.delete(value);
      return false;
    }
  }
  seen.delete(value);

  return true;
}

function isJsonSafeValue(value: unknown, seen: Set<object>): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, i) || !isJsonSafeValue(value[i], seen)) {
        seen.delete(value);
        return false;
      }
    }
    seen.delete(value);
    return true;
  }

  return isJsonSafeObject(value, seen);
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function renderPolicyKey(params: {
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

function getCurrentAcceptedResult(state: RunState): AcceptedStepResult {
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

function assertDefinitionMatchesRun(definition: SopDefinition, state: RunState): void {
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

function validateHookControl(
  control: unknown,
  stage: 'beforeStep' | 'afterStep',
  index: number,
): asserts control is HookControl {
  if (!isStrictPlainObject(control)) {
    throw new RuntimeError('hook_rejected', {
      'message': 'Hook control must be a non-null object.',
      'details': {stage, index},
    });
  }

  const c = control;
  if (c.action === 'pause') {
    assertAllowedHookKeys(c, new Set(['action', 'reason']), stage, index, 'hook pause control');
    if (typeof c.reason !== 'string') {
      throw new RuntimeError('hook_rejected', {
        'message': 'Hook pause control requires a string reason.',
        'details': {stage, index},
      });
    }
    return;
  }

  if (c.action === 'terminate') {
    assertAllowedHookKeys(c, new Set(['action', 'runStatus', 'reason']), stage, index, 'hook terminate control');
    if (c.runStatus !== 'failed' && c.runStatus !== 'cancelled') {
      throw new RuntimeError('hook_rejected', {
        'message': 'Hook terminate control requires runStatus of "failed" or "cancelled".',
        'details': {stage, index},
      });
    }
    if (typeof c.reason !== 'string') {
      throw new RuntimeError('hook_rejected', {
        'message': 'Hook terminate control requires a string reason.',
        'details': {stage, index},
      });
    }
    return;
  }

  throw new RuntimeError('hook_rejected', {
    'message': 'Hook control action must be "pause" or "terminate".',
    'details': {stage, index},
  });
}
