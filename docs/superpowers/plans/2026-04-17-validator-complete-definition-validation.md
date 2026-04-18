# Validator Complete Definition Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement complete SOP definition validation in `packages/validator` by covering the design document JSON Schema plus semantic and expression validation while keeping the public validator API unchanged.

**Architecture:** Keep `validateDefinition()` as the single public entrypoint and split implementation into three internal validators: schema, semantic, and expression. Schema validation enforces the documented SOP Definition shape from `docs/design/SOP自动化系统设计.md`, semantic validation checks cross-step invariants, and expression validation parses template strings with `@sop-exec/definition` expression parsers and validates referenced step ids.

**Tech Stack:** Bun, TypeScript, Bun test, workspace package `@sop-exec/definition`

---

## File Structure

- Modify: `packages/validator/src/validate_definition.ts`
  - Keep orchestration only: call schema, semantic, expression validators and combine diagnostics.
- Create: `packages/validator/src/schema_validator.ts`
  - Handwritten validation for the documented SOP Definition schema.
- Create: `packages/validator/src/semantic_validator.ts`
  - Cross-field and cross-step validation that assumes structurally valid input.
- Create: `packages/validator/src/expression_validator.ts`
  - Parse template strings and validate expression references.
- Create: `packages/validator/src/path.ts`
  - Small helper for building stable diagnostic paths without duplicating string formatting.
- Modify: `packages/validator/src/index.test.ts`
  - Replace the minimal test with grouped coverage for schema, semantic, and expression behavior.

## Notes For The Implementer

- Do **not** change `packages/validator/src/index.ts` or `packages/validator/src/diagnostic.ts` unless a task below explicitly says so.
- Keep the public return shape as:

```ts
export interface ValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}
```

- Prefer deterministic diagnostics ordering by visiting fields in source order and steps in array order.
- Schema validation should catch shape/type/required/enum/pattern/min constraints from `docs/design/SOP自动化系统设计.md:611-970`.
- Semantic validation should cover `docs/design/SOP自动化系统设计.md:977-987` items 1-5 only.
- Expression validation should cover parseability plus known-step references, but **not** graph reachability analysis.

---

### Task 1: Add reusable path helpers

**Files:**
- Create: `packages/validator/src/path.ts`
- Modify: `packages/validator/src/validate_definition.ts`
- Test: `packages/validator/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test block near the top of `packages/validator/src/index.test.ts`:

```ts
test('reports stable paths for top-level and nested validation errors', () => {
  const result = validateDefinition({
    'sop_id': 'ok_id',
    'name': 'Test',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': '',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'same',
      },
    },
    'steps': [],
    'final_output': {},
  });

  expect(result.ok).toBe(false);
  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({'path': 'policies.idempotency_key_template'}),
    expect.objectContaining({'path': 'steps'}),
    expect.objectContaining({'path': 'final_output'}),
  ]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "reports stable paths"`
Expected: FAIL because the current validator only reports duplicate step and missing entry step diagnostics.

- [ ] **Step 3: Write minimal implementation**

Create `packages/validator/src/path.ts` with:

```ts
export function joinPath(...parts: Array<number | string | undefined>): string {
  return parts
    .filter((part) => part !== undefined && part !== '')
    .map((part) => String(part))
    .join('.');
}
```

Update `packages/validator/src/validate_definition.ts` to use validator arrays and prepare for internal modules:

```ts
import {SopDefinition} from '@sop-exec/definition';
import {Diagnostic, ValidationResult} from './diagnostic';
import {validateExpressionDefinition} from './expression_validator';
import {validateSchemaDefinition} from './schema_validator';
import {validateSemanticDefinition} from './semantic_validator';

export function validateDefinition(definition: SopDefinition): ValidationResult {
  const diagnostics: Diagnostic[] = [
    ...validateSchemaDefinition(definition),
    ...validateSemanticDefinition(definition),
    ...validateExpressionDefinition(definition),
  ];

  return {
    'ok': diagnostics.length === 0,
    diagnostics,
  };
}
```

Stub the new validator modules temporarily so the file compiles:

```ts
import {SopDefinition} from '@sop-exec/definition';
import {Diagnostic} from './diagnostic';

export function validateSchemaDefinition(_definition: SopDefinition): Diagnostic[] {
  return [];
}
```

Use the same temporary stub body for `validateSemanticDefinition` and `validateExpressionDefinition`.

- [ ] **Step 4: Run test to verify it still fails for the right reason**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "reports stable paths"`
Expected: FAIL because schema rules are still unimplemented, but the package compiles with the new structure.

- [ ] **Step 5: Commit**

```bash
git add packages/validator/src/path.ts packages/validator/src/validate_definition.ts packages/validator/src/schema_validator.ts packages/validator/src/semantic_validator.ts packages/validator/src/expression_validator.ts packages/validator/src/index.test.ts
git commit -m "refactor: split validator into internal stages"
```

---

### Task 2: Implement top-level and policy schema validation

