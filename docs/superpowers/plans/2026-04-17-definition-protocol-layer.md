# Definition Protocol Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `@sop-exec/definition` into the shared protocol layer described in the design docs, including richer SOP/runtime types and expression parsing primitives.

**Architecture:** Keep `definition` pure and low-level: only shared types, constants, and expression parsing live here. `validator` and `core` consume these exports; they do not move validation or runtime logic into `definition`.

**Tech Stack:** Bun, TypeScript, `bun:test`

---

### Task 1: Lock in the Definition package API with failing tests

**Files:**
- Modify: `packages/definition/src/index.test.ts`
- Create: `packages/definition/src/expression.test.ts`

- [ ] **Step 1: Write the failing export test**

```ts
import {describe, expect, test} from 'bun:test';
import {
  ExpressionSyntaxError,
  JsonObject,
  RUN_PHASES,
  RUN_STATUSES,
  STEP_LIFECYCLES,
  STEP_RESULT_STATUSES,
  RunState,
  SopDefinition,
  parseExpressionBody,
  parseExpressionTemplate,
} from './index';

describe('definition exports', () => {
  test('exports the shared SOP model types and richer run state contracts', () => {
    const input: JsonObject = {'company': 'Acme'};
    const definition: SopDefinition = {
      'sop_id': 'news_report',
      'name': 'News Report',
      'version': '1.0.0',
      'entry_step': 'search_news',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'news:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'news:${run.input.company}',
        },
      },
      'steps': [
        {
          'id': 'search_news',
          'title': 'Search News',
          'inputs': {
            'company': '${run.input.company}',
          },
          'executor': {
            'kind': 'sandbox_tool',
            'path': '/tmp/workspace',
          },
          'output_schema': {'type': 'object'},
          'retry_policy': {
            'max_attempts': 2,
          },
          'supervision': {
            'owner': 'main_agent',
            'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
            'default_outcome': 'continue',
          },
          'transitions': {
            'continue': {'next_step': 'search_news'},
          },
        },
      ],
      'final_output': {'summary': 'ok'},
    };
    const state = {} as RunState;

    expect(input.company).toBe('Acme');
    expect(definition.steps[0]?.executor.kind).toBe('sandbox_tool');
    expect(state).toBeDefined();
    expect(RUN_STATUSES).toContain('running');
    expect(RUN_PHASES).toContain('ready');
    expect(STEP_LIFECYCLES).toContain('active');
    expect(STEP_RESULT_STATUSES).toContain('invalid_output');
    expect(parseExpressionBody('run.input.company').kind).toBe('reference');
    expect(parseExpressionTemplate('Hello ${run.input.company}').length).toBe(2);
    expect(ExpressionSyntaxError).toBeDefined();
  });
});
```

- [ ] **Step 2: Write the failing expression parser tests**

```ts
import {describe, expect, test} from 'bun:test';
import {
  ExpressionSyntaxError,
  parseExpressionBody,
  parseExpressionTemplate,
} from './index';

describe('expression parser', () => {
  test('parses references, literals, and coalesce expressions', () => {
    expect(parseExpressionBody('run.input.company')).toEqual({
      'kind': 'reference',
      'source': 'run_input',
      'path': ['company'],
      'raw': 'run.input.company',
    });

    expect(parseExpressionBody('steps.search_news.output.articles')).toEqual({
      'kind': 'reference',
      'source': 'step_output',
      'step_id': 'search_news',
      'path': ['articles'],
      'raw': 'steps.search_news.output.articles',
    });

    expect(parseExpressionBody('coalesce(steps.a.output.x, "fallback", [])')).toEqual({
      'kind': 'coalesce',
      'expressions': [
        {
          'kind': 'reference',
          'source': 'step_output',
          'step_id': 'a',
          'path': ['x'],
          'raw': 'steps.a.output.x',
        },
        {
          'kind': 'literal',
          'value': 'fallback',
        },
        {
          'kind': 'literal',
          'value': [],
        },
      ],
    });
  });

  test('parses template strings and keeps quoted commas inside coalesce arguments', () => {
    expect(parseExpressionTemplate('before ${coalesce("a,b", run.input.company)} after')).toEqual([
      {'kind': 'text', 'value': 'before '},
      {
        'kind': 'expression',
        'expression': {
          'kind': 'coalesce',
          'expressions': [
            {'kind': 'literal', 'value': 'a,b'},
            {
              'kind': 'reference',
              'source': 'run_input',
              'path': ['company'],
              'raw': 'run.input.company',
            },
          ],
        },
      },
      {'kind': 'text', 'value': ' after'},
    ]);
  });

  test('rejects malformed expressions', () => {
    expect(() => parseExpressionBody('steps.only_two_parts')).toThrow(ExpressionSyntaxError);
    expect(() => parseExpressionBody('coalesce(')).toThrow(ExpressionSyntaxError);
    expect(() => parseExpressionTemplate('${}')).toThrow(ExpressionSyntaxError);
  });
});
```

