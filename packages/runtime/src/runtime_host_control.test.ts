import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeError,
  RuntimeHost,
} from './index.js';
import {
  FixedClock,
  SequentialIdGenerator,
  RecordingExecutor,
  buildDefinition,
} from './runtime_host_test_helpers.js';

describe('RuntimeHost', () => {
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
});
