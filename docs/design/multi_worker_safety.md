# Multi-Worker Safety & Concurrency Model

## 问题

RuntimeHost 支持多种 StateStore 实现，其中 `InMemoryStateStore` 和 `FileStateStore` 假设单进程单 worker。当多个 worker 实例驱动同一 run 时可能出现竞争：

1. **重复 step 执行** — 两个 worker 同时加载同一 RunState，执行同一 step，产生冲突的 accepted_results
2. **丢失决策** — 两个 worker 同时调用 `applyDecision`，后一个覆盖前一个
3. **重复创建** — 两个 worker 同时调用 `claimRunStart` 对同一 idempotency_key 都返回 created

## 防护机制

### 1. claimRunStart 事务串行化 (SQLite StateStore)

`claimRunStart` 运行在 `BEGIN IMMEDIATE` 事务中。IMMEDIATE 模式在事务开始时获得写锁，阻止所有其他写入者。事务内部依次执行幂等检查、冷却检查、并发检查、run_id 冲突检查，最后插入新行。整个操作对并发调用方呈现原子性：

```
Worker A: BEGIN IMMEDIATE → check idempotency → not found → INSERT → COMMIT → created
Worker B: BEGIN IMMEDIATE → (waits for A) → check idempotency → found → COMMIT → idempotent_replay
```

结果：**多个 worker 同时启动同一 run 时，恰好一个获得 created，其余全部获得 idempotent_replay**，不会出现重复创建。

### 2. 版本 CAS (Compare-And-Swap)

`runs` 表包含 `version` 列，每次 `UPDATE` 时自动递增。`saveRun` 和 `saveRunState` 通过 `options.expected_revision` 参数接收预期版本：

```typescript
const snapshot = await store.loadRunSnapshot(runId);
// snapshot.revision === String(version from SQLite)

await store.saveRunState(updatedState, { expected_revision: snapshot.revision });
```

对应的 SQL：

```sql
UPDATE runs SET state = ?, version = version + 1, updated_at = ?
WHERE run_id = ? AND version = ?;
```

如果 `changes() = 0`，说明版本不匹配（其他 worker 已修改），抛出 `cas_conflict` 错误。

```
Worker A 加载 run (revision "5")
Worker B 加载 run (revision "5")
Worker A 保存 (WHERE version=5 → 6) 成功
Worker B 保存 (WHERE version=5) 失败 → cas_conflict
```

#### CAS 不覆盖的场景

- **loadRun 是无锁的** — 两个 worker 可以同时加载同一个 run。只有 save 时会检测冲突
- **claimRunStart 不受 CAS 保护** — 它有自己的事务串行化机制
- **只读操作不会触发 CAS**
- **不传 `expected_revision` 时不做 CAS 检查** — 用于明确不需要并发保护的写入路径

### 3. 唯一索引

`records` 表在 `(sop_id, sop_version, idempotency_key)` 上有唯一索引，确保：

- 即使绕过 `claimRunStart` 直接插入记录，也会因唯一约束失败
- `INSERT OR REPLACE` 在语义替换时会保留 idempotency 的语义正确性

## 单 Run 多 Worker 安全模型

### 推荐模式：一个 worker 驱动一个 run

最安全的模式是确保每个 run 只被一个 worker 驱动。RuntimeHost 本身不假设分布式协调，以下方案按推荐优先级排列：

#### 方案 A：应用层分区 (推荐)

确保每个 run 只被一个 worker 加载和执行：

```
worker-1: run_001, run_003, run_005
worker-2: run_002, run_004, run_006
```

这在启动时通过 run ID 哈希分区实现，不需要分布式锁。

#### 方案 B：CAS 安全网 (0.3-alpha)

RuntimeHost 内部通过 `requireRunSnapshot` 加载 revision，并在所有保存路径中传递 `expected_revision`。如果发生 CAS 冲突，`saveRunState` 抛出 `cas_conflict` 异常。调用方应捕获并重新加载最新状态：

```typescript
try {
  await host.runUntilComplete({ definition, runId });
} catch (err) {
  if (err instanceof RuntimeError && err.code === 'cas_conflict') {
    const { state, revision } = await store.loadRunSnapshot(runId);
    // 决定是否从最新状态继续
  }
}
```

CAS 是安全网不是协调机制——它不能防止工作重复，只能检测冲突。

## Step/Decision Lease 设计 (RFC)

### 问题

当前 0.3-alpha 的 CAS 只能检测 save 时的冲突，不能防止两个 worker 同时执行同一个 step。Lease 机制可以在执行前获取排他锁。

### 设计

```sql
CREATE TABLE IF NOT EXISTS leases (
  lease_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  lease_type TEXT NOT NULL,    -- 'step' | 'decision'
  worker_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_leases_run_step ON leases(run_id, step_id, lease_type);
```

### 工作流

1. **Acquire** — worker 在执行 step 前尝试 INSERT lease。唯一约束或主键冲突防止多个 worker 获得同一 step 的 lease
2. **Renew** — worker 定期更新 `expires_at` 以表明存活
3. **Release** — worker 完成 step 后 DELETE lease
4. **Timeout** — 如果 lease 过期 (`expires_at < now`)，其他 worker 可以接管（通过 UPDATE 或 DELETE + INSERT）

### 决策 lease

与 step lease 类似，在 `applyDecision` 或 `decideOutcome` 前获取。防止两个 worker 同时为同一 step 做出不同决策。

### 未实现

0.3-alpha **不实现** lease 机制。上述设计作为 RFC 保留给未来版本。当前 CAS 机制已经提供了冲突检测的基本安全网。

## 进程重启恢复

### SQLite StateStore

进程重启后，新的 worker 可以直接加载持久化的 RunState：

```typescript
const store = new SqliteStateStore({ dbPath: '/data/runs.db' });
const state = await store.loadRun(runId);
```

重启后评估步骤：

1. 如果 `state.phase === 'terminated'` — run 已完成，不需要继续
2. 如果 `state.phase === 'ready'` — worker 可以从 `state.current_step_id` 恢复执行
3. 如果 `state.phase === 'awaiting_decision'` — worker 需要决策后再执行下一 step
4. 如果 `state.phase === 'paused'` — 等待外部恢复指令

### 孤儿 run 检测

如果 worker 在 step 执行过程中崩溃，run 可能卡在 `running` 状态但没有任何 worker 驱动它。检测和恢复方案：

1. **心跳表** — workers 定期更新 `heartbeat` 行。如果超过阈值未更新，判定 worker 死亡
2. **Run 超时** — `max_run_secs` 策略会在 run 超过最大时长时自动终止
3. **Lease 超时** — (未来) 如果 step lease 过期，其他 worker 可以接管

当前 0.3-alpha 依赖 `max_run_secs` 作为兜底终止机制。

## 总结

| 机制 | 范围 | 0.3-alpha 状态 |
|------|------|----------------|
| claimRunStart 事务 | 创建/复用 run | 已实现（SQLite StateStore） |
| 版本 CAS | run state 写入 | 已实现（SQLite StateStore + RuntimeHost 串联） |
| 唯一索引 | idempotency key | 已实现（SQLite StateStore） |
| Step lease | 排他 step 执行 | 设计 RFC，未实现 |
| Decision lease | 排他决策 | 设计 RFC，未实现 |
| Worker 心跳 | 崩溃检测 | 未实现 |
| max_run_secs | run 超时兜底 | 已实现（RuntimeHost） |
