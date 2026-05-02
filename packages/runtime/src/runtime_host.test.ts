import {describe, expect, test} from 'bun:test';
import {Decision, JsonObject, SopDefinition, StepResult} from '@sop-runtime/definition';
import {
  DefaultDecisionProvider,
  DecisionProvider,
  EventSink,
  ExecutorHandler,
  InMemoryStateStore,
  RuntimeError,
  RuntimeEvent,
  RuntimeHost,
} from './index.js';

interface PacketSnapshot {
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
    resource_limits: { max_output_bytes: number; max_artifacts: number };
  };
}

class FixedClock {
  private current: string;

  constructor(now: string) {
    this.current = now;
  }

  now(): string {
    return this.current;
  }

  setNow(now: string): void {
    this.current = now;
  }
}

class SequentialIdGenerator {
  private next = 1;

  newRunId(): string {
    const id = `run_${String(this.next).padStart(3, '0')}`;
    this.next += 1;
    return id;
  }
}

function recordingExecutor(): { handler: ExecutorHandler; packets: PacketSnapshot[] } {
  const packets: PacketSnapshot[] = [];
  const handler: ExecutorHandler = (input) => {
    packets.push({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'inputs': input.packet.inputs,
      'executor': input.packet.executor,
    });
    return {
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': {
        'summary': `summary for ${String(input.packet.inputs.company)}`,
      },
      'artifacts': {
        'report_md': `/tmp/${input.packet.run_id}.md`,
      },
    };
  };
  return {handler, packets};
}

function clockAdvancingExecutor(clock: FixedClock, nextNow: string): { handler: ExecutorHandler; packets: PacketSnapshot[] } {
  const packets: PacketSnapshot[] = [];
  const handler: ExecutorHandler = (input) => {
    packets.push({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'inputs': input.packet.inputs,
      'executor': input.packet.executor,
    });
    clock.setNow(nextNow);
    return {
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': {'summary': 'summary after deadline'},
      'artifacts': {'report_md': `/tmp/${input.packet.run_id}.md`},
    };
  };
  return {handler, packets};
}

class ClockAdvancingDecisionProvider implements DecisionProvider {
  constructor(
    private readonly clock: FixedClock,
    private readonly nextNow: string,
  ) {}

  async decide(input: Parameters<DecisionProvider['decide']>[0]): Promise<Decision> {
    this.clock.setNow(this.nextNow);
    return {
      'run_id': input.state.run_id,
      'step_id': input.accepted_result.step_id,
      'attempt': input.accepted_result.attempt,
      'outcome_id': 'done',
      'reason': 'selected after deadline',
    };
  }
}

class RecordingEventSink implements EventSink {
  readonly events: RuntimeEvent[] = [];

  emit(event: RuntimeEvent): void {
    this.events.push(event);
  }
}

function buildDefinition(overrides: Partial<SopDefinition['policies']> = {}): SopDefinition {
  return {
    'sop_id': 'runtime_report',
    'name': 'Runtime Report',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {
      'type': 'object',
      'required': ['company'],
      'properties': {
        'company': {'type': 'string'},
      },
      'additionalProperties': false,
    },
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': 'report:${run.input.company}',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'report:${run.input.company}',
      },
      ...overrides,
    },
    'steps': [{
      'id': 'step_a',
      'title': 'A',
      'inputs': {
        'company': '${run.input.company}',
      },
      'executor': {
        'kind': 'tool',
        'name': 'default_tool',
        'config': {'command_template': 'run', 'path': '/tmp'},
        'timeout_secs': 120,
        'allow_network': true,
        'env': {},
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
      'output_schema': {
        'type': 'object',
        'required': ['summary'],
        'properties': {
          'summary': {'type': 'string'},
        },
      },
      'retry_policy': {
        'max_attempts': 1,
        'backoff_secs': [],
        'retry_on': [],
      },
      'supervision': {
        'owner': 'main_agent',
        'allowed_outcomes': [{'id': 'done', 'description': 'done'}],
        'default_outcome': 'done',
      },
      'transitions': {
        'done': {
          'terminate': {
            'run_status': 'succeeded',
            'reason': 'complete',
          },
        },
      },
    }],
    'final_output': {
      'summary': '${steps.step_a.output.summary}',
      'artifact': '${steps.step_a.artifacts.report_md}',
    },
  };
}

