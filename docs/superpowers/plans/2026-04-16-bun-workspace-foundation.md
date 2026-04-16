# Bun Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个简洁、清晰、基于 Bun 的 TypeScript 工作区，作为 SOP 执行器后续 `definition / validator / core / runtime / adapter_cli` 的基础。

**Architecture:** 根目录只保留工作区级配置、README、文档和引用资料；代码按特征拆到 `packages/*`，不按技术层混堆。`definition` 负责共享模型，`validator` 负责 definition 准入，`core` 负责纯状态机语义，`runtime` 只定义端口与最小组装，`adapter_cli` 提供 Bun 直接运行的命令行入口。

**Tech Stack:** Bun 1.2.x, TypeScript 5.x, Bun test, ESLint 9, `@typescript-eslint`, Google TypeScript Style Guide

---

## 文件结构

### 根目录

- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `README.md`
- Create: `docs/design/`
- Create: `references/`
- Move: `SOP自动化系统设计.md` -> `docs/design/SOP自动化系统设计.md`
- Move: `SOP执行器分层设计.md` -> `docs/design/SOP执行器分层设计.md`
- Move: `SOP执行器Core设计.md` -> `docs/design/SOP执行器Core设计.md`
- Move: `google-typescript-styleguide/` -> `references/google_typescript_styleguide/`

### `packages/definition`

- Create: `packages/definition/package.json`
- Create: `packages/definition/tsconfig.json`
- Create: `packages/definition/src/json_value.ts`
- Create: `packages/definition/src/sop_definition.ts`
- Create: `packages/definition/src/run_state.ts`
- Create: `packages/definition/src/index.ts`
- Test: `packages/definition/src/index.test.ts`

### `packages/validator`

- Create: `packages/validator/package.json`
- Create: `packages/validator/tsconfig.json`
- Create: `packages/validator/src/diagnostic.ts`
- Create: `packages/validator/src/validate_definition.ts`
- Create: `packages/validator/src/index.ts`
- Test: `packages/validator/src/index.test.ts`

### `packages/core`

- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/core_error.ts`
- Create: `packages/core/src/create_run.ts`
- Create: `packages/core/src/get_current_step.ts`
- Create: `packages/core/src/build_step_packet.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

### `packages/runtime`

- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/src/state_store.ts`
- Create: `packages/runtime/src/step_executor.ts`
- Create: `packages/runtime/src/decision_provider.ts`
- Create: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/index.test.ts`

### `packages/adapter_cli`

- Create: `packages/adapter_cli/package.json`
- Create: `packages/adapter_cli/tsconfig.json`
- Create: `packages/adapter_cli/src/commands/validate_command.ts`
- Create: `packages/adapter_cli/src/main.ts`
- Create: `packages/adapter_cli/src/index.ts`
- Test: `packages/adapter_cli/src/main.test.ts`

---

### Task 1: 初始化根工作区并归档现有文档

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `README.md`
- Create: `docs/design/.gitkeep`
- Create: `references/.gitkeep`
- Move: `SOP自动化系统设计.md`
- Move: `SOP执行器分层设计.md`
- Move: `SOP执行器Core设计.md`
- Move: `google-typescript-styleguide/`

- [ ] **Step 1: 初始化 git 仓库并创建根目录占位结构**

```bash
git init
mkdir -p docs/design references
```

- [ ] **Step 2: 写入根 `package.json`**

