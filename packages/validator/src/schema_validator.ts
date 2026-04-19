/**
 * Structural schema validation for SOP definitions.
 *
 * 针对 SOP 定义做结构层面的模式校验。
 */
import {RETRYABLE_STEP_RESULT_STATUSES, SopDefinition} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic';
import {joinPath} from './path';

/** Allowed top-level keys on a SOP definition object. SOP 定义对象允许出现的顶层字段。 */
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

/** Allowed keys inside `policies`. `policies` 对象允许出现的字段。 */
const POLICY_KEYS = new Set([
  'cooldown_secs',
  'max_run_secs',
  'idempotency_key_template',
  'concurrency',
]);

/** Allowed keys inside `policies.concurrency`. `policies.concurrency` 允许出现的字段。 */
const CONCURRENCY_KEYS = new Set(['mode', 'key_template']);
/** Allowed keys on each step definition. 单个步骤定义允许出现的字段。 */
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
/** Allowed keys on executor configuration objects. 执行器配置对象允许出现的字段。 */
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
/** Allowed keys inside resource limit objects. 资源限制对象允许出现的字段。 */
const RESOURCE_LIMIT_KEYS = new Set(['max_output_bytes', 'max_artifacts']);
/** Allowed keys inside retry policies. 重试策略对象允许出现的字段。 */
const RETRY_POLICY_KEYS = new Set(['max_attempts', 'backoff_secs', 'retry_on']);
/** Allowed keys inside supervision config. 监督配置对象允许出现的字段。 */
const SUPERVISION_KEYS = new Set(['owner', 'allowed_outcomes', 'default_outcome']);
/** Allowed keys inside allowed outcome entries. allowed outcome 条目允许出现的字段。 */
const OUTCOME_KEYS = new Set(['id', 'description']);
/** Allowed keys inside terminal transition payloads. 终止转移对象允许出现的字段。 */
const TERMINAL_KEYS = new Set(['run_status', 'reason']);

/** Canonical step id format enforced by the schema validator. 结构校验要求的步骤标识格式。 */
const STEP_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
/** Canonical SOP id format enforced by the schema validator. 结构校验要求的 SOP 标识格式。 */
const SOP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Semantic version format required by the definition. 定义中要求的语义化版本格式。 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
/** Canonical allowed outcome id format. allowed outcome 标识要求的格式。 */
const OUTCOME_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Validate the object shape, required fields, and primitive constraints.
 *
 * 校验对象结构、必填字段以及基础类型约束。
 *
 * @param definition - SOP definition to validate structurally.
 * 需要进行结构校验的 SOP 定义。
 * @returns Schema diagnostics collected from the definition.
 * 从该定义中收集到的结构诊断信息。
 */
export function validateSchemaDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  validateRoot(definition, diagnostics);
  validatePolicies(definition.policies, diagnostics);
  validateSteps(definition.steps, diagnostics);
  validateFinalOutput(definition.final_output, diagnostics);

  return diagnostics;
}

/**
 * Validate the root SOP object and its direct children.
 *
 * 校验 SOP 根对象及其直接子字段。
 *
 * @param definition - Root definition object.
 * SOP 根定义对象。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Validate global execution policy configuration.
 *
 * 校验定义级的全局执行策略配置。
 *
 * @param policies - Policies object from the SOP definition.
 * SOP 定义中的全局策略对象。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Validate every step entry declared in the workflow.
 *
 * 校验工作流中声明的每一个步骤条目。
 *
 * @param steps - Ordered step list from the SOP definition.
 * SOP 定义中的有序步骤列表。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Validate executor configuration and gate kind-specific fields.
 *
 * 校验执行器配置，并按执行器类型要求对应字段。
 *
 * @param value - Candidate executor configuration value.
 * 待检查的执行器配置值。
 * @param path - Diagnostic path for the executor object.
 * 执行器对象对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Validate a string field whose requiredness depends on executor kind.
 *
 * 校验某个字符串字段，并根据执行器类型决定是否必填。
 *
 * @param value - Executor object under validation.
 * 当前正在校验的执行器对象。
 * @param key - Field name to inspect.
 * 需要检查的字段名。
 * @param path - Base diagnostic path for the executor object.
 * 执行器对象的基础诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 * @param required - Whether the field must exist for the current executor kind.
 * 当前执行器类型下该字段是否必须存在。
 */
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

