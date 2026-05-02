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
  runReadyStepImpl,
  getRunStateImpl,
  getCurrentStepImpl,
  decideOutcomeImpl,
  applyDecisionImpl,
  pauseRunImpl,
  resumeRunImpl,
  terminateRunImpl,
  renderPolicyKey,
  assertDefinitionMatchesRun,
  requireRun,
  enforceMaxRunSecs,
  buildCompletedResult,
} from './runtime_host_internals.js';

export type {ExecutorHandler, ExecutorHandlerInput} from './runtime_host_internals.js';
export type StartRunReason = RunStartClaimReason;

export interface StartRunParams {
  definition: SopDefinition;
  input: JsonObject;
  runId?: string;
}

export interface StartRunResult {
  state: RunState;
  reason: StartRunReason;
  record: RunRecord;
}

export interface RunUntilCompleteParams {
  definition: SopDefinition;
  runId: string;
  maxRuntimeSteps?: number;
}

export interface RunUntilCompleteResult {
  state: RunState;
  final_output?: FinalOutput;
}

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
  private readonly executors = new Map<string, Map<string, ExecutorHandler>>();
  private readonly beforeStepHooks: BeforeStepHook[];
  private readonly afterStepHooks: AfterStepHook[];
  private readonly deps: HostDeps;

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

  registerExecutor(kind: string, name: string, handler: ExecutorHandler): void {
    let inner = this.executors.get(kind);
    if (inner === undefined) {
      inner = new Map();
      this.executors.set(kind, inner);
    }
    inner.set(name, handler);
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

  async runReadyStep(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<RunState> {
    return runReadyStepImpl(this.deps, params.definition, params.runId);
  }

  async getRunState(params: {runId: string}): Promise<RunState> {
    return getRunStateImpl(this.deps, params.runId);
  }

  getCurrentStep(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<CurrentStepView | null> {
    return getCurrentStepImpl(this.deps, params.definition, params.runId);
  }

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

  async applyDecision(params: {
    definition: SopDefinition;
    runId: string;
    decision?: Decision;
  }): Promise<RunState> {
    return applyDecisionImpl(this.deps, params.definition, params.runId, params.decision);
  }

  async pauseRun(params: {
    definition: SopDefinition;
    runId: string;
    reason: string;
  }): Promise<RunState> {
    return pauseRunImpl(this.deps, params.definition, params.runId, params.reason);
  }

  async resumeRun(params: {
    definition: SopDefinition;
    runId: string;
  }): Promise<RunState> {
    return resumeRunImpl(this.deps, params.definition, params.runId);
  }

  async terminateRun(params: {
    definition: SopDefinition;
    runId: string;
    runStatus: 'cancelled' | 'failed';
    reason: string;
  }): Promise<RunState> {
    return terminateRunImpl(this.deps, params.definition, params.runId, params.runStatus, params.reason);
  }

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
