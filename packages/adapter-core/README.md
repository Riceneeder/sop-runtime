# @sop-runtime/adapter-core

Shared adapter types and helpers for building sop-runtime executor adapters.

## Positioning

`adapter-core` provides the foundational types and utilities that executor adapter packages (e.g. shell, agent, HTTP) can depend on. It sits between `core` and `runtime` in the dependency chain:

```
definition → validator → core → adapter-core → runtime
```

`@sop-runtime/runtime` re-exports all adapter-core public API for convenience, so consumers can import everything from `@sop-runtime/runtime` if they already depend on it.

## Exports

### Types

- `ExecutorHandler` — adapter handler function signature
- `ExecutorHandlerInput` — input passed to a handler when a step is dispatched
- `RuntimeStepPacket` — resolved step execution packet (re-exported from core)
- `ExecutorResult` — raw step result (= `StepResult` from definition)
- `StepExecutor` — adapter boundary interface
- `ExecutorAdapter` — full adapter interface with metadata
- `ExecutorAdapterRegistration` — registration entry type
- `ExecutorConfigResolver` — config template resolver signature

### StepResult Builders

- `buildSuccessResult(packet, output, artifacts?)`
- `buildToolErrorResult(packet, code, message, details?)`
- `buildTimeoutResult(packet, message, details?)`
- `buildSandboxErrorResult(packet, code, message, details?)`

### Error Helpers

- `AdapterError` — typed error class for adapter failures
- `normalizeAdapterError(error)` — convert unknown errors to AdapterError
- `buildErrorDetails(base, extra)` — merge error detail objects

### Config Readers

- `assertJsonObject(value, path?)` — assert a value is a JsonObject
- `getRequiredString(config, key)` — read required string config
- `getOptionalString(config, key)` — read optional string config
- `getOptionalStringArray(config, key)` — read optional string array
- `getOptionalJsonObject(config, key)` — read optional nested object
- `getOptionalBoolean(config, key)` — read optional boolean
- `getOptionalStringRecord(config, key)` — read optional string record

### Redaction

- `redactSecrets(input, sensitiveKeys?)` — immutable recursive redaction of sensitive fields
- `REDACTED_VALUE` — the replacement sentinel string (`'***'`)

### Timeout & Resource Enforcement

- `executeHandlerWithTimeout(handler, timeoutSecs)` — execute with timeout guard
- `enforceResourceLimits(params)` — check output size and artifact count limits
- `computeJsonUtf8Size(value)` — compute UTF-8 byte length of a JSON object
- `normalizeTimeoutMs(timeoutSecs)` — normalize seconds to ms, clamped to MAX_SET_TIMEOUT_MS
- `MAX_SET_TIMEOUT_MS` — max setTimeout value (2,147,483,647 ms)

### Config Template Resolution

- `resolveExecutorConfigTemplate(params)` — resolve expression templates in executor config

## Minimal Usage

```ts
import {
  type ExecutorHandler,
  buildSuccessResult,
  buildToolErrorResult,
  executeHandlerWithTimeout,
  resolveExecutorConfigTemplate,
} from '@sop-runtime/adapter-core';

const handler: ExecutorHandler = async (ctx) => {
  const config = resolveExecutorConfigTemplate({
    config: ctx.config,
    context: { run: ctx.state },
  });

  const outcome = await executeHandlerWithTimeout(
    () => executeMyTool(ctx.packet.inputs, config),
    ctx.packet.executor.timeout_secs,
  );

  if (outcome.kind === 'timeout') {
    return buildTimeoutResult(ctx.packet, 'My tool timed out.');
  }
  if (outcome.kind === 'error') {
    return buildToolErrorResult(ctx.packet, 'my_tool_failed', String(outcome.error));
  }

  return buildSuccessResult(ctx.packet, outcome.result);
};
```
