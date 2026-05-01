# Repository Guidelines

## Project Structure & Module Organization
This Bun workspace is organized by package responsibility under `packages/`. The active packages in this worktree are `definition`, `validator`, `core`, and `runtime`; public entrypoints live at `packages/*/src/index.ts`, and build artifacts are emitted to `packages/*/dist`. Keep tests beside implementation in each package’s `src/` directory using `*.test.ts` files, for example `packages/core/src/index.test.ts`. Repo-level docs live in `docs/design/`, and the local TypeScript style reference is mirrored in `references/google_typescript_styleguide/`.

The dependency flow is intentionally one-way: `definition -> validator -> core -> runtime`. If a change affects shared SOP vocabulary or state shapes, start in `packages/definition` first. Root `tsconfig.json` coordinates the workspace with project references.

## Build, Test, and Development Commands
- `bun install`: install workspace dependencies.
- `bun run lint`: run ESLint with zero warnings allowed.
- `bun run typecheck`: type-check all referenced packages with `tsc -b`.
- `bun run test`: run all package tests with Bun.
- `bun run check`: full verification (`lint`, `typecheck`, and `test`).
- `bun test packages/definition/src/index.test.ts`: run one test file.
- `bun test packages/core/src --test-name-pattern "createRun"`: run a focused test subset.
- `bun run cli -- validate path/to/definition.json`: validate a definition from the CLI when the CLI package is present on your branch.

## Coding Style & Naming Conventions
Use TypeScript with ES modules, named exports, and `snake_case` file names. Follow the existing 2-space indentation and semicolon style. ESLint forbids default exports, TypeScript namespaces, `any`, and `import type`; use regular imports for types. Import across packages with workspace aliases such as `@sop-runtime/core`, not relative cross-package paths.

## Testing Guidelines
Tests use `bun:test` and live next to the code they cover. Add or update tests with every behavior change, especially when touching shared contracts in `definition`, `validator`, `core`, or `runtime`. There is no published coverage gate, so contributors are expected to run `bun run check` before opening a PR.

## Commit & Pull Request Guidelines
Recent commits use conventional prefixes such as `feat:`, `refactor:`, and `chore:`. Keep subjects imperative and concise; the history already mixes English and short Chinese summaries, so consistency matters more than language choice. PRs should explain affected packages, call out schema or runtime contract changes, link related issues, and list the exact verification commands you ran. Include sample input/output when changing validation or CLI behavior.

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