**Files:**
- Modify: `packages/validator/src/schema_validator.ts`
- Test: `packages/validator/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these tests to `packages/validator/src/index.test.ts`:

```ts
test('reports top-level required, pattern, and min constraints', () => {
  const result = validateDefinition({
    'sop_id': 'bad id',
    'name': '',
    'version': '1',
    'entry_step': 'BadStep',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': -1,
      'max_run_secs': 0,
      'idempotency_key_template': '',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': '',
      },
    },
    'steps': [],
    'final_output': {},
  });

  expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
    'schema_pattern',
    'schema_min_length',
    'schema_minimum',
    'schema_min_items',
    'schema_min_properties',
  ]));
});

test('reports unknown top-level and policy fields', () => {
  const result = validateDefinition({
    'sop_id': 'valid_id',
    'name': 'Valid',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 1,
      'idempotency_key_template': 'key',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'same',
        'extra': 'boom',
      },
      'extra_policy': true,
    },
    'steps': [{
      'id': 'step_a',
      'title': 'A',
      'inputs': {},
      'executor': {
        'kind': 'sandbox_tool',
        'tool': 'web_search',
        'command_template': 'Search',
        'path': '/tmp/workspace',
        'timeout_secs': 120,
        'allow_network': true,
        'env': {},
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
      'output_schema': {},
      'retry_policy': {
        'max_attempts': 1,
        'backoff_secs': [],
        'retry_on': [],
      },
      'supervision': {
        'owner': 'main_agent',
        'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
        'default_outcome': 'continue',
      },
      'transitions': {
        'continue': {'next_step': 'step_a'},
      },
      'extra_step': true,
    }],
    'final_output': {'summary': 'ok'},
    'extra_root': true,
  } as never);

  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({'code': 'schema_additional_property', 'path': 'extra_root'}),
    expect.objectContaining({'code': 'schema_additional_property', 'path': 'policies.extra_policy'}),
    expect.objectContaining({'code': 'schema_additional_property', 'path': 'policies.concurrency.extra'}),
    expect.objectContaining({'code': 'schema_additional_property', 'path': 'steps.0.extra_step'}),
  ]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "top-level|required|unknown top-level"`
Expected: FAIL because schema validation is still a stub.

- [ ] **Step 3: Write minimal implementation**

Replace `packages/validator/src/schema_validator.ts` with this implementation skeleton and top-level/policies validation:

```ts
import {RETRYABLE_STEP_RESULT_STATUSES, SopDefinition} from '@sop-exec/definition';
import {Diagnostic} from './diagnostic';
import {joinPath} from './path';

const ROOT_KEYS = new Set([
  'sop_id',
  'name',
  'version',
  'description',
  'entry_step',
  'input_schema',
  'defaults',
  'policies',
  'steps',
  'final_output',
  'metadata',
]);

const POLICY_KEYS = new Set([
  'cooldown_secs',
  'max_run_secs',
  'idempotency_key_template',
  'concurrency',
]);

const CONCURRENCY_KEYS = new Set(['mode', 'key_template']);
const STEP_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const SOP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const OUTCOME_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export function validateSchemaDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  validateRoot(definition, diagnostics);
  validatePolicies(definition.policies, diagnostics);
  validateSteps(definition.steps, diagnostics);
  validateFinalOutput(definition.final_output, diagnostics);

  return diagnostics;
}

function validateRoot(definition: SopDefinition, diagnostics: Diagnostic[]): void {
  pushUnknownKeys(definition as Record<string, unknown>, ROOT_KEYS, '', diagnostics);
  requireNonEmptyString(definition.sop_id, 'sop_id', diagnostics);
  requirePattern(definition.sop_id, SOP_ID_PATTERN, 'sop_id', diagnostics);
  requireNonEmptyString(definition.name, 'name', diagnostics);
  requireNonEmptyString(definition.version, 'version', diagnostics);
  requirePattern(definition.version, VERSION_PATTERN, 'version', diagnostics);
  requireNonEmptyString(definition.entry_step, 'entry_step', diagnostics);
  requirePattern(definition.entry_step, STEP_ID_PATTERN, 'entry_step', diagnostics);
  requireObject(definition.input_schema, 'input_schema', diagnostics);
  if (definition.defaults !== undefined) {
    requireObject(definition.defaults, 'defaults', diagnostics);
  }
  if (definition.description !== undefined) {
    requireString(definition.description, 'description', diagnostics);
  }
  if (definition.metadata !== undefined) {
    requireObject(definition.metadata, 'metadata', diagnostics);
  }
  requireArrayWithMinItems(definition.steps, 1, 'steps', diagnostics);
}

function validatePolicies(policies: SopDefinition['policies'], diagnostics: Diagnostic[]): void {
  requireObject(policies, 'policies', diagnostics);
  pushUnknownKeys(policies as Record<string, unknown>, POLICY_KEYS, 'policies', diagnostics);
  requireIntegerAtLeast(policies.cooldown_secs, 0, 'policies.cooldown_secs', diagnostics);
  requireIntegerAtLeast(policies.max_run_secs, 1, 'policies.max_run_secs', diagnostics);
  requireNonEmptyString(policies.idempotency_key_template, 'policies.idempotency_key_template', diagnostics);
  requireObject(policies.concurrency, 'policies.concurrency', diagnostics);
  pushUnknownKeys(policies.concurrency as Record<string, unknown>, CONCURRENCY_KEYS, 'policies.concurrency', diagnostics);
  requireEnum(
    policies.concurrency.mode,
    ['singleflight', 'allow_parallel', 'drop_if_running'],
    'policies.concurrency.mode',
    diagnostics,
  );
  requireNonEmptyString(policies.concurrency.key_template, 'policies.concurrency.key_template', diagnostics);
}

