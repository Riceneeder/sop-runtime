# 0.1-alpha Contract

Public packages: `@sop-runtime/definition`, `@sop-runtime/validator`, `@sop-runtime/core`, `@sop-runtime/runtime`, `@sop-runtime/cli`.

`sop-runtime` is an embedded deterministic SOP execution kernel. It is not a full workflow platform, not a distributed worker scheduler, and does not provide sandboxing by itself.

Runtime guarantees focus on deterministic state transitions in single-process embedding.

Non-guarantees in 0.1-alpha: multi-worker safety, lease/CAS coordination, hard cancellation of underlying executor work without separate AbortSignal handling.

`InMemoryStateStore` is for tests, demos, and single-process embedding only.

`executor.config` is opaque by default. Core renders step inputs only; adapters may opt into `resolveExecutorConfigTemplate`.

CLI limitations: local JSON only, minimal demo executor (`tool/echo`) only.

Verification commands:
- `bun run check`
- `bun run pack:dry-run`
- `bun run smoke:cli`
- `bun run check:alpha`
