# CHANGELOG

## Unreleased

### 0.3.0-alpha.0

- **AbortSignal 支持**: `ExecutorHandlerInput.signal`、`DecisionProvider.decide()` signal、runtime 级 deadline abort
- **StateStore CAS**: 新增 `loadRunSnapshot` 方法，`saveRun`/`saveRunState` 支持 `expected_revision` 参数
- **SQLite 重构**: 显式 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`，版本 revision 不污染 RunState JSON
- **RuntimeHost revision 串联**: `requireRunSnapshot` helper，所有 9 个 saveRunState 调用点传递 expected_revision
- **DecisionProvider 取消**: 根据 `max_run_secs` 构建 deadline AbortSignal，deadline 到期时 abort signal
- **dispatchExecutor 优化**: 移除成功路径的多余 `abortController.abort()` 调用
- **SqliteEventSink**: SQLite 后端 EventSink 实现
- **DefinitionRegistry**: 轻量内存 definition 注册表
- **多 worker 安全文档**: `docs/design/multi_worker_safety.md`
- 36 个新测试，共 508 个测试全部通过
- 版本号统一升至 `0.3.0-alpha.0`

### 0.2.4-alpha.0

- Add `smoke:shell` / `smoke:agent` / `smoke:http` / `smoke:file` smoke test scripts under `scripts/`, each exercising the corresponding adapter via `RuntimeHost`.
- Add `smoke:adapter` and `check:adapter` root scripts for serial adapter smoke and full check+smoke.
- Add `examples/shell_workflow/`, `examples/agent_workflow/`, `examples/http_workflow/`, `examples/file_workflow/` with valid SOP definitions and input examples.
- Bump all workspace packages and CLI version to `0.2.4-alpha.0`.
- Sync README, ROADMAP, CHANGELOG with current implementation state.

### 0.2.3-alpha.0

- Add `RuleBasedDecisionProvider` — rule-based decision provider with expression template conditions and first-match-wins semantics.
- Add `RuleBasedDecisionRule` type for configuring rule-based outcomes.
- Add `JsonlEventSink` — JSONL file event sink with promise-queued serialised writes.
- Add `FileStateStore` — file-backed `StateStore` for local dev/demo scenarios using atomic writes (temp-file + rename).
- Extract `state_store_helpers.ts` from `InMemoryStateStore` for shared pure functions (`isCooldownActive`, `matchesConcurrencyLookup`, etc.).

### 0.1.0-alpha.0
- Prepare definition/validator/core/runtime package metadata for alpha dry-run packaging.
- Export schema and example artifacts from `@sop-runtime/definition`.
- Add minimal `@sop-runtime/cli` with `validate`, `trace`, and `run`.
- Add runtime helper `resolveExecutorConfigTemplate` for adapter-owned executor config template resolution.
- Add alpha-focused docs and verification scripts.
