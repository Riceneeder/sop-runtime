import {describe, expect, test} from 'bun:test';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
} from './index.js';
import {
  FixedClock,
  SequentialIdGenerator,
  RecordingExecutor,
  ClockAdvancingExecutor,
  ClockAdvancingDecisionProvider,
  buildDefinition,
} from './runtime_host_test_helpers.js';

describe('RuntimeHost', () => {
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
});
