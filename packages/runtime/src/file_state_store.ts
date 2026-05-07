import { RunState } from '@sop-runtime/definition';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ClaimRunStartParams,
  ClaimRunStartResult,
  RunRecord,
  RunRecordLookup,
  StateStore,
} from './state_store.js';
import {
  matchesConcurrencyLookup,
  compareRecordTime,
  compareCompletedRecordTime,
  isCooldownActive,
} from './state_store_helpers.js';
import { RuntimeError } from './runtime_error.js';

const RUNS_DIR = 'runs';
const RECORDS_DIR = 'records';

function isNodeError(err: unknown): err is { code?: string } {
  return err instanceof Error && 'code' in err;
}

function validateRunId(runId: string): void {
  if (runId.includes('\0') || runId.includes('/') || runId.includes('..')) {
    throw new RuntimeError('invalid_runtime_state', {
      message: `Invalid run ID: "${runId}". Run IDs must not contain NUL bytes, slashes, or "..".`,
    });
  }
}

/**
 * Single-process, file-backed StateStore for local development and demos.
 *
 * 面向本地开发与演示场景的单进程文件持久化 StateStore。
 *
 * NOT safe for multi-process or multi-instance access to the same baseDir.
 * The promise mutex only serialises calls within one instance; concurrent
 * instances will NOT coordinate claimRunStart and may both return "created".
 * Production use should wait for the 0.3 SQLite StateStore.
 *
 * 不支持多进程或多实例并发访问。Promise 互斥锁仅在一个实例内串行化调用；
 * 并发实例不会协调 claimRunStart，可能都返回 "created"。
 * 生产环境请等待 0.3 的 SQLite StateStore。
 */
export class FileStateStore implements StateStore {
  private readonly runsDir: string;
  private readonly recordsDir: string;
  private mutex: Promise<void> = Promise.resolve();

  constructor(options: { baseDir: string }) {
    this.runsDir = join(options.baseDir, RUNS_DIR);
    this.recordsDir = join(options.baseDir, RECORDS_DIR);
  }

  async loadRun(runId: string): Promise<RunState | null> {
    return this.lock(async () => {
      await this.ensureDirs();
      return this.readJson<RunState>(this.runPath(runId));
    });
  }

  async saveRun(state: RunState): Promise<void> {
    return this.lock(async () => {
      await this.ensureDirs();
      await this.atomicWrite(this.runPath(state.run_id), state);
    });
  }

  async saveRunState(state: RunState): Promise<void> {
    return this.lock(async () => {
      await this.ensureDirs();
      await this.atomicWrite(this.runPath(state.run_id), state);

      const record = await this.readJson<RunRecord>(this.recordPath(state.run_id));
      if (record === null) return;

      record.updated_at = state.updated_at;
      if (state.phase === 'terminated') {
        record.completed_at = state.updated_at ?? record.updated_at;
      }
      await this.atomicWrite(this.recordPath(state.run_id), record);
    });
  }

  async loadRunRecord(runId: string): Promise<RunRecord | null> {
    return this.lock(async () => {
      await this.ensureDirs();
      return this.readJson<RunRecord>(this.recordPath(runId));
    });
  }

  async saveRunRecord(record: RunRecord): Promise<void> {
    return this.lock(async () => {
      await this.ensureDirs();
      await this.atomicWrite(this.recordPath(record.run_id), record);
    });
  }

