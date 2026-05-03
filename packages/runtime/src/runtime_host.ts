import {
  Decision,
  FinalOutput,
  JsonObject,
  RunState,
  SopDefinition,
} from '@sop-runtime/definition';
import {
  createRun,
  CurrentStepView,
} from '@sop-runtime/core';
import {Clock, SystemClock} from './clock.js';
import {DecisionProvider, DefaultDecisionProvider} from './decision_provider.js';
import {EventSink, NoopEventSink} from './event_sink.js';
import {IdGenerator, RandomIdGenerator} from './id_generator.js';
import {NoopRuntimeLogger, RuntimeLogger} from './logger.js';
import {RuntimeError} from './runtime_error.js';
import {RunRecord, RunStartClaimReason, StateStore} from './state_store.js';
import {
  AfterStepHook,
  BeforeStepHook,
} from './hook_pipeline.js';
import {
  HostDeps,
  ExecutorHandler,
} from './runtime_host_types.js';
import { runReadyStepImpl } from './run_ready_step.js';
import {
  getRunStateImpl,
  getCurrentStepImpl,
  renderPolicyKey,
  assertDefinitionMatchesRun,
  requireRun,
} from './runtime_host_state.js';
import { decideOutcomeImpl, applyDecisionImpl } from './runtime_host_decision.js';
import { pauseRunImpl, resumeRunImpl, terminateRunImpl } from './runtime_host_control.js';
import { enforceMaxRunSecs, buildCompletedResult } from './runtime_host_deadline.js';

export type {ExecutorHandler, ExecutorHandlerInput} from './runtime_host_types.js';
export type StartRunReason = RunStartClaimReason;

/**
 * Parameters for starting a new run.
 *
 * 启动新运行的参数。
 *
 * @public
 */
export interface StartRunParams {
  /** The SOP definition to run. 要运行的 SOP 定义。 */
  definition: SopDefinition;
  /** The run input payload. 运行输入负载。 */
  input: JsonObject;
  /** Optional explicit run ID; auto-generated if omitted. 可选的显式运行 ID，省略时自动生成。 */
  runId?: string;
}

/**
 * Result of starting a new run.
 *
 * 启动新运行的结果。
 *
 * @public
 */
export interface StartRunResult {
  /** The initial run state. 初始运行状态。 */
  state: RunState;
  /** Reason for the result (created, idempotent_replay, cooldown_active, etc.). 结果原因（created、idempotent_replay、cooldown_active 等）。 */
  reason: StartRunReason;
  /** The run record for the newly created or reused run. 新创建或复用的运行记录。 */
  record: RunRecord;
}

/**
 * Parameters for running a run to completion.
 *
 * 执行运行直至完成的参数。
 *
 * @public
 */
export interface RunUntilCompleteParams {
  /** The SOP definition to run. 要运行的 SOP 定义。 */
  definition: SopDefinition;
  /** The run identifier. 运行标识符。 */
  runId: string;
  /** Maximum number of state-machine steps before raising a limit error (default 100). 状态机最大步数限制（默认 100）。 */
  maxRuntimeSteps?: number;
}

/**
 * Result of running a run to completion.
 *
 * 执行运行直至完成的结果。
 *
 * @public
 */
export interface RunUntilCompleteResult {
  /** The final run state. 最终运行状态。 */
  state: RunState;
  /** The rendered final output, present when the run succeeded. 渲染后的最终输出（运行成功时存在）。 */
  final_output?: FinalOutput;
}

/**
 * Options for constructing a RuntimeHost.
 *
 * RuntimeHost 的构造选项。
 *
 * @public
 */
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
 *
 * 可嵌入的编排器，将纯核心引擎连接到运行时端口。
 * RuntimeHost 拥有编排策略检查（幂等性、并发、冷却、最大运行时长、事件发射和最终输出渲染）。
 * 它不实现分布式步骤租约；调用者应避免并发驱动同一运行，除非其 StateStore 实现了协调。
 *
 * @public
 */