function validateFinalOutput(value: unknown, path: string, diagnostics?: Diagnostic[]): void {
  const target = diagnostics ?? [];
  requireObject(value, path ?? 'final_output', target);
  if (isPlainObject(value) && Object.keys(value).length === 0) {
    target.push({
      'code': 'schema_min_properties',
      'message': 'Expected at least 1 property.',
      'path': path ?? 'final_output',
    });
  }
}
```

Then add the helper functions below in the same file:

```ts
function validateSteps(_steps: SopDefinition['steps'], _diagnostics: Diagnostic[]): void {}

function pushUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  basePath: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push({
        'code': 'schema_additional_property',
        'message': `Unexpected property: ${key}`,
        'path': joinPath(basePath, key),
      });
    }
  }
}

function requireArrayWithMinItems(value: unknown, minItems: number, path: string, diagnostics: Diagnostic[]): void {
  if (!Array.isArray(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected array.', 'path': path});
    return;
  }
  if (value.length < minItems) {
    diagnostics.push({'code': 'schema_min_items', 'message': `Expected at least ${minItems} items.`, 'path': path});
  }
}

function requireObject(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isPlainObject(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected object.', 'path': path});
  }
}

function requireString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': path});
  }
}

function requireNonEmptyString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireString(value, path, diagnostics);
  if (typeof value === 'string' && value.length === 0) {
    diagnostics.push({'code': 'schema_min_length', 'message': 'Expected non-empty string.', 'path': path});
  }
}

function requirePattern(value: unknown, pattern: RegExp, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value === 'string' && !pattern.test(value)) {
    diagnostics.push({'code': 'schema_pattern', 'message': `Value does not match ${pattern}.`, 'path': path});
  }
}

function requireIntegerAtLeast(value: unknown, min: number, path: string, diagnostics: Diagnostic[]): void {
  if (!Number.isInteger(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected integer.', 'path': path});
    return;
  }
  if ((value as number) < min) {
    diagnostics.push({'code': 'schema_minimum', 'message': `Expected integer >= ${min}.`, 'path': path});
  }
}

function requireEnum(value: unknown, allowed: string[], path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': path});
    return;
  }
  if (!allowed.includes(value)) {
    diagnostics.push({'code': 'schema_enum', 'message': `Expected one of: ${allowed.join(', ')}` , 'path': path});
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

Finally, fix the `validateFinalOutput` signature to:

```ts
function validateFinalOutput(value: unknown, diagnostics: Diagnostic[]): void {
  requireObject(value, 'final_output', diagnostics);
  if (isPlainObject(value) && Object.keys(value).length === 0) {
    diagnostics.push({
      'code': 'schema_min_properties',
      'message': 'Expected at least 1 property.',
      'path': 'final_output',
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "top-level|required|unknown top-level|reports stable paths"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/validator/src/schema_validator.ts packages/validator/src/index.test.ts
git commit -m "feat: add top-level sop schema validation"
```

---

### Task 3: Implement step, executor, retry, supervision, and transition schema validation

**Files:**
- Modify: `packages/validator/src/schema_validator.ts`
- Test: `packages/validator/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `packages/validator/src/index.test.ts`:

```ts
test('reports invalid executor shape and conditional fields', () => {
  const result = validateDefinition({
    'sop_id': 'valid_id',
    'name': 'Valid',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 1,
      'idempotency_key_template': 'key',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'same',
      },
    },
    'steps': [{
      'id': 'step_a',
      'title': '',
      'inputs': {},
      'executor': {
        'kind': 'sandbox_model',
        'path': '',
        'timeout_secs': 0,
        'allow_network': true,
        'env': {'TOKEN': 1 as never},
        'resource_limits': {
          'max_output_bytes': 0,
          'max_artifacts': -1,
        },
      },
      'output_schema': {},
      'retry_policy': {
        'max_attempts': 0,
        'backoff_secs': [-1],
        'retry_on': ['oops' as never],
      },
      'supervision': {
        'owner': 'worker' as never,
        'allowed_outcomes': [],
        'default_outcome': '',
      },
      'transitions': {},
    }],
    'final_output': {'summary': 'ok'},
  });

  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({'path': 'steps.0.title'}),
    expect.objectContaining({'path': 'steps.0.executor.model'}),
    expect.objectContaining({'path': 'steps.0.executor.prompt_template'}),
    expect.objectContaining({'path': 'steps.0.executor.path'}),
    expect.objectContaining({'path': 'steps.0.executor.timeout_secs'}),
    expect.objectContaining({'path': 'steps.0.executor.env.TOKEN'}),
    expect.objectContaining({'path': 'steps.0.executor.resource_limits.max_output_bytes'}),
    expect.objectContaining({'path': 'steps.0.retry_policy.max_attempts'}),
    expect.objectContaining({'path': 'steps.0.retry_policy.backoff_secs.0'}),
    expect.objectContaining({'path': 'steps.0.retry_policy.retry_on.0'}),
    expect.objectContaining({'path': 'steps.0.supervision.owner'}),
    expect.objectContaining({'path': 'steps.0.supervision.allowed_outcomes'}),
    expect.objectContaining({'path': 'steps.0.supervision.default_outcome'}),
    expect.objectContaining({'path': 'steps.0.transitions'}),
  ]));
});

