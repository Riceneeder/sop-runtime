import { describe, expect, test } from 'bun:test';
import { SqliteStateStore } from '../src/sqlite_state_store.js';
import { SqliteEventSink } from '../src/sqlite_event_sink.js';
import { RunState } from '@sop-runtime/definition';
import { RunRecord, ClaimRunStartResult } from '../src/state_store.js';
import { RuntimeError } from '../src/runtime_error.js';

function createStore(dbPath?: string): SqliteStateStore {
  return new SqliteStateStore({ dbPath: dbPath ?? ':memory:' });
}

function makeMinimalState(overrides?: Partial<RunState>): RunState {
  return {
    run_id: 'run_001',
    sop_id: 'sop_a',
    sop_version: '1.0.0',
    status: 'running',
    phase: 'ready',
    run_input: {},
    entry_step_id: 'step_a',
    current_step_id: 'step_a',
    current_attempt: 1,
    steps: {},
    accepted_results: {},
    history: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as RunState;
}

function makeRecord(overrides?: Partial<RunRecord>): RunRecord {
  return {
    run_id: 'run_001',
    sop_id: 'sop_a',
    sop_version: '1.0.0',
    idempotency_key: 'idem-key-1',
    concurrency_key: 'conc-key-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    completed_at: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

describe('SqliteStateStore', () => {
  test('loadRun returns null for non-existent run', async () => {
    const store = createStore();
    expect(await store.loadRun('nonexistent')).toBeNull();
  });

  test('saveRun + loadRun round-trip', async () => {
    const store = createStore();
    const state = makeMinimalState();
    await store.saveRun(state);
    const loaded = await store.loadRun('run_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe('run_001');
    expect(loaded!.status).toBe('running');
  });

  test('loadRunRecord returns null for non-existent record', async () => {
    const store = createStore();
    expect(await store.loadRunRecord('nonexistent')).toBeNull();
  });

  test('saveRunRecord + loadRunRecord round-trip', async () => {
    const store = createStore();
    const record = makeRecord();
    await store.saveRunRecord(record);
    const loaded = await store.loadRunRecord('run_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe('run_001');
    expect(loaded!.idempotency_key).toBe('idem-key-1');
  });

  test('saveRunState creates and updates record timestamps', async () => {
    const store = createStore();
    const state = makeMinimalState();
    const record = makeRecord();
    await store.saveRun(state);
    await store.saveRunRecord(record);

    const updated = { ...state, updated_at: '2026-01-01T00:01:00.000Z' };
    await store.saveRunState(updated);

    const loadedRecord = await store.loadRunRecord('run_001');
    expect(loadedRecord!.updated_at).toBe('2026-01-01T00:01:00.000Z');
  });

  test('saveRunState sets completed_at on terminated', async () => {
    const store = createStore();
    const state = makeMinimalState({ phase: 'terminated' as const, status: 'succeeded' as const });
    const record = makeRecord();
    await store.saveRun(state);
    await store.saveRunRecord(record);

    await store.saveRunState({ ...state, updated_at: '2026-01-01T00:01:00.000Z' });

    const loadedRecord = await store.loadRunRecord('run_001');
    expect(loadedRecord!.completed_at).toBe('2026-01-01T00:01:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// claimRunStart
// ---------------------------------------------------------------------------

describe('claimRunStart', () => {
  function claimOpts(overrides?: object) {
    const state = makeMinimalState();
    return {
      state,
      record: makeRecord(),
      concurrency_mode: 'allow_parallel' as const,
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  test('created: first claim returns created', async () => {
    const store = createStore();
    const opts = claimOpts();
    const result = await store.claimRunStart(opts);
    expect(result.reason).toBe('created');
    expect(result.state.run_id).toBe('run_001');
  });

  test('idempotent_replay: same idempotency key returns existing', async () => {
    const store = createStore();
    const opts = claimOpts();
    await store.claimRunStart(opts);

    const opts2 = claimOpts({ record: makeRecord({ run_id: 'run_002' }) });
    const result = await store.claimRunStart(opts2);
    expect(result.reason).toBe('idempotent_replay');
  });

  test('idempotent_replay: different sop_version does not match', async () => {
    const store = createStore();
    await store.claimRunStart(claimOpts());

    const opts2 = claimOpts({
      state: makeMinimalState({ run_id: 'run_002', sop_version: '2.0.0' }),
      record: makeRecord({ run_id: 'run_002', sop_version: '2.0.0' }),
    });
    const result = await store.claimRunStart(opts2);
    expect(result.reason).toBe('created');
  });

  test('cooldown_active: returns existing within cooldown window', async () => {
    const store = createStore();

    const state = makeMinimalState({ status: 'succeeded' as const, phase: 'terminated' as const });
    await store.saveRun(state);
    const record = makeRecord({
      idempotency_key: 'idem-cd-1',
      completed_at: '2026-01-01T00:00:00.000Z',
    });
    await store.saveRunRecord(record);

    const opts2 = claimOpts({
      state: makeMinimalState({ run_id: 'run_002' }),
      record: makeRecord({ run_id: 'run_002', idempotency_key: 'idem-cd-2', concurrency_key: 'conc-key-1' }),
      cooldown_secs: 60,
    });
    const result = await store.claimRunStart(opts2);
    expect(result.reason).toBe('cooldown_active');
  });

  test('cooldown: outside cooldown window creates new run', async () => {
    const store = createStore();

    const state = makeMinimalState({ status: 'succeeded' as const, phase: 'terminated' as const });
    await store.saveRun(state);
    const record = makeRecord({
      idempotency_key: 'idem-cdout-1',
      completed_at: '2026-01-01T00:00:00.000Z',
    });
    await store.saveRunRecord(record);

    const opts2 = claimOpts({
      state: makeMinimalState({ run_id: 'run_002' }),
      record: makeRecord({ run_id: 'run_002', idempotency_key: 'idem-cdout-2', concurrency_key: 'conc-key-1' }),
      cooldown_secs: 30,
      now: '2026-01-01T00:02:00.000Z',
    });
    const result = await store.claimRunStart(opts2);
    expect(result.reason).toBe('created');
  });

  test('singleflight_joined: returns running run with same concurrency key', async () => {
    const store = createStore();
    await store.claimRunStart(claimOpts({
      record: makeRecord({ idempotency_key: 'idem-sf-1' }),
    }));

    const opts2 = claimOpts({
      state: makeMinimalState({ run_id: 'run_002' }),
      record: makeRecord({ run_id: 'run_002', idempotency_key: 'idem-sf-2' }),
      concurrency_mode: 'singleflight' as const,
    });
    const result = await store.claimRunStart(opts2);
    expect(result.reason).toBe('singleflight_joined');
  });

  test('drop_if_running: returns running run with same concurrency key', async () => {
    const store = createStore();
    await store.claimRunStart(claimOpts({
      record: makeRecord({ idempotency_key: 'idem-drop-1' }),
    }));

    const opts2 = claimOpts({
      state: makeMinimalState({ run_id: 'run_002' }),
      record: makeRecord({ run_id: 'run_002', idempotency_key: 'idem-drop-2' }),
      concurrency_mode: 'drop_if_running' as const,
    });
    const result = await store.claimRunStart(opts2);
    expect(result.reason).toBe('dropped_running');
  });

  test('run_id_conflict: same run_id throws', async () => {
    const store = createStore();
    await store.claimRunStart(claimOpts());

    const state2 = makeMinimalState({ sop_id: 'sop_b', sop_version: '2.0.0' });
    const record2 = makeRecord({
      run_id: 'run_001',
      sop_id: 'sop_b',
      sop_version: '2.0.0',
      idempotency_key: 'idem-key-2',
    });
    const opts2 = claimOpts({ state: state2, record: record2 });
    expect(store.claimRunStart(opts2)).rejects.toThrow(RuntimeError);
  });

  test('allow_parallel: creates new run even with same concurrency key', async () => {
    const store = createStore();
    await store.claimRunStart(claimOpts({
      record: makeRecord({ idempotency_key: 'idem-par-1' }),
    }));

    const opts2 = claimOpts({
      state: makeMinimalState({ run_id: 'run_002' }),
      record: makeRecord({ run_id: 'run_002', idempotency_key: 'idem-par-2' }),
      concurrency_mode: 'allow_parallel' as const,
    });
    const result = await store.claimRunStart(opts2);
    expect(result.reason).toBe('created');
  });
});

// ---------------------------------------------------------------------------
// Version-based CAS
// ---------------------------------------------------------------------------

describe('CAS (compare-and-swap)', () => {
  test('saveRunState with stale version throws cas_conflict', async () => {
    const store = createStore();
    const state = makeMinimalState();
    await store.saveRun(state);
    const record = makeRecord();
    await store.saveRunRecord(record);

    // First update succeeds (version 1)
    const stateV1 = { ...state, updated_at: '2026-01-01T00:01:00.000Z', version: 1 };
    await store.saveRunState(stateV1 as RunState & { version: number });

    // Second attempt with same version should fail
    expect(
      store.saveRunState({ ...state, updated_at: '2026-01-01T00:02:00.000Z', version: 1 } as RunState & { version: number }),
    ).rejects.toThrow(RuntimeError);
  });

  test('saveRunState with correct version succeeds', async () => {
    const store = createStore();
    const state = makeMinimalState();
    await store.saveRun(state);
    const record = makeRecord();
    await store.saveRunRecord(record);

    // First update (version 1 -> 2)
    const stateV1 = { ...state, updated_at: '2026-01-01T00:01:00.000Z', version: 1 };
    await store.saveRunState(stateV1 as RunState & { version: number });

    // Second update with version 2 succeeds
    const stateV2 = { ...state, updated_at: '2026-01-01T00:02:00.000Z', version: 2 };
    await store.saveRunState(stateV2 as RunState & { version: number });
  });

  test('saveRun version CAS conflict', async () => {
    const store = createStore();
    const state = makeMinimalState();
    await store.saveRun(state);

    await store.saveRun({ ...state, updated_at: '2026-01-01T00:01:00.000Z' } as RunState & { version: number });

    expect(
      store.saveRun({ ...state, updated_at: '2026-01-01T00:02:00.000Z', version: 1 } as RunState & { version: number }),
    ).rejects.toThrow(RuntimeError);
  });
});

// ---------------------------------------------------------------------------
// Process restart recovery
// ---------------------------------------------------------------------------

describe('process restart recovery', () => {
  test('file-backed store survives close and reopen', async () => {
    const dbPath = '/tmp/test_sqlite_recovery.db';
    try { Bun.spawnSync(['rm', '-f', dbPath]); } catch { /* ignore */ }

    const store1 = createStore(dbPath);
    const state = makeMinimalState();
    const record = makeRecord();
    await store1.saveRun(state);
    await store1.saveRunRecord(record);
    store1.close();

    const store2 = createStore(dbPath);
    const loaded = await store2.loadRun('run_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe('run_001');
    expect(loaded!.status).toBe('running');

    const loadedRecord = await store2.loadRunRecord('run_001');
    expect(loadedRecord).not.toBeNull();
    expect(loadedRecord!.idempotency_key).toBe('idem-key-1');

    store2.close();
    try { Bun.spawnSync(['rm', '-f', dbPath]); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// Lookup methods
// ---------------------------------------------------------------------------

describe('lookup methods', () => {
  test('findRunByIdempotencyKey', async () => {
    const store = createStore();
    await store.claimRunStart({
      state: makeMinimalState(),
      record: makeRecord(),
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });

    const found = await store.findRunByIdempotencyKey({
      sop_id: 'sop_a', sop_version: '1.0.0', key: 'idem-key-1',
    });
    expect(found).not.toBeNull();
    expect(found!.run_id).toBe('run_001');

    const notFound = await store.findRunByIdempotencyKey({
      sop_id: 'sop_a', sop_version: '1.0.0', key: 'nonexistent',
    });
    expect(notFound).toBeNull();
  });

  test('findRunningRunByConcurrencyKey', async () => {
    const store = createStore();
    await store.claimRunStart({
      state: makeMinimalState(),
      record: makeRecord(),
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });

    const found = await store.findRunningRunByConcurrencyKey({
      sop_id: 'sop_a', sop_version: '1.0.0', key: 'conc-key-1',
    });
    expect(found).not.toBeNull();
    expect(found!.run_id).toBe('run_001');

    // After termination, should no longer find as running
    const terminatedState = makeMinimalState({ status: 'succeeded', phase: 'terminated' });
    await store.saveRunState({ ...terminatedState, updated_at: '2026-01-01T00:01:00.000Z' });

    const notFound = await store.findRunningRunByConcurrencyKey({
      sop_id: 'sop_a', sop_version: '1.0.0', key: 'conc-key-1',
    });
    expect(notFound).toBeNull();
  });

  test('findLatestRunByConcurrencyKey', async () => {
    const store = createStore();

    // Run 1 via claimRunStart
    await store.claimRunStart({
      state: makeMinimalState(),
      record: makeRecord({ idempotency_key: 'idem-latest-1' }),
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });

    // Run 2 with same concurrency key, later timestamp
    await store.claimRunStart({
      state: makeMinimalState({ run_id: 'run_002', updated_at: '2026-01-01T00:05:00.000Z' }),
      record: makeRecord({ run_id: 'run_002', idempotency_key: 'idem-latest-2', concurrency_key: 'conc-key-1', updated_at: '2026-01-01T00:05:00.000Z' }),
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:05:00.000Z',
    });

    const latest = await store.findLatestRunByConcurrencyKey({
      sop_id: 'sop_a', sop_version: '1.0.0', key: 'conc-key-1',
    });
    expect(latest).not.toBeNull();
    expect(latest!.run_id).toBe('run_002');
  });
});

// ---------------------------------------------------------------------------
// SqliteEventSink
// ---------------------------------------------------------------------------

describe('SqliteEventSink', () => {
  test('emit and retrieve events', async () => {
    const store = createStore();
    const sink = new SqliteEventSink({ store });

    await store.saveRun(makeMinimalState());

    await sink.emit({
      kind: 'run_started',
      run_id: 'run_001',
      at: '2026-01-01T00:00:00.000Z',
      details: { reason: 'created' },
    });

    await sink.emit({
      kind: 'step_result_accepted',
      run_id: 'run_001',
      at: '2026-01-01T00:01:00.000Z',
      details: { step_id: 'step_a', attempt: 1, status: 'success' },
    });

    const rows = store.getDb().query<{ kind: string; run_id: string }, []>(
      'SELECT kind, run_id FROM events ORDER BY id',
    ).all();
    expect(rows.length).toBe(2);
    expect(rows[0]!.kind).toBe('run_started');
    expect(rows[1]!.kind).toBe('step_result_accepted');
  });

  test('emit with null details', async () => {
    const store = createStore();
    const sink = new SqliteEventSink({ store });
    await store.saveRun(makeMinimalState());

    await sink.emit({
      kind: 'run_terminated',
      run_id: 'run_001',
      at: '2026-01-01T00:00:00.000Z',
    });

    const rows = store.getDb().query<{ kind: string; details: string | null }, []>(
      'SELECT kind, details FROM events',
    ).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.details).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Concurrency: parallel claimRunStart
// ---------------------------------------------------------------------------

describe('concurrent claimRunStart', () => {
  test('10 parallel claims with same idempotency key produce 1 created + 9 idempotent_replay', async () => {
    const store = createStore();

    const promises: Promise<ClaimRunStartResult>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        store.claimRunStart({
          state: makeMinimalState({ run_id: `run_${i}` }),
          record: makeRecord({ run_id: `run_${i}` }),
          concurrency_mode: 'allow_parallel',
          cooldown_secs: 0,
          now: '2026-01-01T00:00:00.000Z',
        }),
      );
    }

    const results = await Promise.all(promises);
    const created = results.filter((r) => r.reason === 'created').length;
    const replayed = results.filter((r) => r.reason === 'idempotent_replay').length;

    expect(created).toBe(1);
    expect(replayed).toBe(9);
  });
});
