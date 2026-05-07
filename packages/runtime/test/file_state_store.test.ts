import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunState } from '@sop-runtime/definition';
import { FileStateStore } from '../src/file_state_store.js';
import { RunRecord } from '../src/state_store.js';
import { RuntimeError } from '../src/index.js';

const baseTmp = tmpdir();

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    run_id: 'run_001',
    sop_id: 'test_sop',
    sop_version: '1.0.0',
    status: 'running',
    phase: 'ready',
    run_input: {},
    entry_step_id: 'step_a',
    current_step_id: 'step_a',
    current_attempt: 1,
    steps: {
      step_a: { step_id: 'step_a', status: 'active', attempt_count: 1 },
    },
    accepted_results: {},
    history: [{ kind: 'run_created', step_id: 'step_a' }],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: 'run_001',
    sop_id: 'test_sop',
    sop_version: '1.0.0',
    idempotency_key: 'idem_001',
    concurrency_key: 'conc_001',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FileStateStore', () => {
  let tmpDir: string;
  let store: FileStateStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(baseTmp, 'fss-test-'));
    store = new FileStateStore({ baseDir: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // saveRun / loadRun
  // -----------------------------------------------------------------------

  test('saveRun and loadRun round-trip', async () => {
    const state = makeRunState();
    await store.saveRun(state);
    const loaded = await store.loadRun('run_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe('run_001');
    expect(loaded!.status).toBe('running');
  });

  test('loadRun returns null for unknown id', async () => {
    const loaded = await store.loadRun('nonexistent');
    expect(loaded).toBeNull();
  });

  // -----------------------------------------------------------------------
  // saveRunRecord / loadRunRecord
  // -----------------------------------------------------------------------

  test('saveRunRecord and loadRunRecord round-trip', async () => {
    const record = makeRecord();
    await store.saveRunRecord(record);
    const loaded = await store.loadRunRecord('run_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.idempotency_key).toBe('idem_001');
  });

  test('loadRunRecord returns null for unknown id', async () => {
    const loaded = await store.loadRunRecord('nonexistent');
    expect(loaded).toBeNull();
  });

  // -----------------------------------------------------------------------
  // saveRunState
  // -----------------------------------------------------------------------

  test('saveRunState updates record timestamps', async () => {
    await store.saveRun(makeRunState());
    await store.saveRunRecord(makeRecord({ created_at: '2026-01-01T00:00:00.000Z' }));
    const updated = makeRunState({ updated_at: '2026-01-01T00:05:00.000Z' });
    await store.saveRunState(updated);

    const record = await store.loadRunRecord('run_001');
    expect(record!.updated_at).toBe('2026-01-01T00:05:00.000Z');
  });

  test('saveRunState sets completed_at on termination', async () => {
    const state = makeRunState();
    await store.saveRun(state);
    await store.saveRunRecord(makeRecord());
    const terminated = makeRunState({
      status: 'succeeded',
      phase: 'terminated',
      updated_at: '2026-01-01T00:10:00.000Z',
      terminal: { run_status: 'succeeded', reason: 'done' },
    });
    await store.saveRunState(terminated);

    const record = await store.loadRunRecord('run_001');
    expect(record!.completed_at).toBe('2026-01-01T00:10:00.000Z');
  });

  test('saveRunState does not throw when no record exists', async () => {
    const state = makeRunState();
    await store.saveRunState(state);
    // Should not throw — silently skips record update
  });

  // -----------------------------------------------------------------------
  // claimRunStart
  // -----------------------------------------------------------------------

  test('claimRunStart creates new run', async () => {
    const state = makeRunState();
    const record = makeRecord();
    const result = await store.claimRunStart({
      state, record,
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(result.reason).toBe('created');
    expect(result.state.run_id).toBe('run_001');
  });

  test('claimRunStart idempotent replay', async () => {
    const state = makeRunState();
    const record = makeRecord();
    await store.claimRunStart({
      state, record,
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });

    const state2 = makeRunState({ run_id: 'run_002' });
    const record2 = makeRecord({ run_id: 'run_002', idempotency_key: 'idem_001' });
    const result = await store.claimRunStart({
      state: state2, record: record2,
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(result.reason).toBe('idempotent_replay');
    expect(result.state.run_id).toBe('run_001');
  });

  test('claimRunStart cooldown active', async () => {
    const state = makeRunState();
    const record = makeRecord();
    await store.claimRunStart({
      state, record,
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });

    // Complete the run
    const completed = makeRunState({
      status: 'succeeded',
      phase: 'terminated',
      updated_at: '2026-01-01T00:01:00.000Z',
      terminal: { run_status: 'succeeded', reason: 'done' },
    });
    await store.saveRunState(completed);

    // Try new run within cooldown
    const state2 = makeRunState({ run_id: 'run_002' });
    const record2 = makeRecord({ run_id: 'run_002', idempotency_key: 'idem_002' });
    const result = await store.claimRunStart({
      state: state2, record: record2,
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 3600,
      now: '2026-01-01T00:01:30.000Z',
    });
    expect(result.reason).toBe('cooldown_active');
  });

  test('claimRunStart singleflight join', async () => {
    const state = makeRunState();
    const record = makeRecord();
    await store.claimRunStart({
      state, record,
      concurrency_mode: 'singleflight',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });

    const state2 = makeRunState({ run_id: 'run_002' });
    const record2 = makeRecord({ run_id: 'run_002', idempotency_key: 'idem_002' });
    const result = await store.claimRunStart({
      state: state2, record: record2,
      concurrency_mode: 'singleflight',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(result.reason).toBe('singleflight_joined');
    expect(result.state.run_id).toBe('run_001');
  });

  test('claimRunStart drop_if_running', async () => {
    const state = makeRunState();
    const record = makeRecord();
    await store.claimRunStart({
      state, record,
      concurrency_mode: 'allow_parallel',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });

    const state2 = makeRunState({ run_id: 'run_002' });
    const record2 = makeRecord({ run_id: 'run_002', idempotency_key: 'idem_002' });
    const result = await store.claimRunStart({
      state: state2, record: record2,
      concurrency_mode: 'drop_if_running',
      cooldown_secs: 0,
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(result.reason).toBe('dropped_running');
  });

  test('claimRunStart run_id conflict', async () => {
    const state = makeRunState();
    const record = makeRecord();
    await store.saveRun(state);
    await store.saveRunRecord(record);

    const state2 = makeRunState();
    const record2 = makeRecord({ idempotency_key: 'idem_002' });
    try {
      await store.claimRunStart({
        state: state2, record: record2,
        concurrency_mode: 'allow_parallel',
        cooldown_secs: 0,
        now: '2026-01-01T00:00:00.000Z',
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).code).toBe('run_id_conflict');
    }
  });

  // -----------------------------------------------------------------------
  // find methods
  // -----------------------------------------------------------------------

  test('findRunByIdempotencyKey finds match', async () => {
    const record = makeRecord({ idempotency_key: 'my_idem_key' });
    await store.saveRunRecord(record);
    const found = await store.findRunByIdempotencyKey({
      sop_id: 'test_sop', sop_version: '1.0.0', key: 'my_idem_key',
    });
    expect(found).not.toBeNull();
    expect(found!.run_id).toBe('run_001');
  });

  test('findRunByIdempotencyKey returns null on no match', async () => {
    const found = await store.findRunByIdempotencyKey({
      sop_id: 'test_sop', sop_version: '1.0.0', key: 'nonexistent',
    });
    expect(found).toBeNull();
  });

  test('findRunningRunByConcurrencyKey finds running', async () => {
    await store.saveRun(makeRunState({ run_id: 'run_001', status: 'running' }));
    await store.saveRunRecord(makeRecord({ concurrency_key: 'conc_a' }));
    const found = await store.findRunningRunByConcurrencyKey({
      sop_id: 'test_sop', sop_version: '1.0.0', key: 'conc_a',
    });
    expect(found).not.toBeNull();
    expect(found!.run_id).toBe('run_001');
  });

  test('findRunningRunByConcurrencyKey returns null for completed', async () => {
    await store.saveRun(makeRunState({ run_id: 'run_001', status: 'succeeded' }));
    await store.saveRunRecord(makeRecord({ concurrency_key: 'conc_a' }));
    const found = await store.findRunningRunByConcurrencyKey({
      sop_id: 'test_sop', sop_version: '1.0.0', key: 'conc_a',
    });
    expect(found).toBeNull();
  });

  test('findLatestRunByConcurrencyKey returns latest', async () => {
    await store.saveRun(makeRunState({ run_id: 'run_001' }));
    await store.saveRunRecord(makeRecord({ run_id: 'run_001', concurrency_key: 'conc_a', created_at: '2026-01-01T00:00:01.000Z' }));
    await store.saveRun(makeRunState({ run_id: 'run_002' }));
    await store.saveRunRecord(makeRecord({ run_id: 'run_002', concurrency_key: 'conc_a', created_at: '2026-01-01T00:00:03.000Z' }));
    await store.saveRun(makeRunState({ run_id: 'run_003' }));
    await store.saveRunRecord(makeRecord({ run_id: 'run_003', concurrency_key: 'conc_b', created_at: '2026-01-01T00:00:05.000Z' }));

    const found = await store.findLatestRunByConcurrencyKey({
      sop_id: 'test_sop', sop_version: '1.0.0', key: 'conc_a',
    });
    expect(found!.run_id).toBe('run_002');
  });

  test('findLatestRunByConcurrencyKey returns null on no match', async () => {
    const found = await store.findLatestRunByConcurrencyKey({
      sop_id: 'test_sop', sop_version: '1.0.0', key: 'nonexistent',
    });
    expect(found).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Persistence across instances
  // -----------------------------------------------------------------------

  test('data persists across store instances', async () => {
    const state = makeRunState();
    await store.saveRun(state);

    const store2 = new FileStateStore({ baseDir: tmpDir });
    const loaded = await store2.loadRun('run_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe('run_001');
  });

  // -----------------------------------------------------------------------
  // Directory auto-created
  // -----------------------------------------------------------------------

  test('directory is auto-created on first write', async () => {
    const freshDir = join(tmpDir, 'nested', 'store');
    const freshStore = new FileStateStore({ baseDir: freshDir });
    await freshStore.saveRun(makeRunState());
    const loaded = await freshStore.loadRun('run_001');
    expect(loaded).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Concurrent claimRunStart
  // -----------------------------------------------------------------------

  test('concurrent claimRunStart serializes correctly', async () => {
    const state1 = makeRunState({ run_id: 'run_a' });
    const record1 = makeRecord({ run_id: 'run_a', idempotency_key: 'same_key' });
    const state2 = makeRunState({ run_id: 'run_b' });
    const record2 = makeRecord({ run_id: 'run_b', idempotency_key: 'same_key' });

    const [r1, r2] = await Promise.all([
      store.claimRunStart({ state: state1, record: record1, concurrency_mode: 'allow_parallel', cooldown_secs: 0, now: '2026-01-01T00:00:00.000Z' }),
      store.claimRunStart({ state: state2, record: record2, concurrency_mode: 'allow_parallel', cooldown_secs: 0, now: '2026-01-01T00:00:00.000Z' }),
    ]);
    const reasons = [r1.reason, r2.reason].sort();
    expect(reasons).toContain('created');
    expect(reasons).toContain('idempotent_replay');
  });
});