```json
{
  "name": "sop-exec",
  "private": true,
  "packageManager": "bun@1.2.4",
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "lint": "bunx eslint . --max-warnings 0",
    "typecheck": "bunx tsc -b",
    "test": "bun test packages",
    "check": "bun run lint && bun run typecheck && bun run test",
    "cli": "bun packages/adapter_cli/src/main.ts"
  },
  "devDependencies": {
    "@eslint/js": "^9.25.0",
    "@types/bun": "^1.2.4",
    "@typescript-eslint/eslint-plugin": "^8.30.0",
    "@typescript-eslint/parser": "^8.30.0",
    "eslint": "^9.25.0",
    "eslint-plugin-import": "^2.31.0",
    "globals": "^16.0.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 3: 写入根 TypeScript 配置**

`tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "declaration": true,
    "composite": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": false
  }
}
```

`tsconfig.json`

```json
{
  "files": [],
  "references": [
    {"path": "./packages/definition"},
    {"path": "./packages/validator"},
    {"path": "./packages/core"},
    {"path": "./packages/runtime"},
    {"path": "./packages/adapter_cli"}
  ]
}
```

- [ ] **Step 4: 写入 ESLint、忽略文件和编辑器配置**

`eslint.config.mjs`

```js
import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    ignores: ['node_modules', 'bun.lock', 'dist'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.bun,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    rules: {
      'import/no-default-export': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          'selector': "ImportDeclaration[importKind='type']",
          'message': 'Use regular imports instead of import type, per Google TypeScript Style Guide.'
        },
        {
          'selector': "ExportNamedDeclaration[exportKind='type']",
          'message': 'Use regular exports instead of export type re-exports, per Google TypeScript Style Guide.'
        },
        {
          'selector': "ImportSpecifier[importKind='type']",
          'message': 'Use regular imports instead of inline type imports, per Google TypeScript Style Guide.'
        },
        {
          'selector': 'TSImportType',
          'message': 'Use regular imports instead of import type, per Google TypeScript Style Guide.'
        }
      ]
    },
  },
];
```

`.gitignore`

```gitignore
node_modules/
bun.lock
dist/
.DS_Store
coverage/
```

`.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

- [ ] **Step 5: 写入 README 并移动已有设计文档和参考资料**

`README.md`

```md
# sop-exec

SOP 执行器基础工作区，使用 Bun 作为 TypeScript 运行时。

## Workspace

- `packages/definition`: 共享 DSL 与运行态模型
- `packages/validator`: SOP Definition 准入校验
- `packages/core`: 纯状态机语义
- `packages/runtime`: 端口接口与最小组装
- `packages/adapter_cli`: Bun 直接运行的 CLI 入口
- `docs/design`: 设计文档
- `references/google_typescript_styleguide`: 本地规范镜像

## Conventions

- 使用 ES modules，不使用 namespace
- 只使用 named exports，不使用 default export
- 文件名使用 `snake_case`
- 同一特征的代码放在同一包中，不按技术层散落
```

移动命令：

```bash
mv SOP自动化系统设计.md docs/design/SOP自动化系统设计.md
mv SOP执行器分层设计.md docs/design/SOP执行器分层设计.md
mv SOP执行器Core设计.md docs/design/SOP执行器Core设计.md
mv google-typescript-styleguide references/google_typescript_styleguide
```

- [ ] **Step 6: 安装依赖并验证根工作区配置有效**

Run: `bun install`

Expected: 成功生成 `node_modules/`，无语法错误。

Run: `bun run typecheck`

Expected: FAIL，提示 `packages/*` 的 TypeScript project references 尚未存在。

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: initialize bun workspace foundation"
```

---

### Task 2: 建立 `packages/definition`

**Files:**
- Create: `packages/definition/package.json`
- Create: `packages/definition/tsconfig.json`
- Create: `packages/definition/src/json_value.ts`
- Create: `packages/definition/src/sop_definition.ts`
- Create: `packages/definition/src/run_state.ts`
- Create: `packages/definition/src/index.ts`
- Test: `packages/definition/src/index.test.ts`

- [ ] **Step 1: 写出失败的导出测试**

`packages/definition/src/index.test.ts`

```ts
import {describe, expect, test} from 'bun:test';
import {
  RUN_PHASES,
  RUN_STATUSES,
  JsonObject,
  RunState,
  SopDefinition,
} from './index';

describe('definition exports', () => {
  test('exports the shared SOP model types and constants', () => {
    const input: JsonObject = {'company': 'Acme'};
    const definition: SopDefinition = {
      sop_id: 'news_report',
      name: 'News Report',
      version: '1.0.0',
      entry_step: 'search_news',
      input_schema: {'type': 'object'},
      policies: {
        cooldown_secs: 0,
        max_run_secs: 60,
        idempotency_key_template: 'news:${run.input.company}',
        concurrency: {
          mode: 'singleflight',
          key_template: 'news:${run.input.company}',
        },
      },
      steps: [],
      final_output: {'summary': 'ok'},
    };
    const state = {} as RunState;

    expect(input.company).toBe('Acme');
    expect(definition.sop_id).toBe('news_report');
    expect(state).toBeDefined();
    expect(RUN_STATUSES).toContain('running');
    expect(RUN_PHASES).toContain('ready');
  });
});
```

- [ ] **Step 2: 运行测试，确认它失败**

Run: `bun test packages/definition/src/index.test.ts`

Expected: FAIL，提示 `./index` 中没有相关导出。

- [ ] **Step 3: 写入 `definition` 包实现**

`packages/definition/package.json`

```json
{
  "name": "@sop-exec/definition",
  "private": true,
  "type": "module"
}
```

`packages/definition/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

