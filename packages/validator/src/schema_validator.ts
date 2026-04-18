import {RETRYABLE_STEP_RESULT_STATUSES, SopDefinition} from '@sop-exec/definition';
import {Diagnostic} from './diagnostic';
import {joinPath} from './path';

const ROOT_KEYS = new Set([
  '$schema',
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
  requireObject(definition, '', diagnostics);

  if (!isPlainObject(definition)) {
    return;
  }

  pushUnknownKeys(definition, ROOT_KEYS, '', diagnostics);

  if (Object.hasOwn(definition, '$schema')) {
    requireString(definition.$schema, '$schema', diagnostics);
  }

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

  if (!isPlainObject(policies)) {
    return;
  }

  pushUnknownKeys(policies, POLICY_KEYS, 'policies', diagnostics);

  requireIntegerAtLeast(policies.cooldown_secs, 0, 'policies.cooldown_secs', diagnostics);
  requireIntegerAtLeast(policies.max_run_secs, 1, 'policies.max_run_secs', diagnostics);
  requireNonEmptyString(policies.idempotency_key_template, 'policies.idempotency_key_template', diagnostics);

  requireObject(policies.concurrency, 'policies.concurrency', diagnostics);

  if (!isPlainObject(policies.concurrency)) {
    return;
  }

  pushUnknownKeys(policies.concurrency, CONCURRENCY_KEYS, 'policies.concurrency', diagnostics);

  requireEnum(
    policies.concurrency.mode,
    ['singleflight', 'allow_parallel', 'drop_if_running'],
    'policies.concurrency.mode',
    diagnostics,
  );

  requireNonEmptyString(policies.concurrency.key_template, 'policies.concurrency.key_template', diagnostics);
}

function validateSteps(steps: SopDefinition['steps'], diagnostics: Diagnostic[]): void {
  if (!Array.isArray(steps)) {
    return;
  }

  steps.forEach((step, index) => {
    const basePath = joinPath('steps', index);

    requireObject(step, basePath, diagnostics);
    if (!isPlainObject(step)) {
      return;
    }

    pushUnknownKeys(step, STEP_KEYS, basePath, diagnostics);
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

  const requiresToolFields = value.kind === 'sandbox_tool' || value.kind === 'sandbox_script';
  const requiresModelFields = value.kind === 'sandbox_model';

  validateExecutorStringField(value, 'tool', path, diagnostics, requiresToolFields);
  validateExecutorStringField(value, 'command_template', path, diagnostics, requiresToolFields);
  validateExecutorStringField(value, 'model', path, diagnostics, requiresModelFields);
  validateExecutorStringField(value, 'prompt_template', path, diagnostics, requiresModelFields);

}

function validateExecutorStringField(
  value: Record<string, unknown>,
  key: 'command_template' | 'model' | 'prompt_template' | 'tool',
  path: string,
  diagnostics: Diagnostic[],
  required: boolean,
): void {
  const fieldPath = joinPath(path, key);

  if (!Object.hasOwn(value, key)) {
    if (required) {
      diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': fieldPath});
    }

    return;
  }

  if (typeof value[key] !== 'string') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': fieldPath});
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
    diagnostics.push({
      'code': 'schema_min_items',
      'message': 'Expected at least 1 items.',
      'path': joinPath(path, 'allowed_outcomes'),
    });
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

  pushUnknownKeys(value, new Set(['next_step', 'terminate']), path, diagnostics);

  const hasNextStep = Object.hasOwn(value, 'next_step');
  const hasTerminate = Object.hasOwn(value, 'terminate');

  if (hasNextStep === hasTerminate) {
    diagnostics.push({
      'code': 'schema_one_of',
      'message': 'Transition must define exactly one of next_step or terminate.',
      'path': path,
    });
  }

  if (hasNextStep) {
    requireNonEmptyString(value.next_step, joinPath(path, 'next_step'), diagnostics);
    requirePattern(value.next_step, STEP_ID_PATTERN, joinPath(path, 'next_step'), diagnostics);
  }

  if (hasTerminate) {
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

  if (typeof value === 'number' && value < min) {
    diagnostics.push({'code': 'schema_minimum', 'message': `Expected integer >= ${min}.`, 'path': path});
  }
}

function requireEnum(value: unknown, allowed: string[], path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': path});
    return;
  }

  if (!allowed.includes(value)) {
    diagnostics.push({'code': 'schema_enum', 'message': `Expected one of: ${allowed.join(', ')}`, 'path': path});
  }
}

function requireBoolean(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'boolean') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected boolean.', 'path': path});
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
