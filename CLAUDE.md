# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build, Test, and Lint Commands

- `bun install` — install workspace dependencies
- `bun run check` — full verification (lint + typecheck + test)
- `bun run lint` — ESLint with zero warnings allowed
- `bun run typecheck` — type-check all referenced packages with `tsc -b`
- `bun run test` — run all package tests with Bun
- `bun test packages/<pkg>/src/<file>.test.ts` — run a single test file
- `bun test packages/<pkg>/src --test-name-pattern "pattern"` — run focused tests

## Architecture

This is a **Bun workspace** (`bun@1.2.4`) with four packages arranged in a strict one-way dependency chain:

```
definition → validator → core → runtime
```

- **definition** (`packages/definition`) — Shared SOP DSL types (`SopDefinition`, `StepDefinition`, `RunState`, `StepState`, `HistoryEntry`, `JsonObject`), execution types (`StepPacket`, `StepResult`, `AcceptedStepResult`, `Decision`, `FinalOutput`), and expression parsing (`parseExpressionTemplate`, `parseExpressionBody`). Also exports const arrays (`RUN_STATUSES`, `RUN_PHASES`, `STEP_LIFECYCLES`, `RETRYABLE_STEP_RESULT_STATUSES`) and their union types.
- **validator** (`packages/validator`) — Entry point `validateDefinition(definition)` runs schema → semantic → expression validation in fixed order and returns `{ ok, diagnostics }`. Also exports `validateRuntimeValue` for runtime output schema checking.
- **core** (`packages/core`) — Pure state machine functions with no I/O: `createRun`, `buildStepPacket`, `applyStepResult`, `applyDecision`, `renderFinalOutput`, `evaluateExpressionTemplate`. Each validates preconditions and throws typed `CoreError` on rejection. `applyStepResult` validates executor output against the step's `output_schema` via `validateRuntimeValue`.
- **runtime** (`packages/runtime`) — `RuntimeHost` is the embeddable orchestrator. It wires core functions to pluggable ports: `StateStore` (persistence, atomic `claimRunStart`), `StepExecutor`, `DecisionProvider`, `Clock`, `IdGenerator`, `RuntimeLogger`, `EventSink`. `runUntilComplete` loops: `ready` phase → execute step → `awaiting_decision` phase → apply decision → repeat until terminated or step guard exceeded. Also includes `ToolRegistryExecutor` (dispatches `sandbox_tool` packets to host-registered handlers) and `InMemoryStateStore`.

**Key design points:**
- `RunState` is an append-only snapshot — history entries (`run_created`, `step_result_accepted`, `decision_applied`, `run_terminated`) record every state transition.
- `buildStepPacket` resolves expression templates in step inputs and executor config before calling the executor.
- Policy keys (idempotency, concurrency) are rendered from expression templates via `evaluateExpressionTemplate` and must evaluate to strings.
- `RuntimeHost` does NOT implement distributed step leases — callers must avoid concurrent driving of the same run unless their `StateStore` adds coordination.

## Workspace Aliases

Import across packages using workspace aliases, never relative paths:

```ts
import { SopDefinition, RunState } from '@sop-runtime/definition';
import { validateDefinition } from '@sop-runtime/validator';
import { createRun, applyStepResult } from '@sop-runtime/core';
import { RuntimeHost, InMemoryStateStore } from '@sop-runtime/runtime';
```

## Coding Conventions

- ES modules, named exports only (no `export default` — enforced by ESLint)
- `snake_case` file names, 2-space indentation, semicolons
- `import type` is forbidden — use regular imports for types
- `any` and TypeScript namespaces are forbidden
- Test files live beside source as `*.test.ts` using `bun:test`
- Unused variables must be prefixed with `_`
- The ESLint config disallows default exports, namespaces, `any`, and `import type` — verify with `bun run lint` (zero warnings)

## Commit Style

Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `style:`, `docs:`. Keep subjects imperative and concise.