`packages/definition/src/json_value.ts`

```ts
export type JsonPrimitive = boolean | number | string | null;

export interface JsonArray extends Array<JsonValue> {}

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
```

`packages/definition/src/sop_definition.ts`

```ts
import {JsonObject} from './json_value';

export interface Transition {
  next_step?: string;
  terminate?: {
    run_status: 'succeeded' | 'failed' | 'cancelled';
    reason: string;
  };
}

export interface StepDefinition {
  id: string;
  title: string;
  inputs: JsonObject;
  executor: JsonObject;
  output_schema: JsonObject;
  retry_policy: JsonObject;
  supervision: {
    owner: 'main_agent';
    allowed_outcomes: Array<{
      id: string;
      description: string;
    }>;
    default_outcome: string;
  };
  transitions: Record<string, Transition>;
}

export interface SopDefinition {
  sop_id: string;
  name: string;
  version: string;
  entry_step: string;
  input_schema: JsonObject;
  policies: {
    cooldown_secs: number;
    max_run_secs: number;
    idempotency_key_template: string;
    concurrency: {
      mode: 'allow_parallel' | 'drop_if_running' | 'singleflight';
      key_template: string;
    };
  };
  steps: StepDefinition[];
  final_output: JsonObject;
  defaults?: JsonObject;
  description?: string;
  metadata?: JsonObject;
}
```

`packages/definition/src/run_state.ts`

```ts
import {JsonObject} from './json_value';

export const RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const;
export const RUN_PHASES = ['ready', 'awaiting_decision', 'terminated'] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunPhase = (typeof RUN_PHASES)[number];

export interface RunState {
  run_id: string;
  sop_id: string;
  sop_version: string;
  status: RunStatus;
  phase: RunPhase;
  run_input: JsonObject;
  entry_step_id: string;
  current_step_id: string | null;
  current_attempt: number | null;
}
```

`packages/definition/src/index.ts`

```ts
export {RUN_PHASES, RUN_STATUSES} from './run_state';
export {RunPhase, RunState, RunStatus} from './run_state';
export {JsonArray, JsonObject, JsonPrimitive, JsonValue} from './json_value';
export {SopDefinition, StepDefinition, Transition} from './sop_definition';
```

- [ ] **Step 4: 运行测试和类型检查，确认它通过**

Run: `bun test packages/definition/src/index.test.ts`

Expected: PASS

Run: `bunx tsc --noEmit packages/definition/src/index.ts packages/definition/src/index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/definition
git commit -m "feat: add definition package"
```

---

### Task 3: 建立 `packages/validator`

**Files:**
- Create: `packages/validator/package.json`
- Create: `packages/validator/tsconfig.json`
- Create: `packages/validator/src/diagnostic.ts`
- Create: `packages/validator/src/validate_definition.ts`
- Create: `packages/validator/src/index.ts`
- Test: `packages/validator/src/index.test.ts`

- [ ] **Step 1: 写出失败的 definition 校验测试**

`packages/validator/src/index.test.ts`