/**
 * Validate resource limit objects attached to executors.
 *
 * 校验执行器上的资源限制配置。
 *
 * @param value - Candidate resource-limit object.
 * 待检查的资源限制对象。
 * @param path - Diagnostic path for the resource-limit object.
 * 资源限制对象对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function validateResourceLimits(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, RESOURCE_LIMIT_KEYS, path, diagnostics);
  requireIntegerAtLeast(value.max_output_bytes, 1, joinPath(path, 'max_output_bytes'), diagnostics);
  requireIntegerAtLeast(value.max_artifacts, 0, joinPath(path, 'max_artifacts'), diagnostics);
}

/**
 * Validate retry policy structure and allowed retry statuses.
 *
 * 校验重试策略结构以及允许的重试状态。
 *
 * @param value - Candidate retry-policy object.
 * 待检查的重试策略对象。
 * @param path - Diagnostic path for the retry policy.
 * 重试策略对象对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Validate human supervision configuration and outcome declarations.
 *
 * 校验人工监督配置以及可选 outcome 声明。
 *
 * @param value - Candidate supervision configuration object.
 * 待检查的监督配置对象。
 * @param path - Diagnostic path for the supervision object.
 * 监督对象对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Validate the outcome-to-transition mapping for a step.
 *
 * 校验步骤中 outcome 到转移规则的映射关系。
 *
 * @param value - Candidate transitions object.
 * 待检查的转移映射对象。
 * @param path - Diagnostic path for the transitions object.
 * 转移对象对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Validate one transition entry and enforce the `next_step` XOR `terminate` rule.
 *
 * 校验单个转移对象，并强制 `next_step` 与 `terminate` 二选一。
 *
 * @param value - Candidate transition object.
 * 待检查的单个转移对象。
 * @param path - Diagnostic path for the transition.
 * 转移对象对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Validate the payload used to terminate a run.
 *
 * 校验终止运行时携带的终态信息。
 *
 * @param value - Candidate terminal payload.
 * 待检查的终态负载。
 * @param path - Diagnostic path for the terminal payload.
 * 终态对象对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function validateTerminalState(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, TERMINAL_KEYS, path, diagnostics);
  requireEnum(value.run_status, ['succeeded', 'failed', 'cancelled'], joinPath(path, 'run_status'), diagnostics);
  requireNonEmptyString(value.reason, joinPath(path, 'reason'), diagnostics);
}

/**
 * Validate string-to-string maps such as executor environment variables.
 *
 * 校验仅允许字符串值的键值映射，例如环境变量。
 *
 * @param value - Candidate string map.
 * 待检查的字符串映射对象。
 * @param path - Diagnostic path for the map.
 * 键值映射对象对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Ensure the final output object exists and is not empty.
 *
 * 确保最终输出对象存在且不是空对象。
 *
 * @param value - Candidate final-output value.
 * 待检查的最终输出值。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Emit diagnostics for unknown keys not listed in the allowed set.
 *
 * 为未列入白名单的额外字段生成诊断信息。
 *
 * @param value - Object whose keys are being checked.
 * 需要检查字段的对象。
 * @param allowed - Whitelist of allowed keys.
 * 允许出现的字段白名单。
 * @param basePath - Diagnostic base path for the object.
 * 该对象的诊断基础路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
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

/**
 * Require an array and enforce a minimum length.
 *
 * 要求值为数组并满足最小长度。
 *
 * @param value - Candidate value.
 * 待检查的值。
 * @param minItems - Minimum accepted array length.
 * 允许的最小数组长度。
 * @param path - Diagnostic path for the value.
 * 当前值对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function requireArrayWithMinItems(value: unknown, minItems: number, path: string, diagnostics: Diagnostic[]): void {
  if (!Array.isArray(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected array.', 'path': path});
    return;
  }

  if (value.length < minItems) {
    diagnostics.push({'code': 'schema_min_items', 'message': `Expected at least ${minItems} items.`, 'path': path});
  }
}

/**
 * Require the value to be a plain object.
 *
 * 要求值为普通对象。
 *
 * @param value - Candidate value.
 * 待检查的值。
 * @param path - Diagnostic path for the value.
 * 当前值对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function requireObject(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isPlainObject(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected object.', 'path': path});
  }
}

/**
 * Require the value to be a string.
 *
 * 要求值为字符串。
 *
 * @param value - Candidate value.
 * 待检查的值。
 * @param path - Diagnostic path for the value.
 * 当前值对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function requireString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': path});
  }
}

/**
 * Require the value to be a non-empty string.
 *
 * 要求值为非空字符串。
 *
 * @param value - Candidate value.
 * 待检查的值。
 * @param path - Diagnostic path for the value.
 * 当前值对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function requireNonEmptyString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireString(value, path, diagnostics);

  if (typeof value === 'string' && value.length === 0) {
    diagnostics.push({'code': 'schema_min_length', 'message': 'Expected non-empty string.', 'path': path});
  }
}

/**
 * Require the string value to match a regular-expression pattern.
 *
 * 要求字符串值匹配指定正则模式。
 *
 * @param value - Candidate value.
 * 待检查的值。
 * @param pattern - Regular expression the value must match.
 * 值必须匹配的正则表达式。
 * @param path - Diagnostic path for the value.
 * 当前值对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function requirePattern(value: unknown, pattern: RegExp, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value === 'string' && !pattern.test(value)) {
    diagnostics.push({'code': 'schema_pattern', 'message': `Value does not match ${pattern}.`, 'path': path});
  }
}

/**
 * Require an integer value that is greater than or equal to `min`.
 *
 * 要求整数值大于等于 `min`。
 *
 * @param value - Candidate value.
 * 待检查的值。
 * @param min - Minimum allowed integer value.
 * 允许的最小整数值。
 * @param path - Diagnostic path for the value.
 * 当前值对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function requireIntegerAtLeast(value: unknown, min: number, path: string, diagnostics: Diagnostic[]): void {
  if (!Number.isInteger(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected integer.', 'path': path});
    return;
  }

  if (typeof value === 'number' && value < min) {
    diagnostics.push({'code': 'schema_minimum', 'message': `Expected integer >= ${min}.`, 'path': path});
  }
}

/**
 * Require the string value to be one of the allowed literals.
 *
 * 要求字符串值位于允许的枚举集合中。
 *
 * @param value - Candidate value.
 * 待检查的值。
 * @param allowed - Allowed literal set.
 * 允许的字面量集合。
 * @param path - Diagnostic path for the value.
 * 当前值对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function requireEnum(value: unknown, allowed: string[], path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': path});
    return;
  }

  if (!allowed.includes(value)) {
    diagnostics.push({'code': 'schema_enum', 'message': `Expected one of: ${allowed.join(', ')}`, 'path': path});
  }
}

/**
 * Require a boolean value.
 *
 * 要求值为布尔类型。
 *
 * @param value - Candidate value.
 * 待检查的值。
 * @param path - Diagnostic path for the value.
 * 当前值对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function requireBoolean(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'boolean') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected boolean.', 'path': path});
  }
}

/**
 * Check whether an unknown value is a plain record-like object.
 *
 * 判断未知值是否为普通记录对象。
 *
 * @param value - Unknown value to inspect.
 * 待判断的未知值。
 * @returns Whether the value is a non-array object.
 * 该值是否为非数组对象。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