test('reports invalid transition terminal shape', () => {
  const result = validateDefinition({
    'sop_id': 'valid_id',
    'name': 'Valid',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 1,
      'idempotency_key_template': 'key',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'same',
      },
    },
    'steps': [{
      'id': 'step_a',
      'title': 'A',
      'inputs': {},
      'executor': {
        'kind': 'sandbox_tool',
        'tool': 'web_search',
        'command_template': 'Search',
        'path': '/tmp/workspace',
        'timeout_secs': 120,
        'allow_network': true,
        'env': {},
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
      'output_schema': {},
      'retry_policy': {
        'max_attempts': 1,
        'backoff_secs': [],
        'retry_on': [],
      },
      'supervision': {
        'owner': 'main_agent',
        'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
        'default_outcome': 'continue',
      },
      'transitions': {
        'continue': {
          'terminate': {
            'run_status': 'done' as never,
            'reason': '',
          },
        },
      },
    }],
    'final_output': {'summary': 'ok'},
  });

  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({'path': 'steps.0.transitions.continue.terminate.run_status'}),
    expect.objectContaining({'path': 'steps.0.transitions.continue.terminate.reason'}),
  ]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "executor shape|transition terminal shape"`
Expected: FAIL because nested schema validation is not implemented yet.

- [ ] **Step 3: Write minimal implementation**

Extend `packages/validator/src/schema_validator.ts` with these constants:

```ts
const STEP_KEYS = new Set([
  'id',
  'title',
  'description',
  'inputs',
  'executor',
  'output_schema',
  'retry_policy',
  'supervision',
  'transitions',
  'metadata',
]);

const EXECUTOR_KEYS = new Set([
  'kind',
  'tool',
  'model',
  'command_template',
  'prompt_template',
  'path',
  'timeout_secs',
  'allow_network',
  'env',
  'resource_limits',
]);

const RESOURCE_LIMIT_KEYS = new Set(['max_output_bytes', 'max_artifacts']);
const RETRY_POLICY_KEYS = new Set(['max_attempts', 'backoff_secs', 'retry_on']);
const SUPERVISION_KEYS = new Set(['owner', 'allowed_outcomes', 'default_outcome']);
const OUTCOME_KEYS = new Set(['id', 'description']);
const TERMINAL_KEYS = new Set(['run_status', 'reason']);
```

Replace the empty `validateSteps` with:

```ts
function validateSteps(steps: SopDefinition['steps'], diagnostics: Diagnostic[]): void {
  if (!Array.isArray(steps)) {
    return;
  }

  steps.forEach((step, index) => {
    const basePath = joinPath('steps', index);
    requireObject(step, basePath, diagnostics);
    pushUnknownKeys(step as Record<string, unknown>, STEP_KEYS, basePath, diagnostics);
    requireNonEmptyString(step.id, joinPath(basePath, 'id'), diagnostics);
    requirePattern(step.id, STEP_ID_PATTERN, joinPath(basePath, 'id'), diagnostics);
    requireNonEmptyString(step.title, joinPath(basePath, 'title'), diagnostics);
    if (step.description !== undefined) {
      requireString(step.description, joinPath(basePath, 'description'), diagnostics);
    }
    if (step.metadata !== undefined) {
      requireObject(step.metadata, joinPath(basePath, 'metadata'), diagnostics);
    }
    requireObject(step.inputs, joinPath(basePath, 'inputs'), diagnostics);
    requireObject(step.output_schema, joinPath(basePath, 'output_schema'), diagnostics);
    validateExecutor(step.executor, joinPath(basePath, 'executor'), diagnostics);
    validateRetryPolicy(step.retry_policy, joinPath(basePath, 'retry_policy'), diagnostics);
    validateSupervision(step.supervision, joinPath(basePath, 'supervision'), diagnostics);
    validateTransitions(step.transitions, joinPath(basePath, 'transitions'), diagnostics);
  });
}

function validateExecutor(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, EXECUTOR_KEYS, path, diagnostics);
  requireEnum(value.kind, ['sandbox_tool', 'sandbox_script', 'sandbox_model'], joinPath(path, 'kind'), diagnostics);
  requireNonEmptyString(value.path, joinPath(path, 'path'), diagnostics);
  requireIntegerAtLeast(value.timeout_secs, 1, joinPath(path, 'timeout_secs'), diagnostics);
  requireBoolean(value.allow_network, joinPath(path, 'allow_network'), diagnostics);
  validateStringMap(value.env, joinPath(path, 'env'), diagnostics);
  validateResourceLimits(value.resource_limits, joinPath(path, 'resource_limits'), diagnostics);

  if (value.kind === 'sandbox_tool' || value.kind === 'sandbox_script') {
    requireNonEmptyString(value.tool, joinPath(path, 'tool'), diagnostics);
    requireNonEmptyString(value.command_template, joinPath(path, 'command_template'), diagnostics);
  }

  if (value.kind === 'sandbox_model') {
    requireNonEmptyString(value.model, joinPath(path, 'model'), diagnostics);
    requireNonEmptyString(value.prompt_template, joinPath(path, 'prompt_template'), diagnostics);
  }
}

