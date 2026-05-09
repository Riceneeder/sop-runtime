# CHANGELOG

## Unreleased

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