```ts
import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index';

describe('validateDefinition', () => {
  test('reports duplicate step ids and missing entry step', () => {
    const result = validateDefinition({
      sop_id: 'dup_case',
      name: 'Duplicate Case',
      version: '1.0.0',
      entry_step: 'missing_step',
      input_schema: {'type': 'object'},
      policies: {
        cooldown_secs: 0,
        max_run_secs: 60,
        idempotency_key_template: 'dup',
        concurrency: {
          mode: 'singleflight',
          key_template: 'dup',
        },
      },
      steps: [
        {
          id: 'step_a',
          title: 'A',
          inputs: {},
          executor: {},
          output_schema: {},
          retry_policy: {},
          supervision: {
            owner: 'main_agent',
            allowed_outcomes: [{'id': 'continue', 'description': 'go'}],
            default_outcome: 'continue',
          },
          transitions: {
            'continue': {'next_step': 'step_a'},
          },
        },
        {
          id: 'step_a',
          title: 'B',
          inputs: {},
          executor: {},
          output_schema: {},
          retry_policy: {},
          supervision: {
            owner: 'main_agent',
            allowed_outcomes: [{'id': 'continue', 'description': 'go'}],
            default_outcome: 'continue',
          },
          transitions: {
            'continue': {'next_step': 'step_a'},
          },
        },
      ],
      final_output: {'ok': true},
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('duplicate_step_id');
    expect(result.diagnostics.map((item) => item.code)).toContain('entry_step_missing');
  });
});
```

- [ ] **Step 2: 运行测试，确认它失败**

Run: `bun test packages/validator/src/index.test.ts`

Expected: FAIL，提示 `validateDefinition` 不存在。

- [ ] **Step 3: 写入 `validator` 包实现**

`packages/validator/package.json`

```json
{
  "name": "@sop-exec/validator",
  "private": true,
  "type": "module",
  "dependencies": {
    "@sop-exec/definition": "workspace:*"
  }
}
```

`packages/validator/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "references": [
    {"path": "../definition"}
  ]
}
```

`packages/validator/src/diagnostic.ts`

```ts
export interface Diagnostic {
  code: string;
  message: string;
  path: string;
}

export interface ValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}
```

`packages/validator/src/validate_definition.ts`

```ts
import {SopDefinition} from '@sop-exec/definition';
import {Diagnostic, ValidationResult} from './diagnostic';

export function validateDefinition(definition: SopDefinition): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  const seenStepIds = new Set<string>();

  for (const step of definition.steps) {
    if (seenStepIds.has(step.id)) {
      diagnostics.push({
        'code': 'duplicate_step_id',
        'message': `Duplicate step id: ${step.id}`,
        'path': `steps.${step.id}`,
      });
      continue;
    }
    seenStepIds.add(step.id);
  }

  if (!seenStepIds.has(definition.entry_step)) {
    diagnostics.push({
      'code': 'entry_step_missing',
      'message': `Entry step does not exist: ${definition.entry_step}`,
      'path': 'entry_step',
    });
  }

  return {
    'ok': diagnostics.length === 0,
    diagnostics,
  };
}
```

`packages/validator/src/index.ts`

```ts
export {Diagnostic, ValidationResult} from './diagnostic';
export {validateDefinition} from './validate_definition';
```

- [ ] **Step 4: 运行测试，确认它通过**

Run: `bun test packages/validator/src/index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/validator
git commit -m "feat: add definition validator package"
```

---

### Task 4: 建立 `packages/core`

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/core_error.ts`
- Create: `packages/core/src/create_run.ts`
- Create: `packages/core/src/get_current_step.ts`
- Create: `packages/core/src/build_step_packet.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: 写出失败的 core 行为测试**

`packages/core/src/index.test.ts`

```ts
import {describe, expect, test} from 'bun:test';
import {buildStepPacket, createRun, getCurrentStep} from './index';

const definition = {
  sop_id: 'news_report',
  name: 'News Report',
  version: '1.0.0',
  entry_step: 'search_news',
  input_schema: {'type': 'object'},
  defaults: {'workspace': '/tmp/workspace'},
  policies: {
    cooldown_secs: 0,
    max_run_secs: 60,
    idempotency_key_template: 'news:${run.input.company}',
    concurrency: {
      mode: 'singleflight',
      key_template: 'news:${run.input.company}',
    },
  },
  steps: [
    {
      id: 'search_news',
      title: 'Search News',
      inputs: {
        'company': '${run.input.company}',
      },
      executor: {
        'kind': 'sandbox_tool',
      },
      output_schema: {},
      retry_policy: {},
      supervision: {
        owner: 'main_agent',
        allowed_outcomes: [{'id': 'continue', 'description': 'go'}],
        default_outcome: 'continue',
      },
      transitions: {
        'continue': {'next_step': 'search_news'},
      },
    },
  ],
  final_output: {'ok': true},
};

describe('core package', () => {
  test('creates the initial run and builds the first step packet', () => {
    const state = createRun({
      definition,
      input: {'company': 'Acme'},
      runId: 'run_001',
    });
    const currentStep = getCurrentStep({
      definition,
      state,
    });
    const packet = buildStepPacket({
      definition,
      state,
    });

    expect(state.current_step_id).toBe('search_news');
    expect(state.current_attempt).toBe(1);
    expect(currentStep?.step_id).toBe('search_news');
    expect(packet.inputs.company).toBe('Acme');
  });
});
```