function validateResourceLimits(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, RESOURCE_LIMIT_KEYS, path, diagnostics);
  requireIntegerAtLeast(value.max_output_bytes, 1, joinPath(path, 'max_output_bytes'), diagnostics);
  requireIntegerAtLeast(value.max_artifacts, 0, joinPath(path, 'max_artifacts'), diagnostics);
}

function validateRetryPolicy(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, RETRY_POLICY_KEYS, path, diagnostics);
  requireIntegerAtLeast(value.max_attempts, 1, joinPath(path, 'max_attempts'), diagnostics);

  if (!Array.isArray(value.backoff_secs)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected array.', 'path': joinPath(path, 'backoff_secs')});
  } else {
    value.backoff_secs.forEach((item, index) => {
      requireIntegerAtLeast(item, 0, joinPath(path, 'backoff_secs', index), diagnostics);
    });
  }

  if (!Array.isArray(value.retry_on)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected array.', 'path': joinPath(path, 'retry_on')});
  } else {
    value.retry_on.forEach((item, index) => {
      requireEnum(item, [...RETRYABLE_STEP_RESULT_STATUSES], joinPath(path, 'retry_on', index), diagnostics);
    });
  }
}

function validateSupervision(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, SUPERVISION_KEYS, path, diagnostics);
  requireEnum(value.owner, ['main_agent'], joinPath(path, 'owner'), diagnostics);
  requireNonEmptyString(value.default_outcome, joinPath(path, 'default_outcome'), diagnostics);

  if (!Array.isArray(value.allowed_outcomes)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected array.', 'path': joinPath(path, 'allowed_outcomes')});
    return;
  }

  if (value.allowed_outcomes.length === 0) {
    diagnostics.push({'code': 'schema_min_items', 'message': 'Expected at least 1 items.', 'path': joinPath(path, 'allowed_outcomes')});
  }

  value.allowed_outcomes.forEach((outcome, index) => {
    const outcomePath = joinPath(path, 'allowed_outcomes', index);
    requireObject(outcome, outcomePath, diagnostics);
    if (!isPlainObject(outcome)) {
      return;
    }

    pushUnknownKeys(outcome, OUTCOME_KEYS, outcomePath, diagnostics);
    requireNonEmptyString(outcome.id, joinPath(outcomePath, 'id'), diagnostics);
    requirePattern(outcome.id, OUTCOME_ID_PATTERN, joinPath(outcomePath, 'id'), diagnostics);
    requireNonEmptyString(outcome.description, joinPath(outcomePath, 'description'), diagnostics);
  });
}

function validateTransitions(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  if (Object.keys(value).length === 0) {
    diagnostics.push({'code': 'schema_min_properties', 'message': 'Expected at least 1 property.', 'path': path});
    return;
  }

  for (const [key, transition] of Object.entries(value)) {
    validateTransition(transition, joinPath(path, key), diagnostics);
  }
}

function validateTransition(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  const hasNextStep = Object.hasOwn(value, 'next_step');
  const hasTerminate = Object.hasOwn(value, 'terminate');
  if (hasNextStep === hasTerminate) {
    diagnostics.push({'code': 'schema_one_of', 'message': 'Transition must define exactly one of next_step or terminate.', 'path': path});
  }

  if (hasNextStep) {
    pushUnknownKeys(value, new Set(['next_step']), path, diagnostics);
    requireNonEmptyString(value.next_step, joinPath(path, 'next_step'), diagnostics);
    requirePattern(value.next_step, STEP_ID_PATTERN, joinPath(path, 'next_step'), diagnostics);
  }

  if (hasTerminate) {
    pushUnknownKeys(value, new Set(['terminate']), path, diagnostics);
    validateTerminalState(value.terminate, joinPath(path, 'terminate'), diagnostics);
  }
}

function validateTerminalState(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, TERMINAL_KEYS, path, diagnostics);
  requireEnum(value.run_status, ['succeeded', 'failed', 'cancelled'], joinPath(path, 'run_status'), diagnostics);
  requireNonEmptyString(value.reason, joinPath(path, 'reason'), diagnostics);
}

function validateStringMap(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': joinPath(path, key)});
    }
  }
}

function requireBoolean(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'boolean') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected boolean.', 'path': path});
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "executor shape|transition terminal shape"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/validator/src/schema_validator.ts packages/validator/src/index.test.ts
git commit -m "feat: validate step schema and executor variants"
```

---

### Task 4: Implement semantic validation

**Files:**
- Modify: `packages/validator/src/semantic_validator.ts`
- Test: `packages/validator/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `packages/validator/src/index.test.ts`:

