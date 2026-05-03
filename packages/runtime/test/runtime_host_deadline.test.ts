import { describe, expect, test } from 'bun:test';
import { SopDefinition } from '@sop-runtime/definition';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeError,
  RuntimeHost,
} from '../src/index.js';
import {
  buildDefinition,
  buildHost,
  ClockAdvancingDecisionProvider,
  clockAdvancingExecutor,
  FixedClock,
  registerDefaultExecutor,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('RuntimeHost', () => {
  test('rejects mismatched definitions before max_run_secs can mutate the run', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const store = new InMemoryStateStore();
    const definition = buildDefinition({ 'max_run_secs': 60 });
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    const wrongDefinition = {
      ...definition,
      'sop_id': 'other_runtime_report',
      'policies': { ...definition.policies, 'max_run_secs': 1 },
    } as SopDefinition;

    clock.setNow('2026-04-20T12:00:02.000Z');
    let mismatchError: unknown;
    try {
      await host.runUntilComplete({ 'definition': wrongDefinition, 'runId': started.state.run_id });
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
    const definition = buildDefinition({ 'max_run_secs': 60 });
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    await host.runReadyStep({ definition, 'runId': started.state.run_id });
    const wrongDefinition = {
      ...definition,
      'sop_id': 'other_runtime_report',
      'policies': { ...definition.policies, 'max_run_secs': 1 },
    } as SopDefinition;

    clock.setNow('2026-04-20T12:00:02.000Z');
    let mismatchError: unknown;
    try {
      await host.applyDecision({ 'definition': wrongDefinition, 'runId': started.state.run_id });
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

  test('fails a run when max_run_secs is exceeded before the next runtime action', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({ 'max_run_secs': 1 });
    const { host } = buildHost({ clock });
    registerDefaultExecutor(host);

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    clock.setNow('2026-04-20T12:00:02.000Z');
    const completed = await host.runUntilComplete({ definition, 'runId': started.state.run_id });

    expect(completed.state.status).toBe('failed');
    expect(completed.state.terminal).toEqual({
      'run_status': 'failed',
      'reason': 'max_run_secs_exceeded',
    });
    expect(completed.final_output).toBeUndefined();
  });

  test('enforces max_run_secs when callers execute one public runtime action at a time', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({ 'max_run_secs': 1 });
    const { host } = buildHost({ clock });
    const { packets } = registerDefaultExecutor(host);

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    clock.setNow('2026-04-20T12:00:02.000Z');
    const expired = await host.runReadyStep({ definition, 'runId': started.state.run_id });

    expect(expired.status).toBe('failed');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
    expect(packets).toHaveLength(0);
  });

  test('fails a run instead of saving a step result when execution crosses max_run_secs', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({ 'max_run_secs': 1 });
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    const { handler, packets } = clockAdvancingExecutor(clock, '2026-04-20T12:00:02.000Z');
    host.registerExecutor('tool', 'default_tool', handler);

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    const expired = await host.runReadyStep({ definition, 'runId': started.state.run_id });

    expect(expired.status).toBe('failed');
    expect(expired.phase).toBe('terminated');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
    expect(expired.accepted_results.step_a).toBeUndefined();
    expect(packets).toHaveLength(1);
  });

  test('fails a run instead of applying a decision when the provider crosses max_run_secs', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({ 'max_run_secs': 1 });
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'decisionProvider': new ClockAdvancingDecisionProvider(clock, '2026-04-20T12:00:02.000Z'),
      clock,
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    await host.runReadyStep({ definition, 'runId': started.state.run_id });

    const expired = await host.applyDecision({ definition, 'runId': started.state.run_id });

    expect(expired.status).toBe('failed');
    expect(expired.phase).toBe('terminated');
    expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
  });

  test('terminateRun respects max_run_secs deadline over caller-provided status', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({ 'max_run_secs': 1 });
    const { host } = buildHost({ clock });
    registerDefaultExecutor(host);

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    clock.setNow('2026-04-20T12:00:02.000Z');
    const terminated = await host.terminateRun({
      definition,
      'runId': started.state.run_id,
      'runStatus': 'cancelled',
      'reason': 'operator cancelled',
    });

    expect(terminated.phase).toBe('terminated');
    expect(terminated.status).toBe('failed');
    expect(terminated.terminal).toEqual({ 'run_status': 'failed', 'reason': 'max_run_secs_exceeded' });
  });

  test('enforceMaxRunSecs terminates a paused run that exceeds max_run_secs', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({ 'max_run_secs': 1 });
    const { host } = buildHost({ clock });
    registerDefaultExecutor(host);

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    await host.pauseRun({ definition, 'runId': started.state.run_id, 'reason': 'inspect' });

    clock.setNow('2026-04-20T12:00:02.000Z');
    const result = await host.runUntilComplete({ definition, 'runId': started.state.run_id });

    expect(result.state.status).toBe('failed');
    expect(result.state.terminal?.reason).toBe('max_run_secs_exceeded');
  });
});
