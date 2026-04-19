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