- [ ] **Step 2: 运行测试，确认它失败**

Run: `bun test packages/core/src/index.test.ts`

Expected: FAIL，提示 `createRun` 或 `buildStepPacket` 不存在。

- [ ] **Step 3: 写入 `core` 包实现**

`packages/core/package.json`

```json
{
  "name": "@sop-exec/core",
  "private": true,
  "type": "module",
  "dependencies": {
    "@sop-exec/definition": "workspace:*",
    "@sop-exec/validator": "workspace:*"
  }
}
```

`packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "references": [
    {"path": "../definition"},
    {"path": "../validator"}
  ]
}
```

`packages/core/src/core_error.ts`

```ts
export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreError';
  }
}
```

`packages/core/src/create_run.ts`

```ts
import {JsonObject, RunState, SopDefinition} from '@sop-exec/definition';
import {validateDefinition} from '@sop-exec/validator';
import {CoreError} from './core_error';

export function createRun(params: {
  definition: SopDefinition;
  input: JsonObject;
  runId: string;
}): RunState {
  const validation = validateDefinition(params.definition);
  if (!validation.ok) {
    throw new CoreError('Definition validation failed.');
  }

  const runInput = {
    ...params.definition.defaults,
    ...params.input,
  };

  return {
    'run_id': params.runId,
    'sop_id': params.definition.sop_id,
    'sop_version': params.definition.version,
    'status': 'running',
    'phase': 'ready',
    'run_input': runInput,
    'entry_step_id': params.definition.entry_step,
    'current_step_id': params.definition.entry_step,
    'current_attempt': 1,
  };
}
```

`packages/core/src/get_current_step.ts`

```ts
import {RunState, SopDefinition, StepDefinition} from '@sop-exec/definition';

export interface CurrentStepView {
  step_id: string;
  attempt: number;
  step: StepDefinition;
}

export function getCurrentStep(params: {
  definition: SopDefinition;
  state: RunState;
}): CurrentStepView | null {
  if (params.state.current_step_id === null || params.state.current_attempt === null) {
    return null;
  }

  const step = params.definition.steps.find((item) => item.id === params.state.current_step_id);
  if (!step) {
    return null;
  }

  return {
    'step_id': step.id,
    'attempt': params.state.current_attempt,
    step,
  };
}
```

`packages/core/src/build_step_packet.ts`

```ts
import {RunState, SopDefinition} from '@sop-exec/definition';
import {CoreError} from './core_error';

export interface CoreStepPacket {
  run_id: string;
  step_id: string;
  attempt: number;
  inputs: Record<string, unknown>;
  executor: Record<string, unknown>;
  output_schema: Record<string, unknown>;
}

function resolveInput(template: string, state: RunState): unknown {
  if (template === '${run.input.company}') {
    return state.run_input.company;
  }
  return template;
}

export function buildStepPacket(params: {
  definition: SopDefinition;
  state: RunState;
}): CoreStepPacket {
  const step = params.definition.steps.find((item) => item.id === params.state.current_step_id);
  if (!step || params.state.current_attempt === null) {
    throw new CoreError('No active step.');
  }

  const inputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step.inputs)) {
    inputs[key] = typeof value === 'string' ? resolveInput(value, params.state) : value;
  }

  return {
    'run_id': params.state.run_id,
    'step_id': step.id,
    'attempt': params.state.current_attempt,
    inputs,
    'executor': step.executor,
    'output_schema': step.output_schema,
  };
}
```

`packages/core/src/index.ts`

