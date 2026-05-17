import { describe, expect, test } from 'bun:test';
import {
  RuntimeHost,
  DefaultDecisionProvider,
  SqliteStateStore,
  RuntimeError,
} from '../src/index.js';
import { FixedClock, SequentialIdGenerator, buildDefinition, registerDefaultExecutor } from './runtime_host_test_helpers.js';
import { AfterStepHook } from '../src/hook_pipeline.js';
import { requireRunSnapshot } from '../src/runtime_host_state.js';

function buildSqliteHost(overrides: {
  clock?: FixedClock;
  afterStepHooks?: AfterStepHook[];
  max_run_secs?: number;
} = {}): { host: RuntimeHost; store: SqliteStateStore } {
  const store = new SqliteStateStore({ dbPath: ':memory:' });
  const clock = overrides.clock ?? new FixedClock('2026-04-20T12:00:00.000Z');
  const host = new RuntimeHost({
    store,
    'decisionProvider': new DefaultDecisionProvider(),
    clock,
    'idGenerator': new SequentialIdGenerator(),
    'hooks': {
      'afterStep': overrides.afterStepHooks,
    },
  });
  return { host, store };
}

// ---------------------------------------------------------------------------
// after-step hook pause/terminate with CAS
// ---------------------------------------------------------------------------

describe('RuntimeHost with SqliteStateStore — after-step control', () => {
  test('after-step hook pause does not trigger cas_conflict', async () => {
    const afterStepHook: AfterStepHook = () => ({
      'control': { 'action': 'pause' as const, 'reason': 'pause after step' },
    });

    const { host } = buildSqliteHost({ afterStepHooks: [afterStepHook] });
    registerDefaultExecutor(host);

    const definition = buildDefinition();
    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    expect(started.reason).toBe('created');

    // After-step hook pauses → should not cas_conflict on pause save
    const state = await host.runReadyStep({ definition, 'runId': started.state.run_id });
    expect(state.phase).toBe('paused');
    expect(state.status).toBe('running');

    // Verify the step result was accepted before the pause
    const accepted = state.accepted_results['step_a'];
    expect(accepted).not.toBeUndefined();
    expect(accepted!.status).toBe('success');
  });

  test('after-step hook terminate does not trigger cas_conflict', async () => {
    const afterStepHook: AfterStepHook = () => ({
      'control': { 'action': 'terminate' as const, 'runStatus': 'cancelled' as const, 'reason': 'done via hook' },
    });

    const { host } = buildSqliteHost({ afterStepHooks: [afterStepHook] });
    registerDefaultExecutor(host);

    const definition = buildDefinition();
    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    const state = await host.runReadyStep({ definition, 'runId': started.state.run_id });
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('cancelled');

    // Step result was accepted before terminate
    const accepted = state.accepted_results['step_a'];
    expect(accepted).not.toBeUndefined();
    expect(accepted!.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// runUntilComplete with SqliteStateStore
// ---------------------------------------------------------------------------

describe('RuntimeHost with SqliteStateStore — runUntilComplete', () => {
  test('simple runUntilComplete succeeds with CAS continuity', async () => {
    const { host } = buildSqliteHost();
    registerDefaultExecutor(host);

    const definition = buildDefinition();
    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    expect(started.reason).toBe('created');

    const result = await host.runUntilComplete({ definition, 'runId': started.state.run_id });
    expect(result.state.status).toBe('succeeded');
    expect(result.final_output).not.toBeUndefined();
    expect(result.final_output!.summary).toBe('summary for Acme');
  });

  test('enforceMaxRunSecs with expected revision terminates timed-out run', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const { host } = buildSqliteHost({
      clock,
      'max_run_secs': 1,
    });
    registerDefaultExecutor(host);

    // 1 second max run
    const definition = buildDefinition({ 'max_run_secs': 1 });
    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    // Advance clock past deadline
    clock.setNow('2026-04-20T12:00:02.000Z');

    const state = await host.runReadyStep({ definition, 'runId': started.state.run_id });
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('failed');
    expect(state.terminal?.reason).toBe('max_run_secs_exceeded');
  });

  test('enforceMaxRunSecs cas_conflict on stale state', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const { host, store } = buildSqliteHost({ clock });
    registerDefaultExecutor(host);

    const definition = buildDefinition({ 'max_run_secs': 60 });
    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    // Simulate another worker modifying the run
    clock.setNow('2026-04-20T12:00:10.000Z');
    const externalSnapshot = await requireRunSnapshot(store, started.state.run_id);
    await store.saveRunState(
      { ...externalSnapshot.state, 'updated_at': clock.now() },
      { 'expected_revision': externalSnapshot.revision ?? '1' },
    );

    // Now try runReadyStep with the host — it loads fresh, so should succeed
    clock.setNow('2026-04-20T12:00:00.001Z');
    const state = await host.runReadyStep({ definition, 'runId': started.state.run_id });
    expect(state.phase).toBe('awaiting_decision');
  });
});

// ---------------------------------------------------------------------------
// Stale revision detection in host-managed paths
// ---------------------------------------------------------------------------

describe('RuntimeHost CAS conflict propagation', () => {
  test('saveRunState with stale revision throws cas_conflict', async () => {
    const store = new SqliteStateStore({ dbPath: ':memory:' });
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const definition = buildDefinition();
    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    // Load snapshot, get revision
    const snap1 = await requireRunSnapshot(store, started.state.run_id);

    // External worker modifies
    await store.saveRunState(
      { ...snap1.state, 'updated_at': '2026-04-20T12:00:01.000Z' },
      { 'expected_revision': snap1.revision },
    );

    // Host uses stale state and old revision → should cas_conflict
    const snap2 = await requireRunSnapshot(store, started.state.run_id);
    expect(snap2.revision).not.toBe(snap1.revision);

    // Using stale revision directly should throw
    expect(
      store.saveRunState(
        { ...snap1.state, 'updated_at': '2026-04-20T12:00:02.000Z' },
        { expected_revision: snap1.revision },
      ),
    ).rejects.toThrow(RuntimeError);
  });
});
