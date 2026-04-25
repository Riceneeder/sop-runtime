import {RunState} from '@sop-runtime/definition';
import {
  ClaimRunStartParams,
  ClaimRunStartResult,
  RunRecord,
  RunRecordLookup,
  StateStore,
} from './state_store.js';
import {RuntimeError} from './runtime_error.js';

/** Single-process StateStore implementation for tests and lightweight embedding. */
export class InMemoryStateStore implements StateStore {
  private readonly runs = new Map<string, RunState>();
  private readonly records = new Map<string, RunRecord>();

  async loadRun(runId: string): Promise<RunState | null> {
    const state = this.runs.get(runId);
    return state === undefined ? null : structuredClone(state);
  }

  async saveRun(state: RunState): Promise<void> {
    this.runs.set(state.run_id, structuredClone(state));
  }

  async saveRunState(state: RunState): Promise<void> {
    this.runs.set(state.run_id, structuredClone(state));

    const record = this.records.get(state.run_id);
    if (record === undefined) {
      return;
    }

    this.records.set(state.run_id, {
      ...record,
      'updated_at': state.updated_at,
      'completed_at': state.phase === 'terminated'
        ? state.updated_at ?? record.updated_at
        : record.completed_at,
    });
  }

  async loadRunRecord(runId: string): Promise<RunRecord | null> {
    const record = this.records.get(runId);
    return record === undefined ? null : structuredClone(record);
  }

  async saveRunRecord(record: RunRecord): Promise<void> {
    this.records.set(record.run_id, structuredClone(record));
  }

  async claimRunStart(params: ClaimRunStartParams): Promise<ClaimRunStartResult> {
    // Keep all start-policy checks and writes in one synchronous critical section.
    const idempotentRecord = this.findRecord((candidate) => {
      return candidate.sop_id === params.record.sop_id
        && candidate.sop_version === params.record.sop_version
        && candidate.idempotency_key === params.record.idempotency_key;
    });
    const idempotentState = idempotentRecord === null ? null : this.loadStateForRecord(idempotentRecord);
    if (idempotentRecord !== null && idempotentState !== null) {
      return {
        'state': structuredClone(idempotentState),
        'record': structuredClone(idempotentRecord),
        'reason': 'idempotent_replay',
      };
    }

    const latestCompletedRecord = this.findLatestCompletedRecordByConcurrencyKey({
      'sop_id': params.record.sop_id,
      'sop_version': params.record.sop_version,
      'key': params.record.concurrency_key,
    });
    if (
      latestCompletedRecord !== null
      && isCooldownActive({
        'record': latestCompletedRecord,
        'cooldown_secs': params.cooldown_secs,
        'now': params.now,
      })
    ) {
      const latestCompletedState = this.loadStateForRecord(latestCompletedRecord);
      if (latestCompletedState !== null) {
        return {
          'state': structuredClone(latestCompletedState),
          'record': structuredClone(latestCompletedRecord),
          'reason': 'cooldown_active',
        };
      }
    }

    const runningRecord = this.findRunningRecordByConcurrencyKey({
      'sop_id': params.record.sop_id,
      'sop_version': params.record.sop_version,
      'key': params.record.concurrency_key,
    });
    if (runningRecord !== null && params.concurrency_mode === 'singleflight') {
      const runningState = this.loadStateForRecord(runningRecord);
      if (runningState !== null) {
        return {
          'state': structuredClone(runningState),
          'record': structuredClone(runningRecord),
          'reason': 'singleflight_joined',
        };
      }
    }
    if (runningRecord !== null && params.concurrency_mode === 'drop_if_running') {
      const runningState = this.loadStateForRecord(runningRecord);
      if (runningState !== null) {
        return {
          'state': structuredClone(runningState),
          'record': structuredClone(runningRecord),
          'reason': 'dropped_running',
        };
      }
    }

    if (this.runs.has(params.state.run_id) || this.records.has(params.record.run_id)) {
      throw new RuntimeError('run_id_conflict', {
        'message': 'Run id is already claimed by a different start request.',
        'details': {'run_id': params.state.run_id},
      });
    }

    this.runs.set(params.state.run_id, structuredClone(params.state));
    this.records.set(params.record.run_id, structuredClone(params.record));
    return {
      'state': structuredClone(params.state),
      'record': structuredClone(params.record),
      'reason': 'created',
    };
  }

  async findRunByIdempotencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    const record = this.findRecord((candidate) => {
      return candidate.sop_id === lookup.sop_id
        && candidate.sop_version === lookup.sop_version
        && candidate.idempotency_key === lookup.key;
    });
    return record === null ? null : structuredClone(record);
  }

  async findRunningRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    const record = this.findRunningRecordByConcurrencyKey(lookup);
    return record === null ? null : structuredClone(record);
  }

  async findLatestRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    let latest: RunRecord | null = null;
    for (const record of this.records.values()) {
      if (!matchesConcurrencyLookup(record, lookup)) {
        continue;
      }

      if (latest === null || compareRecordTime(record, latest) > 0) {
        latest = record;
      }
    }

    return latest === null ? null : structuredClone(latest);
  }

  private findRecord(predicate: (record: RunRecord) => boolean): RunRecord | null {
    for (const record of this.records.values()) {
      if (predicate(record)) {
        return record;
      }
    }

    return null;
  }

  private findRunningRecordByConcurrencyKey(lookup: RunRecordLookup): RunRecord | null {
    for (const record of this.records.values()) {
      if (!matchesConcurrencyLookup(record, lookup)) {
        continue;
      }

      const state = this.runs.get(record.run_id);
      if (state?.status === 'running') {
        return record;
      }
    }

    return null;
  }

  private findLatestCompletedRecordByConcurrencyKey(lookup: RunRecordLookup): RunRecord | null {
    let latest: RunRecord | null = null;
    for (const record of this.records.values()) {
      if (!matchesConcurrencyLookup(record, lookup) || record.completed_at === undefined) {
        continue;
      }

      if (latest === null || compareCompletedRecordTime(record, latest) > 0) {
        latest = record;
      }
    }

    return latest;
  }

  private loadStateForRecord(record: RunRecord): RunState | null {
    return this.runs.get(record.run_id) ?? null;
  }
}

function matchesConcurrencyLookup(record: RunRecord, lookup: RunRecordLookup): boolean {
  return record.sop_id === lookup.sop_id
    && record.sop_version === lookup.sop_version
    && record.concurrency_key === lookup.key;
}

function compareRecordTime(left: RunRecord, right: RunRecord): number {
  return readRecordTime(left) - readRecordTime(right);
}

function compareCompletedRecordTime(left: RunRecord, right: RunRecord): number {
  return readCompletedRecordTime(left) - readCompletedRecordTime(right);
}

function readRecordTime(record: RunRecord): number {
  const timestamp = record.updated_at ?? record.created_at;
  if (timestamp === undefined) {
    return 0;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readCompletedRecordTime(record: RunRecord): number {
  if (record.completed_at === undefined) {
    return 0;
  }

  const parsed = Date.parse(record.completed_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCooldownActive(params: {
  record: RunRecord;
  cooldown_secs: number;
  now: string;
}): boolean {
  if (params.cooldown_secs <= 0 || params.record.completed_at === undefined) {
    return false;
  }

  const completedMs = Date.parse(params.record.completed_at);
  const nowMs = Date.parse(params.now);
  if (!Number.isFinite(completedMs) || !Number.isFinite(nowMs)) {
    return false;
  }

  return nowMs - completedMs < params.cooldown_secs * 1000;
}