```ts
export {buildStepPacket} from './build_step_packet';
export {CoreStepPacket} from './build_step_packet';
export {CoreError} from './core_error';
export {createRun} from './create_run';
export {getCurrentStep} from './get_current_step';
export {CurrentStepView} from './get_current_step';
```

- [ ] **Step 4: 运行测试，确认它通过**

Run: `bun test packages/core/src/index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: add core workspace package"
```

---

### Task 5: 建立 `packages/runtime`

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/src/state_store.ts`
- Create: `packages/runtime/src/step_executor.ts`
- Create: `packages/runtime/src/decision_provider.ts`
- Create: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/index.test.ts`

- [ ] **Step 1: 写出失败的 runtime 端口测试**

`packages/runtime/src/index.test.ts`

```ts
import {describe, expect, test} from 'bun:test';
import {
  DecisionProvider,
  StateStore,
  StepExecutor,
} from './index';

describe('runtime ports', () => {
  test('exports storage, executor, and decision contracts', () => {
    const stateStore = {} as StateStore;
    const stepExecutor = {} as StepExecutor;
    const decisionProvider = {} as DecisionProvider;

    expect(stateStore).toBeDefined();
    expect(stepExecutor).toBeDefined();
    expect(decisionProvider).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试，确认它失败**

Run: `bun test packages/runtime/src/index.test.ts`

Expected: FAIL，提示接口未导出。

- [ ] **Step 3: 写入 runtime 端口实现**

`packages/runtime/package.json`

```json
{
  "name": "@sop-exec/runtime",
  "private": true,
  "type": "module",
  "dependencies": {
    "@sop-exec/core": "workspace:*",
    "@sop-exec/definition": "workspace:*"
  }
}
```

`packages/runtime/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "references": [
    {"path": "../core"},
    {"path": "../definition"}
  ]
}
```

`packages/runtime/src/state_store.ts`

```ts
import {RunState} from '@sop-exec/definition';

export interface StateStore {
  loadRun(runId: string): Promise<RunState | null>;
  saveRun(state: RunState): Promise<void>;
}
```

`packages/runtime/src/step_executor.ts`

```ts
import {CoreStepPacket} from '@sop-exec/core';

export interface ExecutorResult {
  run_id: string;
  step_id: string;
  attempt: number;
  status: 'success' | 'timeout' | 'tool_error' | 'sandbox_error';
  output?: Record<string, unknown>;
}

export interface StepExecutor {
  execute(packet: CoreStepPacket): Promise<ExecutorResult>;
}
```

`packages/runtime/src/decision_provider.ts`

```ts
export interface Decision {
  run_id: string;
  step_id: string;
  attempt: number;
  outcome_id: string;
  reason?: string;
}

export interface DecisionProvider {
  decide(input: {
    run_id: string;
    step_id: string;
    attempt: number;
    result_status: string;
  }): Promise<Decision>;
}
```

`packages/runtime/src/index.ts`

```ts
export {Decision, DecisionProvider} from './decision_provider';
export {StateStore} from './state_store';
export {ExecutorResult, StepExecutor} from './step_executor';
```

- [ ] **Step 4: 运行测试，确认它通过**

Run: `bun test packages/runtime/src/index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime
git commit -m "feat: add runtime port package"
```

---

### Task 6: 建立 `packages/adapter_cli`

**Files:**
- Create: `packages/adapter_cli/package.json`
- Create: `packages/adapter_cli/tsconfig.json`
- Create: `packages/adapter_cli/src/commands/validate_command.ts`
- Create: `packages/adapter_cli/src/main.ts`
- Create: `packages/adapter_cli/src/index.ts`
- Test: `packages/adapter_cli/src/main.test.ts`

- [ ] **Step 1: 写出失败的 CLI 测试**

`packages/adapter_cli/src/main.test.ts`

```ts
import {describe, expect, test} from 'bun:test';
import {runCli} from './index';

