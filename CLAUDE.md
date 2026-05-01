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


# Global Agent Rules

## Language

Default to Chinese in user-facing replies unless the user explicitly requests another language.

## Response Style

Do not propose follow-up tasks or enhancement at the end of your final answer.

## Debug-First Policy (No Silent Fallbacks)

- Do **not** introduce new boundary rules / guardrails / blockers / caps (e.g. max-turns), fallback behaviors, or silent degradation **just to make it run**.
- Do **not** add mock/simulation fake success paths (e.g. returning `(mock) ok`, templated outputs that bypass real execution, or swallowing errors).
- Do **not** write defensive or fallback code; it does not solve the root problem and only increases debugging cost.
- Prefer **full exposure**: let failures surface clearly (explicit errors, exceptions, logs, failing tests) so bugs are visible and can be fixed at the root cause.
- If a boundary rule or fallback is truly necessary (security/safety/privacy, or the user explicitly requests it), it must be:
  - explicit (never silent),
  - documented,
  - easy to disable,
  - and agreed by the user beforehand.

## Engineering Quality Baseline

- Follow SOLID, DRY, separation of concerns, and YAGNI.
- Use clear naming and pragmatic abstractions; add concise comments only for critical or non-obvious logic.
- Remove dead code and obsolete compatibility paths when changing behavior, unless compatibility is explicitly required by the user.
- Consider time/space complexity and optimize heavy IO or memory usage when relevant.
- Handle edge cases explicitly; do not hide failures.

## Code Metrics (Hard Limits)

- **Function length**: 50 lines (excluding blanks). Exceeded  extract helper immediately.
- **File size**: 300 lines. Exceeded  split by responsibility.
- **Nesting depth**: 3 levels. Use early returns / guard clauses to flatten.
- **Parameters**: 3 positional. More  use a config/options object.
- **Cyclomatic complexity**: 10 per function. More  decompose branching logic.
- **No magic numbers**: extract to named constants (`MAX_RETRIES = 3`, not bare `3`).

## Decoupling & Immutability

- **Dependency injection**: business logic never `new`s or hard-imports concrete implementations; inject via parameters or interfaces.
- **Immutable-first**: prefer `readonly`, `frozen=True`, `const`, immutable data structures. Never mutate function parameters or global state; return new values.

## Security Baseline

- Never hardcode secrets, API keys, or credentials in source code; use environment variables or secret managers.
- Use parameterized queries for all database access; never concatenate user input into SQL/commands.
- Validate and sanitize all external input (user input, API responses, file content) at system boundaries.
- **Conversation keys  code leaks**: When the user shares an API key in conversation (e.g. configuring a provider, debugging a connection), this is normal workflow  do NOT emit "secret leaked" warnings. Only alert when a key is written into a source code file. Frontend display is already masked; no need to remind repeatedly.

## Testing and Validation

- Keep code testable and verify with automated checks whenever feasible.
- When running backend unit tests, enforce a hard timeout of 60 seconds to avoid stuck tasks.
- Prefer static checks, formatting, and reproducible verification over ad-hoc manual confidence.
