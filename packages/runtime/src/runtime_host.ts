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
  renderFinalOutput,
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

/** Starts or reuses a run for one validated SOP definition and input payload. */
export interface StartRunParams {
  definition: SopDefinition;
  input: JsonObject;
  /** Optional caller-provided run id. Store implementations must reject collisions. */
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
  /** Protects callers from malformed graphs or custom providers that never terminate. */
  maxRuntimeSteps?: number;
}

export interface RunUntilCompleteResult {
  state: RunState;
  final_output?: FinalOutput;
}

/** Ports required by RuntimeHost plus optional defaults for local embedding. */
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
 *
 * RuntimeHost owns orchestration policy checks such as idempotency, concurrency,
 * cooldown, max_run_secs, event emission, and final-output rendering. It does not
 * implement distributed step leases; callers should avoid driving the same run
 * concurrently unless their StateStore/adapter adds that coordination.
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
    // External execution can cross the run deadline; do not persist stale results.
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

  async runUntilComplete(params: RunUntilCompleteParams): Promise<RunUntilCompleteResult> {
    const maxRuntimeSteps = params.maxRuntimeSteps ?? 100;
    let state = await this.requireRun(params.runId);
    assertDefinitionMatchesRun(params.definition, state);

    for (let step = 0; step < maxRuntimeSteps; step += 1) {
      state = await this.enforceMaxRunSecs(params.definition, state);
      if (state.phase === 'terminated') {
        return this.buildCompletedResult(params.definition, state);
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
      state,
      'now': now,
      'reason': 'max_run_secs_exceeded',
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

function terminateRun(params: {
  state: RunState;
  now: string;
  reason: string;
}): RunState {
  const currentStepId = params.state.current_step_id;
  const steps = currentStepId === null || params.state.steps[currentStepId] === undefined
    ? params.state.steps
    : {
      ...params.state.steps,
      [currentStepId]: {
        ...params.state.steps[currentStepId],
        'status': 'failed' as const,
      },
    };

  return {
    ...params.state,
    'status': 'failed',
    'phase': 'terminated',
    'current_step_id': null,
    'current_attempt': null,
    steps,
    'terminal': {
      'run_status': 'failed',
      'reason': params.reason,
    },
    'history': [
      ...params.state.history,
      {
        'kind': 'run_terminated',
        'run_status': 'failed',
        'reason': params.reason,
        'at': params.now,
      },
    ],
    'updated_at': params.now,
  };
}