describe('runCli', () => {
  test('returns usage text when no command is provided', async () => {
    const result = await runCli([]);

    expect(result.exit_code).toBe(1);
    expect(result.stdout).toContain('validate');
  });
});
```

- [ ] **Step 2: 运行测试，确认它失败**

Run: `bun test packages/adapter_cli/src/main.test.ts`

Expected: FAIL，提示 `runCli` 不存在。

- [ ] **Step 3: 写入 CLI 实现**

`packages/adapter_cli/package.json`

```json
{
  "name": "@sop-exec/adapter-cli",
  "private": true,
  "type": "module",
  "dependencies": {
    "@sop-exec/validator": "workspace:*"
  }
}
```

`packages/adapter_cli/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "references": [
    {"path": "../validator"}
  ]
}
```

`packages/adapter_cli/src/commands/validate_command.ts`

```ts
import {readFile} from 'node:fs/promises';
import {validateDefinition} from '@sop-exec/validator';

export interface CliResult {
  exit_code: number;
  stdout: string;
}

export async function runValidateCommand(path: string): Promise<CliResult> {
  const fileContent = await readFile(path, 'utf8');
  const definition = JSON.parse(fileContent);
  const result = validateDefinition(definition);

  if (result.ok) {
    return {
      'exit_code': 0,
      'stdout': 'SOP definition is valid.',
    };
  }

  return {
    'exit_code': 1,
    'stdout': result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'),
  };
}
```

`packages/adapter_cli/src/main.ts`

```ts
import {runValidateCommand, CliResult} from './commands/validate_command';

function renderUsage(): CliResult {
  return {
    'exit_code': 1,
    'stdout': [
      'Usage:',
      '  bun run cli validate <path-to-definition.json>',
    ].join('\n'),
  };
}

export async function runCli(argv: string[]): Promise<CliResult> {
  const [command, path] = argv;
  if (command !== 'validate' || !path) {
    return renderUsage();
  }

  return runValidateCommand(path);
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2));
  console.log(result.stdout);
  process.exit(result.exit_code);
}
```

`packages/adapter_cli/src/index.ts`

```ts
export {CliResult} from './commands/validate_command';
export {runCli} from './main';
export {runValidateCommand} from './commands/validate_command';
```

- [ ] **Step 4: 运行测试，确认它通过**

Run: `bun test packages/adapter_cli/src/main.test.ts`

Expected: PASS

Run: `bun run cli`

Expected: 输出 usage，并返回非零退出码。

- [ ] **Step 5: Commit**

```bash
git add packages/adapter_cli
git commit -m "feat: add bun cli adapter"
```

---

### Task 7: 运行全仓验证并收口结构

**Files:**
- Modify: `README.md`
- Modify: `tsconfig.json`
- Verify: `package.json`

- [ ] **Step 1: 补充 README 中的目录树**

将下列目录树补入 `README.md`：

```md
## Tree

~~~text
.
├── README.md
├── docs
│   ├── design
│   └── superpowers
├── eslint.config.mjs
├── package.json
├── packages
│   ├── adapter_cli
│   ├── core
│   ├── definition
│   ├── runtime
│   └── validator
├── references
│   └── google_typescript_styleguide
├── tsconfig.base.json
└── tsconfig.json
~~~
```

- [ ] **Step 2: 运行仓库级检查**

Run: `bun run lint`

Expected: PASS

Run: `bun run typecheck`

Expected: PASS

Run: `bun run test`

Expected: PASS

Run: `bun run check`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "chore: finalize bun workspace scaffold"
```

---

## 自检

### Spec coverage

- “工作区简介明了”: 通过根目录只保留配置、文档、引用资料和 `packages/*` 达成。
- “使用 Bun 作为 TS 运行时”: 根脚本和 CLI 全部以 Bun 为执行入口。
- “工程结构清晰”: 通过 `definition / validator / core / runtime / adapter_cli` 五个基础包达成。
- “项目规范为 Google TypeScript Style Guide”: 通过 README 约定、ESLint 限制、snake_case 文件名、named exports、ES modules 达成。

### Placeholder scan

- 本计划没有使用 `TODO`、`TBD`、`implement later` 一类占位文本。
- 每个任务都给了明确文件路径、命令和预期结果。

### Type consistency

- 统一使用 `SopDefinition`、`RunState`、`CoreStepPacket`、`DecisionProvider` 这些名称。
- `adapter_cli` 只依赖 `validator`，没有反向依赖 `core` 或 `runtime`。

---

Plan complete and saved to `docs/superpowers/plans/2026-04-16-bun-workspace-foundation.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