export class RuntimeHost {
  private readonly store: StateStore;
  private readonly decisionProvider: DecisionProvider;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly logger: RuntimeLogger;
  private readonly eventSink: EventSink;
  private readonly executors = new Map<string, Map<string, ExecutorHandler>>();
  private readonly beforeStepHooks: BeforeStepHook[];
  private readonly afterStepHooks: AfterStepHook[];
  private readonly deps: HostDeps;

  /**
   * @param options - Configuration for the host including store, decision provider, clock, etc.
   * 宿主配置，包括存储、决策提供者、时钟等。
   */
  constructor(options: RuntimeHostOptions) {
    this.store = options.store;
    this.decisionProvider = options.decisionProvider ?? new DefaultDecisionProvider();
    this.clock = options.clock ?? new SystemClock();
    this.idGenerator = options.idGenerator ?? new RandomIdGenerator();
    this.logger = options.logger ?? new NoopRuntimeLogger();
    this.eventSink = options.eventSink ?? new NoopEventSink();
    this.beforeStepHooks = options.hooks?.beforeStep ?? [];
    this.afterStepHooks = options.hooks?.afterStep ?? [];
    this.deps = {
      store: this.store,
      decisionProvider: this.decisionProvider,
      clock: this.clock,
      eventSink: this.eventSink,
      executors: this.executors,
      beforeStepHooks: this.beforeStepHooks,
      afterStepHooks: this.afterStepHooks,
    };
  }

  /**
   * Register an executor handler for a given kind and name.
   *
   * 为指定 kind 和 name 注册执行器处理器。
   *
   * @param kind - The executor kind (e.g. "sandbox_tool").
   * @param name - The executor name within the kind.
   * @param handler - The handler function.
   */
  registerExecutor(kind: string, name: string, handler: ExecutorHandler): void {
    let inner = this.executors.get(kind);
    if (inner === undefined) {
      inner = new Map();
      this.executors.set(kind, inner);
    }
    inner.set(name, handler);
  }