```ts
test('reports semantic relationship errors between outcomes and transitions', () => {
  const result = validateDefinition({
    'sop_id': 'semantic_case',
    'name': 'Semantic Case',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': 'dup',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'dup',
      },
    },
    'steps': [
      {
        'id': 'step_a',
        'title': 'A',
        'inputs': {},
        'executor': {
          'kind': 'sandbox_tool',
          'tool': 'web_search',
          'command_template': 'Search',
          'path': '/tmp/workspace',
          'timeout_secs': 120,
          'allow_network': true,
          'env': {},
          'resource_limits': {
            'max_output_bytes': 1024,
            'max_artifacts': 1,
          },
        },
        'output_schema': {},
        'retry_policy': {
          'max_attempts': 1,
          'backoff_secs': [],
          'retry_on': [],
        },
        'supervision': {
          'owner': 'main_agent',
          'allowed_outcomes': [
            {'id': 'continue', 'description': 'go'},
            {'id': 'continue', 'description': 'duplicate'},
            {'id': 'retry', 'description': 'retry'},
          ],
          'default_outcome': 'missing',
        },
        'transitions': {
          'continue': {'next_step': 'step_b'},
          'extra': {'next_step': 'step_missing'},
        },
      },
    ],
    'final_output': {'summary': 'ok'},
  });

  expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
    'duplicate_step_outcome_id',
    'default_outcome_missing',
    'transition_outcome_missing',
    'transition_definition_missing',
    'next_step_missing',
  ]));
});

test('reports missing entry step and duplicate step ids', () => {
  const result = validateDefinition({
    'sop_id': 'dup_case',
    'name': 'Duplicate Case',
    'version': '1.0.0',
    'entry_step': 'missing_step',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': 'dup',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'dup',
      },
    },
    'steps': [
      {
        'id': 'step_a',
        'title': 'A',
        'inputs': {},
        'executor': {
          'kind': 'sandbox_tool',
          'tool': 'web_search',
          'command_template': 'Search',
          'path': '/tmp/workspace',
          'timeout_secs': 120,
          'allow_network': true,
          'env': {},
          'resource_limits': {
            'max_output_bytes': 1024,
            'max_artifacts': 1,
          },
        },
        'output_schema': {},
        'retry_policy': {
          'max_attempts': 1,
          'backoff_secs': [],
          'retry_on': [],
        },
        'supervision': {
          'owner': 'main_agent',
          'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
          'default_outcome': 'continue',
        },
        'transitions': {
          'continue': {'next_step': 'step_a'},
        },
      },
      {
        'id': 'step_a',
        'title': 'B',
        'inputs': {},
        'executor': {
          'kind': 'sandbox_tool',
          'tool': 'web_search',
          'command_template': 'Search',
          'path': '/tmp/workspace',
          'timeout_secs': 120,
          'allow_network': true,
          'env': {},
          'resource_limits': {
            'max_output_bytes': 1024,
            'max_artifacts': 1,
          },
        },
        'output_schema': {},
        'retry_policy': {
          'max_attempts': 1,
          'backoff_secs': [],
          'retry_on': [],
        },
        'supervision': {
          'owner': 'main_agent',
          'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
          'default_outcome': 'continue',
        },
        'transitions': {
          'continue': {'next_step': 'step_a'},
        },
      },
    ],
    'final_output': {'ok': true},
  });

  expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
    'duplicate_step_id',
    'entry_step_missing',
  ]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "semantic relationship|missing entry step"`
Expected: FAIL because semantic validation is still a stub.

- [ ] **Step 3: Write minimal implementation**

Replace `packages/validator/src/semantic_validator.ts` with:

