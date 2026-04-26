import {RunState} from '@sop-runtime/definition';

/** Metadata indexed beside each persisted run snapshot. 与每份持久化运行快照并行索引的元数据。 */
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

/** Lookup key scoped to one SOP identity and version. 作用于单个 SOP 标识与版本范围内的查询键。 */
export interface RunRecordLookup {
  sop_id: string;
  sop_version: string;
  key: string;
}

/** Why a start request returned the selected run. 启动请求返回该运行实例的原因。 */
export type RunStartClaimReason =
  | 'created'
  | 'idempotent_replay'
  | 'singleflight_joined'
  | 'dropped_running'
  | 'cooldown_active';

/** Inputs for the atomic start claim performed by a StateStore. StateStore 执行原子化启动占位时的输入参数。 */
export interface ClaimRunStartParams {
  state: RunState;
  record: RunRecord;
  concurrency_mode: 'allow_parallel' | 'drop_if_running' | 'singleflight';
  cooldown_secs: number;
  now: string;
}

/** Result of an atomic start claim. 原子化启动占位操作的结果。 */
export interface ClaimRunStartResult {
  state: RunState;
  record: RunRecord;
  reason: RunStartClaimReason;
}

/**
 * Persistence boundary used by RuntimeHost.
 * RuntimeHost 使用的持久化边界接口。
 *
 * Implementations must make claimRunStart atomic for a single start request:
 * exactly one caller may create a fresh run for a run_id / policy key set, and
 * all other callers must observe an existing idempotent, running, or cooldown
 * run instead of overwriting it.
 * 实现必须保证 claimRunStart 对单次启动请求是原子操作：
 * 对于同一组 run_id / 策略键，只允许一个调用方创建新运行；
 * 其余调用方必须观察到既有的幂等复用、运行中或冷却中的运行，而不是覆盖它。
 */
export interface StateStore {
  loadRun(runId: string): Promise<RunState | null>;
  /** Low-level snapshot write. Prefer saveRunState for host-managed updates. 低层快照写入；若由 host 管理更新，优先使用 saveRunState。 */
  saveRun(state: RunState): Promise<void>;
  /** Saves a run snapshot and updates the matching RunRecord timestamps. 保存运行快照并更新对应 RunRecord 的时间戳。 */
  saveRunState(state: RunState): Promise<void>;
  loadRunRecord(runId: string): Promise<RunRecord | null>;
  saveRunRecord(record: RunRecord): Promise<void>;
  /** Atomically creates, reuses, joins, drops, or cooldown-rejects a run start. 以原子方式执行创建、复用、并入、丢弃或冷却拒绝等启动决策。 */
  claimRunStart(params: ClaimRunStartParams): Promise<ClaimRunStartResult>;
  findRunByIdempotencyKey(lookup: RunRecordLookup): Promise<RunRecord | null>;
  findRunningRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null>;
  findLatestRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null>;
}
