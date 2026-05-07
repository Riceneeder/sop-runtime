# executor.config in 0.1-alpha

`executor.config` is handler-owned opaque JSON by default.
Core/runtime do not automatically render expressions in `executor.config`.
Validator does not validate expression references inside `executor.config`.

Use `resolveExecutorConfigTemplate({ config, context: { run } })` in adapters when explicit template rendering is required. Import from `@sop-runtime/adapter-core` (or via re-export from `@sop-runtime/runtime`).
