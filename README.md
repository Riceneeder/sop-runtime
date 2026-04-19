# sop-exec

SOP executor workspace built on Bun.

## Workspace

- `packages/definition`: shared DSL and runtime model types
- `packages/validator`: SOP definition admission checks
- `packages/core`: deterministic SOP state-machine semantics
- `packages/runtime`: runtime ports and thin orchestration contracts
- `docs/design`: design documents
- `references/google_typescript_styleguide`: local style guide mirror

## Conventions

- Use ES modules
- Use named exports only
- Do not use TypeScript namespaces
- Use `snake_case` file names
- Organize code by feature and package responsibility

## Tree

```text
.
├── README.md
├── docs
│   ├── design
│   └── superpowers
├── eslint.config.mjs
├── package.json
├── packages
│   ├── core
│   ├── definition
│   ├── runtime
│   └── validator
├── references
│   └── google_typescript_styleguide
├── tsconfig.base.json
└── tsconfig.json
```