  /**
   * Start a new run: create the initial state, render policy keys, and claim the run in the store.
   *
   * 启动新运行：创建初始状态、渲染策略键、在存储中声明运行。
   *
   * @param params - The start run parameters.
   * @returns The start run result including state and claim reason.
   */
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
      await this.eventSink.emit({
        kind: 'run_started',
        'run_id': claim.state.run_id,
        at: now,
        details: {'reason': 'created'},
      });
    } else {
      this.logger.info('run reused', {'run_id': claim.state.run_id, 'reason': claim.reason});
      await this.eventSink.emit({
        kind: 'run_reused',
        'run_id': claim.state.run_id,
        at: now,
        details: {'reason': claim.reason},
      });
    }

    return {
      'state': claim.state,
      'reason': claim.reason,
      'record': claim.record,
    };
  }

  /**
   * Execute a single ready step: build packet, run hooks, dispatch executor, apply result.
   *
   * 执行单个就绪步骤：构建数据包、运行钩子、分发执行器、应用结果。
   *
   * @param params - Object containing the definition and run ID.
   * @param params.definition - The SOP definition.
   * @param params.runId - The run identifier.
   * @returns The updated run state.
   */
  async runReadyStep(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<RunState> {
    return runReadyStepImpl(this.deps, params.definition, params.runId);
  }

  /**
   * Load and return the current run state.
   *
   * 加载并返回当前运行状态。
   *
   * @param params - Object containing the run ID.
   * @param params.runId - The run identifier.
   * @returns The run state.
   */
  async getRunState(params: {runId: string}): Promise<RunState> {
    return getRunStateImpl(this.deps.store, params.runId);
  }

  /**
   * Resolve the current step view for a run.
   *
   * 解析运行的当前步骤视图。
   *
   * @param params - Object containing the definition and run ID.
   * @param params.definition - The SOP definition.
   * @param params.runId - The run identifier.
   * @returns The current step view, or null if terminated.
   */
  getCurrentStep(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<CurrentStepView | null> {
    return getCurrentStepImpl(this.deps.store, params.definition, params.runId);
  }

  /**
   * Decide an outcome for a run that is awaiting decision.
   *
   * 为 awaiting_decision 状态的运行决定结果。
   *
   * @param params - Object containing the definition, run ID, outcome ID, and optional reason/metadata.
   * @param params.definition - The SOP definition.
   * @param params.runId - The run identifier.
   * @param params.outcomeId - The outcome identifier.
   * @param params.reason - Optional human-readable reason.
   * @param params.metadata - Optional structured metadata.
   * @returns The updated run state.
   */
  async decideOutcome(params: {
    definition: SopDefinition;
    runId: string;
    outcomeId: string;
    reason?: string;
    metadata?: JsonObject;
  }): Promise<RunState> {
    return decideOutcomeImpl(
      this.deps, params.definition, params.runId,
      params.outcomeId, params.reason, params.metadata,
    );
  }

  /**
   * Apply a decision (auto-generated or provided) to a run awaiting decision.
   *
   * 将决策（自动生成或显式提供）应用到 awaiting_decision 的运行。
   *
   * @param params - Object containing the definition, run ID, and optional decision override.
   * @param params.definition - The SOP definition.
   * @param params.runId - The run identifier.
   * @param params.decision - Optional explicit decision; if omitted, the DecisionProvider is called.
   * @returns The updated run state.
   */
  async applyDecision(params: {
    definition: SopDefinition;
    runId: string;
    decision?: Decision;
  }): Promise<RunState> {
    return applyDecisionImpl(this.deps, params.definition, params.runId, params.decision);
  }

  /**
   * Pause a running run.
   *
   * 暂停正在运行的运行。
   *
   * @param params - Object containing the definition, run ID, and pause reason.
   * @param params.definition - The SOP definition.
   * @param params.runId - The run identifier.
   * @param params.reason - Pause reason.
   * @returns The paused run state.
   */
  async pauseRun(params: {
    definition: SopDefinition;
    runId: string;
    reason: string;
  }): Promise<RunState> {
    return pauseRunImpl(this.deps, params.definition, params.runId, params.reason);
  }

  /**
   * Resume a paused run.
   *
   * 恢复已暂停的运行。
   *
   * @param params - Object containing the definition and run ID.
   * @param params.definition - The SOP definition.
   * @param params.runId - The run identifier.
   * @returns The resumed run state.
   */
  async resumeRun(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<RunState> {
    return resumeRunImpl(this.deps, params.definition, params.runId);
  }

  /**
   * Terminate a running run with a final status and reason.
   *
   * 以最终状态和原因终止正在运行的运行。
   *
   * @param params - Object containing the definition, run ID, status, and reason.
   * @param params.definition - The SOP definition.
   * @param params.runId - The run identifier.
   * @param params.runStatus - The terminal status (cancelled or failed).
   * @param params.reason - Termination reason.
   * @returns The terminated run state.
   */
  async terminateRun(params: {
    definition: SopDefinition;
    runId: string;
    runStatus: 'cancelled' | 'failed';
    reason: string;
  }): Promise<RunState> {
    return terminateRunImpl(this.deps, params.definition, params.runId, params.runStatus, params.reason);
  }

  /**
   * Run a run to completion by looping through ready steps and awaiting_decision phases.
   *
   * 通过循环执行 ready 步骤和 awaiting_decision 阶段来运行运行直至完成。
   *
   * @param params - The run-until-complete parameters.
   * @returns The final result including state and optional final_output.
   * @throws {RuntimeError} If the step limit is exceeded.
   */
  async runUntilComplete(params: RunUntilCompleteParams): Promise<RunUntilCompleteResult> {
    const maxRuntimeSteps = params.maxRuntimeSteps ?? 100;
    let state = await requireRun(this.deps.store, params.runId);
    assertDefinitionMatchesRun(params.definition, state);

    for (let step = 0; step < maxRuntimeSteps; step += 1) {
      state = await enforceMaxRunSecs(params.definition, state, this.deps);
      if (state.phase === 'terminated') {
        return buildCompletedResult(params.definition, state);
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
}