```ts
import {SopDefinition} from '@sop-exec/definition';
import {Diagnostic} from './diagnostic';
import {joinPath} from './path';

export function validateSemanticDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seenStepIds = new Set<string>();
  const knownStepIds = new Set<string>();

  for (const step of definition.steps) {
    knownStepIds.add(step.id);
  }

  for (const [stepIndex, step] of definition.steps.entries()) {
    if (seenStepIds.has(step.id)) {
      diagnostics.push({
        'code': 'duplicate_step_id',
        'message': `Duplicate step id: ${step.id}`,
        'path': joinPath('steps', stepIndex, 'id'),
      });
    } else {
      seenStepIds.add(step.id);
    }

    const outcomeIds = new Set<string>();
    for (const [outcomeIndex, outcome] of step.supervision.allowed_outcomes.entries()) {
      if (outcomeIds.has(outcome.id)) {
        diagnostics.push({
          'code': 'duplicate_step_outcome_id',
          'message': `Duplicate allowed outcome id: ${outcome.id}`,
          'path': joinPath('steps', stepIndex, 'supervision', 'allowed_outcomes', outcomeIndex, 'id'),
        });
      } else {
        outcomeIds.add(outcome.id);
      }
    }

    if (!outcomeIds.has(step.supervision.default_outcome)) {
      diagnostics.push({
        'code': 'default_outcome_missing',
        'message': `Default outcome does not exist: ${step.supervision.default_outcome}`,
        'path': joinPath('steps', stepIndex, 'supervision', 'default_outcome'),
      });
    }

    for (const outcomeId of outcomeIds) {
      if (!Object.hasOwn(step.transitions, outcomeId)) {
        diagnostics.push({
          'code': 'transition_definition_missing',
          'message': `Transition missing for allowed outcome: ${outcomeId}`,
          'path': joinPath('steps', stepIndex, 'transitions'),
        });
      }
    }

    for (const [transitionKey, transition] of Object.entries(step.transitions)) {
      if (!outcomeIds.has(transitionKey)) {
        diagnostics.push({
          'code': 'transition_outcome_missing',
          'message': `Transition has no matching allowed outcome: ${transitionKey}`,
          'path': joinPath('steps', stepIndex, 'transitions', transitionKey),
        });
      }

      if (transition.next_step !== undefined && !knownStepIds.has(transition.next_step)) {
        diagnostics.push({
          'code': 'next_step_missing',
          'message': `Transition points to unknown step: ${transition.next_step}`,
          'path': joinPath('steps', stepIndex, 'transitions', transitionKey, 'next_step'),
        });
      }
    }
  }

  if (!knownStepIds.has(definition.entry_step)) {
    diagnostics.push({
      'code': 'entry_step_missing',
      'message': `Entry step does not exist: ${definition.entry_step}`,
      'path': 'entry_step',
    });
  }

  return diagnostics;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "semantic relationship|missing entry step"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/validator/src/semantic_validator.ts packages/validator/src/index.test.ts
git commit -m "feat: add sop semantic validation"
```

---

### Task 5: Implement expression validation

**Files:**
- Modify: `packages/validator/src/expression_validator.ts`
- Test: `packages/validator/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `packages/validator/src/index.test.ts`:

```ts
test('reports invalid expression syntax in templates', () => {
  const result = validateDefinition({
    'sop_id': 'expr_case',
    'name': 'Expr Case',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': '${coalesce(run.input.company,)}',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': '${run.input.company',
      },
    },
    'steps': [{
      'id': 'step_a',
      'title': 'A',
      'inputs': {
        'company': '${steps.missing.output.name}',
      },
      'executor': {
        'kind': 'sandbox_tool',
        'tool': 'web_search',
        'command_template': 'Search ${}',
        'path': '/tmp/workspace',
        'timeout_secs': 120,
        'allow_network': true,
        'env': {},
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
      'output_schema': {},
      'retry_policy': {
        'max_attempts': 1,
        'backoff_secs': [],
        'retry_on': [],
      },
      'supervision': {
        'owner': 'main_agent',
        'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
        'default_outcome': 'continue',
      },
      'transitions': {
        'continue': {'next_step': 'step_a'},
      },
    }],
    'final_output': {
      'summary': '${steps.unknown.output.summary}',
    },
  });

  expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
    'expression_syntax',
    'expression_unknown_step',
  ]));
});

test('accepts valid expression templates and literals', () => {
  const result = validateDefinition({
    'sop_id': 'expr_valid',
    'name': 'Expr Valid',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': 'job:${run.input.company}',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': '${coalesce(run.input.company, "fallback")}',
      },
    },
    'steps': [
      {
        'id': 'step_a',
        'title': 'A',
        'inputs': {
          'company': '${run.input.company}',
        },
        'executor': {
          'kind': 'sandbox_tool',
          'tool': 'web_search',
          'command_template': 'Search ${run.input.company}',
          'path': '/tmp/workspace',
          'timeout_secs': 120,
          'allow_network': true,
          'env': {},
          'resource_limits': {
            'max_output_bytes': 1024,
            'max_artifacts': 1,
          },
        },
        'output_schema': {},
        'retry_policy': {
          'max_attempts': 1,
          'backoff_secs': [],
          'retry_on': [],
        },
        'supervision': {
          'owner': 'main_agent',
          'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
          'default_outcome': 'continue',
        },
        'transitions': {
          'continue': {'next_step': 'step_b'},
        },
      },
      {
        'id': 'step_b',
        'title': 'B',
        'inputs': {
          'articles': '${steps.step_a.output.articles}',
        },
        'executor': {
          'kind': 'sandbox_model',
          'model': 'claude-opus-4-6',
          'prompt_template': 'Summarize ${steps.step_a.output.articles}',
          'path': '/tmp/workspace',
          'timeout_secs': 120,
          'allow_network': false,
          'env': {},
          'resource_limits': {
            'max_output_bytes': 1024,
            'max_artifacts': 1,
          },
        },
        'output_schema': {},
        'retry_policy': {
          'max_attempts': 1,
          'backoff_secs': [],
          'retry_on': [],
        },
        'supervision': {
          'owner': 'main_agent',
          'allowed_outcomes': [{'id': 'done', 'description': 'done'}],
          'default_outcome': 'done',
        },
        'transitions': {
          'done': {
            'terminate': {
              'run_status': 'succeeded',
              'reason': 'complete',
            },
          },
        },
      },
    ],
    'final_output': {
      'summary': '${steps.step_b.output.summary}',
      'company': '${coalesce(run.input.company, "unknown")}',
    },
  });

  expect(result.diagnostics.filter((item) => item.code.startsWith('expression_'))).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "invalid expression syntax|valid expression templates"`
Expected: FAIL because expression validation is still a stub.

- [ ] **Step 3: Write minimal implementation**

Replace `packages/validator/src/expression_validator.ts` with:

```ts
import {ExpressionNode, ExpressionSyntaxError, SopDefinition, parseExpressionTemplate} from '@sop-exec/definition';
import {Diagnostic} from './diagnostic';
import {joinPath} from './path';

