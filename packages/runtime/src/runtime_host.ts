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
import {StepExecutor} from './step_executor.js';

export type StartRunReason = RunStartClaimReason;

/** Starts or reuses a run for one validated SOP definition and input payload. 基于一份已校验的 SOP 定义与输入，启动或复用一次运行。 */
export interface StartRunParams {
  definition: SopDefinition;
  input: JsonObject;
  /** Optional caller-provided run id. Store implementations must reject collisions. 调用方可选提供 run id；Store 实现必须拒绝冲突。 */
  runId?: string;
}

/** State, record, and policy reason returned by startRun. startRun 返回的状态、记录与策略原因。 */
export interface StartRunResult {
  state: RunState;
  reason: StartRunReason;
  record: RunRecord;
}

/** Drives a persisted run until termination or until the guard limit is reached. 驱动已持久化运行直至终止，或达到保护步数上限。 */
export interface RunUntilCompleteParams {
  definition: SopDefinition;
  runId: string;
  /** Protects callers from malformed graphs or custom providers that never terminate. 防止异常流程图或自定义提供器导致无限执行。 */
  maxRuntimeSteps?: number;
}

export interface RunUntilCompleteResult {
  state: RunState;
  final_output?: FinalOutput;
}

/** Ports required by RuntimeHost plus optional defaults for local embedding. RuntimeHost 所需端口，以及用于本地嵌入的可选默认实现。 */
export interface RuntimeHostOptions {
  store: StateStore;
  executor: StepExecutor;
  decisionProvider?: DecisionProvider;
  clock?: Clock;
  idGenerator?: IdGenerator;
  logger?: RuntimeLogger;
  eventSink?: EventSink;
}

/**
 * Embeddable orchestrator that connects the pure core engine to runtime ports.
 * 可嵌入的编排器，用于把纯 core 引擎连接到 runtime 端口。
 *
 * RuntimeHost owns orchestration policy checks such as idempotency, concurrency,
 * cooldown, max_run_secs, event emission, and final-output rendering. It does not
 * implement distributed step leases; callers should avoid driving the same run
 * concurrently unless their StateStore/adapter adds that coordination.
 * RuntimeHost 负责幂等、并发、冷却、max_run_secs、事件发射与最终输出渲染等编排策略校验；
 * 它不实现分布式步骤租约机制，除非 StateStore/适配器额外提供协调能力，
 * 否则调用方应避免并发驱动同一个 run。
 */
export class RuntimeHost {
  private readonly store: StateStore;
  private readonly executor: StepExecutor;
  private readonly decisionProvider: DecisionProvider;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly logger: RuntimeLogger;
  private readonly eventSink: EventSink;

  constructor(options: RuntimeHostOptions) {
    this.store = options.store;
    this.executor = options.executor;
    this.decisionProvider = options.decisionProvider ?? new DefaultDecisionProvider();
    this.clock = options.clock ?? new SystemClock();
    this.idGenerator = options.idGenerator ?? new RandomIdGenerator();
    this.logger = options.logger ?? new NoopRuntimeLogger();
    this.eventSink = options.eventSink ?? new NoopEventSink();
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

    const result = await this.executor.execute(packet);
    // External execution can cross the run deadline; do not persist stale results. 外部执行可能越过运行截止时间，不应持久化过期结果。
    state = await this.enforceMaxRunSecs(params.definition, state);
    if (state.phase === 'terminated') {
      return state;
    }

    const nextState = applyStepResult({
      'definition': params.definition,
      state,
      'stepResult': result,
      'now': this.clock.now(),
    });
    await this.saveState(nextState);
    await this.emit('step_result_accepted', nextState.run_id, this.clock.now(), {
      'step_id': result.step_id,
      'attempt': result.attempt,
      'status': result.status,
    });

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
    // Decision providers can also cross the deadline before returning. 决策提供器返回前也可能跨过截止时间。
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