  async claimRunStart(params: ClaimRunStartParams): Promise<ClaimRunStartResult> {
    return this.lock(async () => {
      await this.ensureDirs();
      const allRecords = await this.loadAllRecords();

      const idempotentRecord = allRecords.find((r) =>
        r.sop_id === params.record.sop_id
        && r.sop_version === params.record.sop_version
        && r.idempotency_key === params.record.idempotency_key,
      );
      if (idempotentRecord !== undefined) {
        const state = await this.readJson<RunState>(this.runPath(idempotentRecord.run_id));
        if (state !== null) {
          return { state, record: idempotentRecord, reason: 'idempotent_replay' };
        }
      }

      const completedByConcurrency = allRecords
        .filter((r) => matchesConcurrencyLookup(r, {
          sop_id: params.record.sop_id,
          sop_version: params.record.sop_version,
          key: params.record.concurrency_key,
        }))
        .filter((r) => r.completed_at !== undefined)
        .sort((a, b) => compareCompletedRecordTime(b, a));

      if (completedByConcurrency.length > 0) {
        const latest = completedByConcurrency[0]!;
        if (isCooldownActive({ record: latest, cooldown_secs: params.cooldown_secs, now: params.now })) {
          const state = await this.readJson<RunState>(this.runPath(latest.run_id));
          if (state !== null) {
            return { state, record: latest, reason: 'cooldown_active' };
          }
        }
      }

      const runningRecord = await this.findRunningByConcurrency(
        params.record.sop_id,
        params.record.sop_version,
        params.record.concurrency_key,
        allRecords,
      );
      if (runningRecord !== null && params.concurrency_mode === 'singleflight') {
        const state = await this.readJson<RunState>(this.runPath(runningRecord.run_id));
        if (state !== null) {
          return { state, record: runningRecord, reason: 'singleflight_joined' };
        }
      }
      if (runningRecord !== null && params.concurrency_mode === 'drop_if_running') {
        const state = await this.readJson<RunState>(this.runPath(runningRecord.run_id));
        if (state !== null) {
          return { state, record: runningRecord, reason: 'dropped_running' };
        }
      }

      const existingState = await this.readJson<RunState>(this.runPath(params.state.run_id));
      const existingRecord = await this.readJson<RunRecord>(this.recordPath(params.record.run_id));
      if (existingState !== null || existingRecord !== null) {
        throw new RuntimeError('run_id_conflict', {
          message: 'Run id is already claimed by a different start request.',
          details: { run_id: params.state.run_id },
        });
      }

      await this.atomicWrite(this.runPath(params.state.run_id), params.state);
      await this.atomicWrite(this.recordPath(params.record.run_id), params.record);
      return { state: params.state, record: params.record, reason: 'created' };
    });
  }

  async findRunByIdempotencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    return this.lock(async () => {
      await this.ensureDirs();
      const records = await this.loadAllRecords();
      const found = records.find((r) =>
        r.sop_id === lookup.sop_id
        && r.sop_version === lookup.sop_version
        && r.idempotency_key === lookup.key,
      );
      return found ?? null;
    });
  }

  async findRunningRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    return this.lock(async () => {
      await this.ensureDirs();
      const records = await this.loadAllRecords();
      return this.findRunningByConcurrency(lookup.sop_id, lookup.sop_version, lookup.key, records);
    });
  }

  async findLatestRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    return this.lock(async () => {
      await this.ensureDirs();
      const records = await this.loadAllRecords();
      let latest: RunRecord | null = null;
      for (const r of records) {
        if (!matchesConcurrencyLookup(r, lookup)) continue;
        if (latest === null || compareRecordTime(r, latest) > 0) {
          latest = r;
        }
      }
      return latest;
    });
  }

  private async findRunningByConcurrency(
    sopId: string,
    sopVersion: string,
    concurrencyKey: string,
    allRecords: RunRecord[],
  ): Promise<RunRecord | null> {
    const lookup: RunRecordLookup = { sop_id: sopId, sop_version: sopVersion, key: concurrencyKey };
    for (const record of allRecords) {
      if (!matchesConcurrencyLookup(record, lookup)) continue;
      const state = await this.readJson<RunState>(this.runPath(record.run_id));
      if (state?.status === 'running') return record;
    }
    return null;
  }

  private async loadAllRecords(): Promise<RunRecord[]> {
    try {
      const dir = await readdir(this.recordsDir);
      const records: RunRecord[] = [];
      for (const entry of dir) {
        if (!entry.endsWith('.json')) continue;
        const record = await this.readJson<RunRecord>(join(this.recordsDir, entry));
        if (record !== null) records.push(record);
      }
      return records;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  private runPath(runId: string): string {
    validateRunId(runId);
    return join(this.runsDir, `${runId}.json`);
  }

  private recordPath(runId: string): string {
    validateRunId(runId);
    return join(this.recordsDir, `${runId}.json`);
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.runsDir, { recursive: true });
    await mkdir(this.recordsDir, { recursive: true });
  }

  private async atomicWrite(filePath: string, data: unknown): Promise<void> {
    const tmp = filePath + '.tmp';
    await writeFile(tmp, JSON.stringify(data), 'utf-8');
    await rename(tmp, filePath);
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.mutex;
    let release: () => void;
    this.mutex = new Promise<void>((resolve) => { release = resolve; });
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}
