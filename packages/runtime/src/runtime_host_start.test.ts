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
