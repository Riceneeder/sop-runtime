import {describe, expect, test} from 'bun:test';
import {Decision, SopDefinition, StepPacket, StepResult} from '@sop-runtime/definition';
import {
  DefaultDecisionProvider,
  DecisionProvider,
  EventSink,
  InMemoryStateStore,
  RuntimeEvent,
  RuntimeError,
  RuntimeHost,
  StepExecutor,
} from './index.js';

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

class RecordingExecutor implements StepExecutor {
  readonly packets: StepPacket[] = [];

  async execute(packet: StepPacket): Promise<StepResult> {
    this.packets.push(packet);
    return {
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'status': 'success',
      'output': {
        'summary': `summary for ${String(packet.inputs.company)}`,
      },
      'artifacts': {
        'report_md': `/tmp/${packet.run_id}.md`,
      },
    };
  }
}

class ClockAdvancingExecutor implements StepExecutor {
  readonly packets: StepPacket[] = [];

  constructor(
    private readonly clock: FixedClock,
    private readonly nextNow: string,
  ) {}

  async execute(packet: StepPacket): Promise<StepResult> {
    this.packets.push(packet);
    this.clock.setNow(this.nextNow);
    return {
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'status': 'success',
      'output': {'summary': 'summary after deadline'},
      'artifacts': {'report_md': `/tmp/${packet.run_id}.md`},
    };
  }
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
          'name': 'tool',
          'config': { 'command_template': 'run', 'path': '/tmp' },
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

describe('RuntimeHost', () => {
  test('starts a run, executes the ready step, applies the default decision, and renders final output', async () => {
    const store = new InMemoryStateStore();
    const executor = new RecordingExecutor();
    const host = new RuntimeHost({
      store,
      executor,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });

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
    expect(executor.packets).toHaveLength(1);
    expect(await store.loadRun('run_001')).toEqual(completed.state);
  });

  test('reuses existing runs through idempotency and singleflight policy checks', async () => {
    const definition = buildDefinition();
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });

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
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });

    const [first, second] = await Promise.all([
      host.startRun({
        definition,
        'input': {'company': 'Acme'},
      }),
      host.startRun({
        definition,
        'input': {'company': 'Acme'},
      }),
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
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });

    const first = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });
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
    await host.runUntilComplete({
      definition,
      'runId': first.state.run_id,
    });

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
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });

    const first = await host.startRun({
      definition,
      'input': {'company': 'Acme', 'request_id': 'first'},
    });
    const second = await host.startRun({
      definition,
      'input': {'company': 'Acme', 'request_id': 'second'},
    });
    await host.runUntilComplete({
      definition,
      'runId': first.state.run_id,
    });

    clock.setNow('2026-04-20T12:01:00.000Z');
    await host.runReadyStep({
      definition,
      'runId': second.state.run_id,
    });
    const third = await host.startRun({
      definition,
      'input': {'company': 'Acme', 'request_id': 'third'},
    });

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
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });
    const wrongDefinition = {
      ...definition,
      'sop_id': 'other_runtime_report',
      'policies': {
        ...definition.policies,
        'max_run_secs': 1,
      },
    } as SopDefinition;

    clock.setNow('2026-04-20T12:00:02.000Z');
    let mismatchError: unknown;
    try {
      await host.runUntilComplete({
        'definition': wrongDefinition,
        'runId': started.state.run_id,
      });
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
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });
    await host.runReadyStep({
      definition,
      'runId': started.state.run_id,
    });
    const wrongDefinition = {
      ...definition,
      'sop_id': 'other_runtime_report',
      'policies': {
        ...definition.policies,
        'max_run_secs': 1,
      },
    } as SopDefinition;

    clock.setNow('2026-04-20T12:00:02.000Z');
    let mismatchError: unknown;
    try {
      await host.applyDecision({
        'definition': wrongDefinition,
        'runId': started.state.run_id,
      });
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
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
    });

    await host.startRun({
      definition,
      'input': {'company': 'Acme', 'request_id': 'first'},
      'runId': 'fixed_run',
    });
    let collisionError: unknown;
    try {
      await host.startRun({
        definition,
        'input': {'company': 'Beta', 'request_id': 'second'},
        'runId': 'fixed_run',
      });
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
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });

    clock.setNow('2026-04-20T12:00:02.000Z');
    const completed = await host.runUntilComplete({
      definition,
      'runId': started.state.run_id,
    });

    expect(completed.state.status).toBe('failed');
    expect(completed.state.terminal).toEqual({
      'run_status': 'failed',
      'reason': 'max_run_secs_exceeded',
    });
    expect(completed.final_output).toBeUndefined();
  });

  test('enforces max_run_secs when callers execute one public runtime action at a time', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const executor = new RecordingExecutor();
    const definition = buildDefinition({'max_run_secs': 1});
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      executor,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });

    clock.setNow('2026-04-20T12:00:02.000Z');
    const expired = await host.runReadyStep({
      definition,
      'runId': started.state.run_id,
    });

    expect(expired.status).toBe('failed');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
    expect(executor.packets).toHaveLength(0);
  });

  test('fails a run instead of saving a step result when execution crosses max_run_secs', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const executor = new ClockAdvancingExecutor(clock, '2026-04-20T12:00:02.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      executor,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });

    const expired = await host.runReadyStep({
      definition,
      'runId': started.state.run_id,
    });

    expect(expired.status).toBe('failed');
    expect(expired.phase).toBe('terminated');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
    expect(expired.accepted_results.step_a).toBeUndefined();
    expect(executor.packets).toHaveLength(1);
  });

  test('fails a run instead of applying a decision when the provider crosses max_run_secs', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': new RecordingExecutor(),
      'decisionProvider': new ClockAdvancingDecisionProvider(clock, '2026-04-20T12:00:02.000Z'),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });
    await host.runReadyStep({
      definition,
      'runId': started.state.run_id,
    });

    const expired = await host.applyDecision({
      definition,
      'runId': started.state.run_id,
    });

    expect(expired.status).toBe('failed');
    expect(expired.phase).toBe('terminated');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
  });

  test('emits run_terminated events for normal terminal transitions', async () => {
    const eventSink = new RecordingEventSink();
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      eventSink,
    });
    const started = await host.startRun({
      'definition': buildDefinition(),
      'input': {'company': 'Acme'},
    });

    await host.runUntilComplete({
      'definition': buildDefinition(),
      'runId': started.state.run_id,
    });

    expect(eventSink.events.map((event) => event.kind)).toContain('run_terminated');
    expect(eventSink.events.at(-1)).toMatchObject({
      'kind': 'run_terminated',
      'run_id': 'run_001',
      'details': {
        'run_status': 'succeeded',
        'reason': 'complete',
      },
    });
  });

  test('rejects missing runs', async () => {
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });

    let missingRunError: unknown;
    try {
      await host.runUntilComplete({
        'definition': buildDefinition(),
        'runId': 'missing',
      });
    } catch (caught) {
      missingRunError = caught;
    }

    expect(missingRunError).toBeInstanceOf(RuntimeError);
    expect((missingRunError as RuntimeError).code).toBe('run_not_found');
  });
});