function buildHost(overrides: {
  clock?: FixedClock;
  idGenerator?: SequentialIdGenerator;
  decisionProvider?: DecisionProvider;
  eventSink?: RecordingEventSink;
} = {}): { host: RuntimeHost; store: InMemoryStateStore } {
  const store = new InMemoryStateStore();
  const host = new RuntimeHost({
    store,
    'decisionProvider': overrides.decisionProvider ?? new DefaultDecisionProvider(),
    'clock': overrides.clock ?? new FixedClock('2026-04-20T12:00:00.000Z'),
    'idGenerator': overrides.idGenerator ?? new SequentialIdGenerator(),
    'eventSink': overrides.eventSink,
  });
  return {host, store};
}

function registerDefaultExecutor(host: RuntimeHost): { packets: PacketSnapshot[] } {
  const {handler, packets} = recordingExecutor();
  host.registerExecutor('tool', 'default_tool', handler);
  return {packets};
}

describe('RuntimeHost', () => {
  test('starts a run, executes the ready step, applies the default decision, and renders final output', async () => {
    const {host} = buildHost();
    const {packets} = registerDefaultExecutor(host);

    const started = await host.startRun({
      'definition': buildDefinition(),
      'input': {'company': 'Acme'},
    });
    const completed = await host.runUntilComplete({
      'definition': buildDefinition(),
      'runId': started.state.run_id,
    });

    expect(started.reason).toBe('created');
    expect(completed.state.status).toBe('succeeded');
    expect(completed.final_output).toEqual({
      'summary': 'summary for Acme',
      'artifact': '/tmp/run_001.md',
    });
    expect(packets).toHaveLength(1);
    expect(await host.getRunState({'runId': 'run_001'})).toEqual(completed.state);
  });

  test('throws executor_not_registered when no handler is registered for the executor kind+name', async () => {
    const {host} = buildHost();
    // Deliberately do NOT register any executor
    const started = await host.startRun({
      'definition': buildDefinition(),
      'input': {'company': 'Acme'},
    });

    let execError: unknown;
    try {
      await host.runReadyStep({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
      });
    } catch (caught) {
      execError = caught;
    }

    expect(execError).toBeInstanceOf(RuntimeError);
    expect((execError as RuntimeError).code).toBe('executor_not_registered');
  });

  test('dispatches to the correct handler based on kind + name', async () => {
    const {host} = buildHost();
    const packetsA: PacketSnapshot[] = [];
    const packetsB: PacketSnapshot[] = [];

    host.registerExecutor('kind_a', 'name_x', (input) => {
      packetsA.push({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'inputs': input.packet.inputs,
        'executor': input.packet.executor,
      });
      return { 'run_id': input.packet.run_id, 'step_id': input.packet.step_id, 'attempt': input.packet.attempt, 'status': 'success', 'output': {} };
    });
    host.registerExecutor('kind_b', 'name_y', (input) => {
      packetsB.push({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'inputs': input.packet.inputs,
        'executor': input.packet.executor,
      });
      return { 'run_id': input.packet.run_id, 'step_id': input.packet.step_id, 'attempt': input.packet.attempt, 'status': 'success', 'output': {} };
    });

    // Build a definition that uses kind_a:name_x
    const stepA = buildDefinition().steps[0]!;
    const definitionA: SopDefinition = {
      ...buildDefinition(),
      'steps': [{
        ...stepA,
        'executor': {
          ...stepA.executor,
          'kind': 'kind_a',
          'name': 'name_x',
        },
      }],
    };
    const startedA = await host.startRun({ 'definition': definitionA, 'input': {'company': 'A'} });
    await host.runReadyStep({ 'definition': definitionA, 'runId': startedA.state.run_id });

    expect(packetsA).toHaveLength(1);
    expect(packetsB).toHaveLength(0);
  });

  test('handler cannot bypass core state transition — invalid result is rejected', async () => {
    const {host} = buildHost();
    // Register a handler that returns an invalid status
    host.registerExecutor('tool', 'default_tool', (input) => {
      return {
        'run_id': input.packet.run_id,
        'step_id': 'wrong_step',
        'attempt': 999,
        'status': 'success',
        'output': {},
      } as StepResult;
    });

    const started = await host.startRun({
      'definition': buildDefinition(),
      'input': {'company': 'Acme'},
    });

    let coreError: unknown;
    try {
      await host.runReadyStep({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
      });
    } catch (caught) {
      coreError = caught;
    }

    // The CoreError from applyStepResult should propagate
    expect(coreError).toBeDefined();
    expect((coreError as Error).name).toBe('CoreError');
  });

  test('reuses existing runs through idempotency and singleflight policy checks', async () => {
    const definition = buildDefinition();
    const {host} = buildHost();
    registerDefaultExecutor(host);

    const first = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });
    const idempotentReplay = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });

    expect(first.state.run_id).toBe('run_001');
    expect(idempotentReplay.state.run_id).toBe('run_001');
    expect(idempotentReplay.reason).toBe('idempotent_replay');

    const singleflightDefinition = {
      ...definition,
      'policies': {
        ...definition.policies,
        'idempotency_key_template': 'report:${run.input.company}:${run.input.request_id}',
      },
      'input_schema': {
        'type': 'object',
        'required': ['company', 'request_id'],
        'properties': {
          'company': {'type': 'string'},
          'request_id': {'type': 'string'},
        },
        'additionalProperties': false,
      },
    } as SopDefinition;
    const singleflightA = await host.startRun({
      'definition': singleflightDefinition,
      'input': {'company': 'Beta', 'request_id': 'a'},
    });
    const singleflightB = await host.startRun({
      'definition': singleflightDefinition,
      'input': {'company': 'Beta', 'request_id': 'b'},
    });

    expect(singleflightB.state.run_id).toBe(singleflightA.state.run_id);
    expect(singleflightB.reason).toBe('singleflight_joined');
  });

  test('atomically reuses the same run for concurrent idempotent starts', async () => {
    const definition = buildDefinition();
    const {host} = buildHost();
    registerDefaultExecutor(host);

    const [first, second] = await Promise.all([
      host.startRun({definition, 'input': {'company': 'Acme'}}),
      host.startRun({definition, 'input': {'company': 'Acme'}}),
    ]);

    expect(first.state.run_id).toBe('run_001');
    expect(second.state.run_id).toBe('run_001');
    expect([first.reason, second.reason].sort()).toEqual(['created', 'idempotent_replay']);
  });

  test('returns a dropped running run and enforces cooldown after completion', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({
      'cooldown_secs': 300,
      'concurrency': {
        'mode': 'drop_if_running',
        'key_template': 'report:${run.input.company}',
      },
    });
    const {host} = buildHost({clock});
    registerDefaultExecutor(host);

    const first = await host.startRun({definition, 'input': {'company': 'Acme'}});
    const dropped = await host.startRun({
      'definition': {
        ...definition,
        'policies': {
          ...definition.policies,
          'idempotency_key_template': 'report:${run.input.company}:different',
        },
      },
      'input': {'company': 'Acme'},
    });
    await host.runUntilComplete({definition, 'runId': first.state.run_id});

    clock.setNow('2026-04-20T12:01:00.000Z');
    const cooldown = await host.startRun({
      'definition': {
        ...definition,
        'policies': {
          ...definition.policies,
          'idempotency_key_template': 'report:${run.input.company}:after',
        },
      },
      'input': {'company': 'Acme'},
    });

    expect(dropped.state.run_id).toBe('run_001');
    expect(dropped.reason).toBe('dropped_running');
    expect(cooldown.state.run_id).toBe('run_001');
    expect(cooldown.reason).toBe('cooldown_active');
  });

  test('keeps cooldown active even when a newer run for the same key is still in progress', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({
      'cooldown_secs': 300,
      'idempotency_key_template': 'report:${run.input.company}:${run.input.request_id}',
      'concurrency': {
        'mode': 'allow_parallel',
        'key_template': 'report:${run.input.company}',
      },
    });
    definition.input_schema = {
      'type': 'object',
      'required': ['company', 'request_id'],
      'properties': {
        'company': {'type': 'string'},
        'request_id': {'type': 'string'},
      },
      'additionalProperties': false,
    };
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const first = await host.startRun({definition, 'input': {'company': 'Acme', 'request_id': 'first'}});
    const second = await host.startRun({definition, 'input': {'company': 'Acme', 'request_id': 'second'}});
    await host.runUntilComplete({definition, 'runId': first.state.run_id});

    clock.setNow('2026-04-20T12:01:00.000Z');
    await host.runReadyStep({definition, 'runId': second.state.run_id});
    const third = await host.startRun({definition, 'input': {'company': 'Acme', 'request_id': 'third'}});

    expect(third.state.run_id).toBe(first.state.run_id);
    expect(third.reason).toBe('cooldown_active');
    expect(await store.loadRun(second.state.run_id)).toMatchObject({
      'run_id': second.state.run_id,
      'phase': 'awaiting_decision',
    });
  });

  test('rejects mismatched definitions before max_run_secs can mutate the run', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const store = new InMemoryStateStore();
    const definition = buildDefinition({'max_run_secs': 60});
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
    const wrongDefinition = {
      ...definition,
      'sop_id': 'other_runtime_report',
      'policies': {...definition.policies, 'max_run_secs': 1},
    } as SopDefinition;

    clock.setNow('2026-04-20T12:00:02.000Z');
    let mismatchError: unknown;
    try {
      await host.runUntilComplete({'definition': wrongDefinition, 'runId': started.state.run_id});
    } catch (caught) {
      mismatchError = caught;
    }

    expect(mismatchError).toBeInstanceOf(RuntimeError);
    expect((mismatchError as RuntimeError).code).toBe('invalid_runtime_state');
    expect(await store.loadRun(started.state.run_id)).toMatchObject({
      'run_id': started.state.run_id,
      'status': 'running',
      'phase': 'ready',
    });
  });

  test('rejects mismatched definitions before decision-time max_run_secs can mutate the run', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const store = new InMemoryStateStore();
    const definition = buildDefinition({'max_run_secs': 60});
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
    await host.runReadyStep({definition, 'runId': started.state.run_id});
    const wrongDefinition = {
      ...definition,
      'sop_id': 'other_runtime_report',
      'policies': {...definition.policies, 'max_run_secs': 1},
    } as SopDefinition;

    clock.setNow('2026-04-20T12:00:02.000Z');
    let mismatchError: unknown;
    try {
      await host.applyDecision({'definition': wrongDefinition, 'runId': started.state.run_id});
    } catch (caught) {
      mismatchError = caught;
    }

    expect(mismatchError).toBeInstanceOf(RuntimeError);
    expect((mismatchError as RuntimeError).code).toBe('invalid_runtime_state');
    expect(await store.loadRun(started.state.run_id)).toMatchObject({
      'run_id': started.state.run_id,
      'status': 'running',
      'phase': 'awaiting_decision',
    });
  });

  test('rejects run_id collisions without overwriting the existing run or record', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinition({
      'idempotency_key_template': 'report:${run.input.company}:${run.input.request_id}',
      'concurrency': {
        'mode': 'allow_parallel',
        'key_template': 'report:${run.input.company}',
      },
    });
    definition.input_schema = {
      'type': 'object',
      'required': ['company', 'request_id'],
      'properties': {
        'company': {'type': 'string'},
        'request_id': {'type': 'string'},
      },
      'additionalProperties': false,
    };
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
    });
    registerDefaultExecutor(host);

    await host.startRun({definition, 'input': {'company': 'Acme', 'request_id': 'first'}, 'runId': 'fixed_run'});
    let collisionError: unknown;
    try {
      await host.startRun({definition, 'input': {'company': 'Beta', 'request_id': 'second'}, 'runId': 'fixed_run'});
    } catch (caught) {
      collisionError = caught;
    }

    expect(collisionError).toBeInstanceOf(RuntimeError);
    expect((collisionError as RuntimeError).code).toBe('run_id_conflict');
    expect(await store.loadRun('fixed_run')).toMatchObject({
      'run_id': 'fixed_run',
      'run_input': {'company': 'Acme', 'request_id': 'first'},
    });
    expect(await store.loadRunRecord('fixed_run')).toMatchObject({
      'run_id': 'fixed_run',
      'idempotency_key': 'report:Acme:first',
      'concurrency_key': 'report:Acme',
    });
  });

  test('fails a run when max_run_secs is exceeded before the next runtime action', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const {host} = buildHost({clock});
    registerDefaultExecutor(host);

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});

    clock.setNow('2026-04-20T12:00:02.000Z');
    const completed = await host.runUntilComplete({definition, 'runId': started.state.run_id});

    expect(completed.state.status).toBe('failed');
    expect(completed.state.terminal).toEqual({
      'run_status': 'failed',
      'reason': 'max_run_secs_exceeded',
    });
    expect(completed.final_output).toBeUndefined();
  });

  test('enforces max_run_secs when callers execute one public runtime action at a time', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const {host} = buildHost({clock});
    const {packets} = registerDefaultExecutor(host);

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});

    clock.setNow('2026-04-20T12:00:02.000Z');
    const expired = await host.runReadyStep({definition, 'runId': started.state.run_id});

    expect(expired.status).toBe('failed');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
    expect(packets).toHaveLength(0);
  });

  test('fails a run instead of saving a step result when execution crosses max_run_secs', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    const {handler, packets} = clockAdvancingExecutor(clock, '2026-04-20T12:00:02.000Z');
    host.registerExecutor('tool', 'default_tool', handler);

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});

    const expired = await host.runReadyStep({definition, 'runId': started.state.run_id});

    expect(expired.status).toBe('failed');
    expect(expired.phase).toBe('terminated');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
    expect(expired.accepted_results.step_a).toBeUndefined();
    expect(packets).toHaveLength(1);
  });

  test('fails a run instead of applying a decision when the provider crosses max_run_secs', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'decisionProvider': new ClockAdvancingDecisionProvider(clock, '2026-04-20T12:00:02.000Z'),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
    await host.runReadyStep({definition, 'runId': started.state.run_id});

    const expired = await host.applyDecision({definition, 'runId': started.state.run_id});

    expect(expired.status).toBe('failed');
    expect(expired.phase).toBe('terminated');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
  });

  test('emits run_terminated events for normal terminal transitions', async () => {
    const eventSink = new RecordingEventSink();
    const {host} = buildHost({eventSink});
    registerDefaultExecutor(host);

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    await host.runUntilComplete({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(eventSink.events.map((event) => event.kind)).toContain('run_terminated');
    expect(eventSink.events.at(-1)).toMatchObject({
      'kind': 'run_terminated',
      'run_id': 'run_001',
      'details': {'run_status': 'succeeded', 'reason': 'complete'},
    });
  });

  test('rejects missing runs', async () => {
    const {host} = buildHost();
    registerDefaultExecutor(host);

    let missingRunError: unknown;
    try {
      await host.runUntilComplete({'definition': buildDefinition(), 'runId': 'missing'});
    } catch (caught) {
      missingRunError = caught;
    }

    expect(missingRunError).toBeInstanceOf(RuntimeError);
    expect((missingRunError as RuntimeError).code).toBe('run_not_found');
  });

  test('pauses a run and emits run_paused event', async () => {
    const eventSink = new RecordingEventSink();
    const {host} = buildHost({eventSink});
    registerDefaultExecutor(host);

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const paused = await host.pauseRun({
      'definition': buildDefinition(),
      'runId': started.state.run_id,
      'reason': 'manual inspection',
    });

    expect(paused.phase).toBe('paused');
    expect(paused.pause?.reason).toBe('manual inspection');
    expect(paused.pause?.previous_phase).toBe('ready');
    expect(eventSink.events.map((e) => e.kind)).toContain('run_paused');
    expect(eventSink.events.at(-1)).toMatchObject({
      'kind': 'run_paused',
      'run_id': 'run_001',
      'details': {'reason': 'manual inspection'},
    });
  });

  test('resumes a paused run and emits run_resumed event', async () => {
    const eventSink = new RecordingEventSink();
    const {host} = buildHost({eventSink});
    registerDefaultExecutor(host);

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    await host.pauseRun({'definition': buildDefinition(), 'runId': started.state.run_id, 'reason': 'inspect'});

    const resumed = await host.resumeRun({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(resumed.phase).toBe('ready');
    expect(resumed.pause).toBeUndefined();
    expect(eventSink.events.map((e) => e.kind)).toContain('run_resumed');
    expect(eventSink.events.at(-1)).toMatchObject({'kind': 'run_resumed', 'run_id': 'run_001'});
  });

  test('terminates a run and emits run_terminated event', async () => {
    const eventSink = new RecordingEventSink();
    const {host} = buildHost({eventSink});
    registerDefaultExecutor(host);

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const terminated = await host.terminateRun({
      'definition': buildDefinition(),
      'runId': started.state.run_id,
      'runStatus': 'cancelled',
      'reason': 'operator cancelled',
    });

    expect(terminated.phase).toBe('terminated');
    expect(terminated.status).toBe('cancelled');
    expect(terminated.terminal).toEqual({'run_status': 'cancelled', 'reason': 'operator cancelled'});
    expect(eventSink.events.map((e) => e.kind)).toContain('run_terminated');
  });

  test('terminateRun respects max_run_secs deadline over caller-provided status', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const {host} = buildHost({clock});
    registerDefaultExecutor(host);

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});

    clock.setNow('2026-04-20T12:00:02.000Z');
    const terminated = await host.terminateRun({
      definition,
      'runId': started.state.run_id,
      'runStatus': 'cancelled',
      'reason': 'operator cancelled',
    });

    expect(terminated.phase).toBe('terminated');
    expect(terminated.status).toBe('failed');
    expect(terminated.terminal).toEqual({'run_status': 'failed', 'reason': 'max_run_secs_exceeded'});
  });

  test('runUntilComplete returns immediately when run is paused', async () => {
    const {host} = buildHost();
    registerDefaultExecutor(host);

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    await host.pauseRun({'definition': buildDefinition(), 'runId': started.state.run_id, 'reason': 'inspect'});

    const result = await host.runUntilComplete({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(result.state.phase).toBe('paused');
    expect(result.final_output).toBeUndefined();
  });

  test('enforceMaxRunSecs terminates a paused run that exceeds max_run_secs', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const {host} = buildHost({clock});
    registerDefaultExecutor(host);

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
    await host.pauseRun({definition, 'runId': started.state.run_id, 'reason': 'inspect'});

    clock.setNow('2026-04-20T12:00:02.000Z');
    const result = await host.runUntilComplete({definition, 'runId': started.state.run_id});

    expect(result.state.status).toBe('failed');
    expect(result.state.terminal?.reason).toBe('max_run_secs_exceeded');
  });

  describe('getRunState', () => {
    test('returns the run state snapshot from the store', async () => {
      const {host} = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
      const state = await host.getRunState({'runId': started.state.run_id});

      expect(state.run_id).toBe('run_001');
      expect(state.phase).toBe('ready');
    });

    test('throws run_not_found for missing runs', async () => {
      const {host} = buildHost();

      let error: unknown;
      try {
        await host.getRunState({'runId': 'no_such_run'});
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).code).toBe('run_not_found');
    });
  });

  describe('getCurrentStep', () => {
    test('returns the current step view for a ready run', async () => {
      const {host} = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
      const view = await host.getCurrentStep({'definition': buildDefinition(), 'runId': started.state.run_id});

      expect(view).not.toBeNull();
      expect(view!.step_id).toBe('step_a');
      expect(view!.attempt).toBe(1);
      expect(view!.step.id).toBe('step_a');
      expect(view!.step_state.status).toBe('active');
    });

    test('returns null for terminated runs', async () => {
      const {host} = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
      await host.terminateRun({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
        'runStatus': 'cancelled',
        'reason': 'test',
      });

      const view = await host.getCurrentStep({'definition': buildDefinition(), 'runId': started.state.run_id});
      expect(view).toBeNull();
    });

    test('throws for mismatched definitions', async () => {
      const {host} = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
      const wrongDefinition = {...buildDefinition(), 'sop_id': 'other'};

      let error: unknown;
      try {
        await host.getCurrentStep({'definition': wrongDefinition, 'runId': started.state.run_id});
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).code).toBe('invalid_runtime_state');
    });
  });

  describe('decideOutcome', () => {
    test('builds and applies a decision from the current accepted result', async () => {
      const {host} = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});

      // Execute the step first to get an accepted result
      await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

      // Now decide the outcome
      const nextState = await host.decideOutcome({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
        'outcomeId': 'done',
        'reason': 'test decision',
      });

      expect(nextState.status).toBe('succeeded');
      expect(nextState.phase).toBe('terminated');
    });

    test('emits decision_applied and run_terminated events', async () => {
      const eventSink = new RecordingEventSink();
      const {host} = buildHost({eventSink});
      registerDefaultExecutor(host);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
      await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

      await host.decideOutcome({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
        'outcomeId': 'done',
      });

      const kinds = eventSink.events.map((e) => e.kind);
      expect(kinds).toContain('decision_applied');
      expect(kinds).toContain('run_terminated');
    });

    test('respects max_run_secs before applying the decision', async () => {
      const clock = new FixedClock('2026-04-20T12:00:00.000Z');
      const definition = buildDefinition({'max_run_secs': 1});
      const host = new RuntimeHost({
        'store': new InMemoryStateStore(),
        'decisionProvider': new DefaultDecisionProvider(),
        clock,
        'idGenerator': new SequentialIdGenerator(),
      });
      registerDefaultExecutor(host);

      const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
      await host.runReadyStep({definition, 'runId': started.state.run_id});

      clock.setNow('2026-04-20T12:00:02.000Z');
      const expired = await host.decideOutcome({
        definition,
        'runId': started.state.run_id,
        'outcomeId': 'done',
      });

      expect(expired.status).toBe('failed');
      expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
    });
  });

  describe('applyDecision compatibility', () => {
    test('applyDecision still works as a compat entry point', async () => {
      const {host} = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
      await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

      const nextState = await host.applyDecision({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
        'decision': {
          'run_id': started.state.run_id,
          'step_id': 'step_a',
          'attempt': 1,
          'outcome_id': 'done',
          'reason': 'compat test',
        },
      });

      expect(nextState.status).toBe('succeeded');
    });
  });

});