export function validateExpressionDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const knownStepIds = new Set(definition.steps.map((step) => step.id));

  validateTemplate(definition.policies.idempotency_key_template, 'policies.idempotency_key_template', knownStepIds, diagnostics);
  validateTemplate(definition.policies.concurrency.key_template, 'policies.concurrency.key_template', knownStepIds, diagnostics);

  definition.steps.forEach((step, stepIndex) => {
    for (const [key, value] of Object.entries(step.inputs)) {
      if (typeof value === 'string') {
        validateTemplate(value, joinPath('steps', stepIndex, 'inputs', key), knownStepIds, diagnostics);
      }
    }

    if ('command_template' in step.executor && typeof step.executor.command_template === 'string') {
      validateTemplate(step.executor.command_template, joinPath('steps', stepIndex, 'executor', 'command_template'), knownStepIds, diagnostics);
    }

    if ('prompt_template' in step.executor && typeof step.executor.prompt_template === 'string') {
      validateTemplate(step.executor.prompt_template, joinPath('steps', stepIndex, 'executor', 'prompt_template'), knownStepIds, diagnostics);
    }
  });

  visitFinalOutput(definition.final_output, 'final_output', knownStepIds, diagnostics);

  return diagnostics;
}

function visitFinalOutput(
  value: unknown,
  path: string,
  knownStepIds: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (typeof value === 'string') {
    validateTemplate(value, path, knownStepIds, diagnostics);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitFinalOutput(item, joinPath(path, index), knownStepIds, diagnostics));
    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      visitFinalOutput(item, joinPath(path, key), knownStepIds, diagnostics);
    }
  }
}

function validateTemplate(
  template: string,
  path: string,
  knownStepIds: Set<string>,
  diagnostics: Diagnostic[],
): void {
  try {
    const segments = parseExpressionTemplate(template);
    for (const segment of segments) {
      if (segment.kind === 'expression') {
        validateExpressionNode(segment.expression, path, knownStepIds, diagnostics);
      }
    }
  } catch (error) {
    if (error instanceof ExpressionSyntaxError) {
      diagnostics.push({
        'code': 'expression_syntax',
        'message': error.message,
        'path': path,
      });
      return;
    }

    throw error;
  }
}

function validateExpressionNode(
  node: ExpressionNode,
  path: string,
  knownStepIds: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (node.kind === 'coalesce') {
    node.expressions.forEach((expression) => validateExpressionNode(expression, path, knownStepIds, diagnostics));
    return;
  }

  if (node.kind === 'reference' && node.source !== 'run_input' && node.step_id !== undefined && !knownStepIds.has(node.step_id)) {
    diagnostics.push({
      'code': 'expression_unknown_step',
      'message': `Expression references unknown step: ${node.step_id}`,
      'path': path,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/validator/src/index.test.ts --test-name-pattern "invalid expression syntax|valid expression templates"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/validator/src/expression_validator.ts packages/validator/src/index.test.ts
git commit -m "feat: add sop expression validation"
```

---

### Task 6: Run full validator test and workspace checks

**Files:**
- Modify: none
- Test: `packages/validator/src/index.test.ts`

- [ ] **Step 1: Run validator package tests**

Run: `bun test packages/validator/src`
Expected: PASS.

- [ ] **Step 2: Run typecheck for the workspace**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full validation suite**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 4: Review diff for accidental API changes**

Run: `git diff -- packages/validator/src`
Expected: only the planned validator file changes and test updates.

- [ ] **Step 5: Commit**

```bash
git add packages/validator/src packages/validator/package.json docs/superpowers/plans/2026-04-17-validator-complete-definition-validation.md
git commit -m "feat: complete sop definition validation"
```

---

## Self-Review

### Spec coverage
- Schema validator from design doc JSON Schema: covered by Tasks 2-3.
- Semantic rules (`entry_step`, duplicate step ids, outcomes/transitions mapping, `next_step` existence): covered by Task 4.
- Expression parseability and known-step references in templates and `final_output`: covered by Task 5.
- Public API unchanged and orchestration through `validateDefinition()`: covered by Task 1.
- Verification through tests and workspace checks: covered by Task 6.

### Placeholder scan
- No TODO/TBD placeholders remain.
- Every code-changing step includes concrete code.
- Every validation step includes exact commands and expected results.

### Type consistency
- Public entrypoint remains `validateDefinition(definition: SopDefinition): ValidationResult`.
- Internal modules use `validateSchemaDefinition`, `validateSemanticDefinition`, and `validateExpressionDefinition` consistently across tasks.
- Diagnostic code names are consistent across tests and implementations.
