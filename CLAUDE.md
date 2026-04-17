# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This repository is a Bun + TypeScript workspace monorepo.

- Install dependencies: `bun install`
- Lint all packages: `bun run lint`
- Type-check all packages: `bun run typecheck`
- Run all tests: `bun run test`
- Run the full validation suite: `bun run check`
- Run the CLI locally: `bun run cli -- validate <path-to-definition.json>`

Single-test patterns:

- Run one test file: `bun test packages/definition/src/index.test.ts`
- Run one package test folder: `bun test packages/runtime/src`
- Run tests matching a name: `bun test packages/core/src --test-name-pattern "createRun"`

## Architecture

The repo is split into small workspace packages with a layered dependency direction:

- `packages/definition`: the source of truth for the SOP domain model. It defines SOP definitions, executor config shapes, run state, step/result types, and expression parsing. If a change affects the schema or state machine vocabulary, it usually starts here.
- `packages/validator`: validates `SopDefinition` objects from `@sop-exec/definition`. Today it is structural and lightweight (for example duplicate step IDs and missing entry step), and higher layers call it before creating runs.
- `packages/core`: orchestrates definition validation and run-state creation. This package turns a validated SOP definition plus input into a `RunState`, exposes current-step helpers, and builds the packet passed to execution.
- `packages/runtime`: defines the runtime boundary/ports. `StepExecutor` consumes the `CoreStepPacket` produced by core and returns a `StepResult`. Decision/state-store interfaces also live here.
- `packages/adapter_cli`: thin CLI adapter around validator functionality. The current CLI entrypoint is `validate`.

The intended flow is:

1. A SOP definition is modeled with `@sop-exec/definition` types.
2. `@sop-exec/validator` checks it.
3. `@sop-exec/core` creates a `RunState` and execution packet for the active step.
4. `@sop-exec/runtime` provides the executor/state-management boundary for actually running a step.
5. `@sop-exec/adapter-cli` exposes validation as a Bun CLI command.

## Project structure notes

- The root `tsconfig.json` uses project references; package builds/type-checking are coordinated from the workspace root.
- Import packages through workspace aliases such as `@sop-exec/core` and `@sop-exec/definition`, not via relative cross-package paths.
- ESLint forbids default exports and `import type`; use named exports and regular imports.
- The repo currently has no root `README.md`, no root `.cursorrules`, no `.cursor/rules/`, and no `.github/copilot-instructions.md`.
- There is active in-progress work in this repository around richer execution/state modeling, especially in `packages/definition`, `packages/core`, `packages/runtime`, and `packages/validator`. Read current code before assuming older interfaces are still stable.
