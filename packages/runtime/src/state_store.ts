import {RunState} from '@sop-runtime/definition';

/** Metadata indexed beside each persisted run snapshot. */
export interface RunRecord {
  run_id: string;
  sop_id: string;
  sop_version: string;
  idempotency_key: string;
  concurrency_key: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
}

/** Lookup key scoped to one SOP identity and version. */
export interface RunRecordLookup {
  sop_id: string;
  sop_version: string;
  key: string;
}

/** Why a start request returned the selected run. */
export type RunStartClaimReason =
  | 'created'
  | 'idempotent_replay'
  | 'singleflight_joined'
  | 'dropped_running'
  | 'cooldown_active';

/** Inputs for the atomic start claim performed by a StateStore. */
export interface ClaimRunStartParams {
  state: RunState;
  record: RunRecord;
  concurrency_mode: 'allow_parallel' | 'drop_if_running' | 'singleflight';
  cooldown_secs: number;
  now: string;
}

/** Result of an atomic start claim. */
export interface ClaimRunStartResult {
  state: RunState;
  record: RunRecord;
  reason: RunStartClaimReason;
}

/**
 * Persistence boundary used by RuntimeHost.
 *
 * Implementations must make claimRunStart atomic for a single start request:
 * exactly one caller may create a fresh run for a run_id / policy key set, and
 * all other callers must observe an existing idempotent, running, or cooldown
 * run instead of overwriting it.
 */
export interface StateStore {
  loadRun(runId: string): Promise<RunState | null>;
  /** Low-level snapshot write. Prefer saveRunState for host-managed updates. */
  saveRun(state: RunState): Promise<void>;
  /** Saves a run snapshot and updates the matching RunRecord timestamps. */
  saveRunState(state: RunState): Promise<void>;
  loadRunRecord(runId: string): Promise<RunRecord | null>;
  saveRunRecord(record: RunRecord): Promise<void>;
  /** Atomically creates, reuses, joins, drops, or cooldown-rejects a run start. */
  claimRunStart(params: ClaimRunStartParams): Promise<ClaimRunStartResult>;
  findRunByIdempotencyKey(lookup: RunRecordLookup): Promise<RunRecord | null>;
  findRunningRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null>;
  findLatestRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null>;
}