- [ ] **Step 3: Run the Definition tests to verify they fail**

Run: `bun test packages/definition/src`
Expected: FAIL because the new exports and parser files do not exist yet.

- [ ] **Step 4: Commit**

```bash
git add packages/definition/src/index.test.ts packages/definition/src/expression.test.ts
git commit -m "test: define definition protocol layer contracts"
```

### Task 2: Implement richer shared types and expression parsing

**Files:**
- Modify: `packages/definition/src/index.ts`
- Modify: `packages/definition/src/sop_definition.ts`
- Modify: `packages/definition/src/run_state.ts`
- Create: `packages/definition/src/execution.ts`
- Create: `packages/definition/src/expression.ts`

- [ ] **Step 1: Implement the SOP DSL types**

Add `AllowedOutcome`, `SupervisionConfig`, `RetryPolicy`, and `ExecutorConfig` to `packages/definition/src/sop_definition.ts`, and tighten `StepDefinition` to use them instead of raw `JsonObject`.

- [ ] **Step 2: Implement the runtime state types**

Add `STEP_LIFECYCLES`, `StepLifecycle`, `StepState`, `HistoryEntry`, and the richer `RunState` fields to `packages/definition/src/run_state.ts`.

- [ ] **Step 3: Implement the execution protocol types**

Create `packages/definition/src/execution.ts` with `STEP_RESULT_STATUSES`, `StepResultStatus`, `StepError`, `AcceptedStepResult`, `StepResult`, `Decision`, `StepRun`, and `FinalOutput`.

- [ ] **Step 4: Implement the expression parser**

Create `packages/definition/src/expression.ts` with AST types, template segment types, `ExpressionSyntaxError`, `parseExpressionBody()`, and `parseExpressionTemplate()`. Ensure `coalesce("a,b", run.input.company)` parses as two arguments, not three.

- [ ] **Step 5: Export the new protocol surface**

Update `packages/definition/src/index.ts` to export all new types, constants, and parser functions.

- [ ] **Step 6: Run the Definition tests to verify they pass**

Run: `bun test packages/definition/src`
Expected: PASS with the new tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/definition/src/index.ts packages/definition/src/sop_definition.ts packages/definition/src/run_state.ts packages/definition/src/execution.ts packages/definition/src/expression.ts
git commit -m "feat: expand definition protocol layer"
```

### Task 3: Restore workspace compatibility with the new Definition contracts

**Files:**
- Modify: `packages/validator/src/index.test.ts`
- Modify: `packages/runtime/src/index.test.ts`
- Modify: `packages/core/src/index.test.ts`
- Modify: `packages/core/src/create_run.ts`
- Modify: `packages/runtime/src/step_executor.ts`
- Modify: `packages/runtime/src/decision_provider.ts`

- [ ] **Step 1: Write or update the failing compatibility expectations**

Adjust consumer tests so they compile against the new `definition` contracts without assuming unimplemented `core` APIs. Keep the tests aligned with what the current packages actually export.

- [ ] **Step 2: Run the workspace tests or typecheck to observe consumer failures**

Run: `bun run typecheck`
Expected: FAIL in consumer packages until they adopt the new `definition` exports.

- [ ] **Step 3: Implement the minimal compatibility fixes**

Update consumer code to use the new shared types while preserving existing package boundaries. Do not implement new `core` lifecycle behavior in this task; only fix compile-time incompatibilities caused by the richer `definition` contracts.

- [ ] **Step 4: Run the full workspace verification**

Run: `bun run check`
Expected: PASS with lint, typecheck, and tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/validator/src/index.test.ts packages/runtime/src/index.test.ts packages/core/src/index.test.ts packages/core/src/create_run.ts packages/runtime/src/step_executor.ts packages/runtime/src/decision_provider.ts
git commit -m "chore: align consumers with definition contracts"
```
