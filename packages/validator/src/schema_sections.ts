/**
 * Section-level validators for the root SOP object and its major sub-sections.
 *
 * 针对 SOP 根对象及其主要子区块的结构校验器。
 */
import {SopDefinition} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic.js';
import {joinPath} from './path.js';
import {
  CONCURRENCY_KEYS,
  EXECUTOR_KEYS,
  POLICY_KEYS,
  RESOURCE_LIMIT_KEYS,
  ROOT_KEYS,
  SOP_ID_PATTERN,
  STEP_ID_PATTERN,
  STEP_KEYS,
  VERSION_PATTERN,
} from './schema_keys.js';
import {
  isPlainObject,
  pushUnknownKeys,
  requireArrayWithMinItems,
  requireBoolean,
  requireEnum,
  requireIntegerAtLeast,
  requireNonEmptyString,
  requireObject,
  requirePattern,
  requireString,
} from './schema_require.js';
import {validateRetryPolicy, validateSupervision, validateTransitions} from './schema_step_details.js';

/**
 * Validate the root SOP object and its direct children.
 *
 * 校验 SOP 根对象及其直接子字段。
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
  requirePattern(definition.sop_id, 'sop_id', diagnostics, { 'pattern': SOP_ID_PATTERN });

  requireNonEmptyString(definition.name, 'name', diagnostics);

  requireNonEmptyString(definition.version, 'version', diagnostics);
  requirePattern(definition.version, 'version', diagnostics, { 'pattern': VERSION_PATTERN });

  requireNonEmptyString(definition.entry_step, 'entry_step', diagnostics);
  requirePattern(definition.entry_step, 'entry_step', diagnostics, { 'pattern': STEP_ID_PATTERN });

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

  requireArrayWithMinItems(definition.steps, 'steps', diagnostics, { 'minItems': 1 });
}

/**
 * Validate global execution policy configuration.
 *
 * 校验定义级的全局执行策略配置。
 */
function validatePolicies(policies: SopDefinition['policies'], diagnostics: Diagnostic[]): void {
  requireObject(policies, 'policies', diagnostics);

  if (!isPlainObject(policies)) {
    return;
  }

  pushUnknownKeys(policies, POLICY_KEYS, 'policies', diagnostics);

  requireIntegerAtLeast(policies.cooldown_secs, 'policies.cooldown_secs', diagnostics, { 'min': 0 });
  requireIntegerAtLeast(policies.max_run_secs, 'policies.max_run_secs', diagnostics, { 'min': 1 });
  requireNonEmptyString(policies.idempotency_key_template, 'policies.idempotency_key_template', diagnostics);

  requireObject(policies.concurrency, 'policies.concurrency', diagnostics);

  if (!isPlainObject(policies.concurrency)) {
    return;
  }

  pushUnknownKeys(policies.concurrency, CONCURRENCY_KEYS, 'policies.concurrency', diagnostics);

  requireEnum(
    policies.concurrency.mode,
    'policies.concurrency.mode',
    diagnostics,
    { 'allowed': ['singleflight', 'allow_parallel', 'drop_if_running'] },
  );

  requireNonEmptyString(policies.concurrency.key_template, 'policies.concurrency.key_template', diagnostics);
}

/**
 * Validate every step entry declared in the workflow.
 *
 * 校验工作流中声明的每一个步骤条目。
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
    requirePattern(step.id, joinPath(basePath, 'id'), diagnostics, { 'pattern': STEP_ID_PATTERN });
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
 * Validate executor configuration.
 *
 * 校验执行器配置。
 */
function validateExecutor(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, EXECUTOR_KEYS, path, diagnostics);
  requireNonEmptyString(value.kind, joinPath(path, 'kind'), diagnostics);
  requireNonEmptyString(value.name, joinPath(path, 'name'), diagnostics);
  requireIntegerAtLeast(value.timeout_secs, joinPath(path, 'timeout_secs'), diagnostics, { 'min': 1 });
  requireBoolean(value.allow_network, joinPath(path, 'allow_network'), diagnostics);
  validateStringMap(value.env, joinPath(path, 'env'), diagnostics);
  validateResourceLimits(value.resource_limits, joinPath(path, 'resource_limits'), diagnostics);

  if (value.config !== undefined && value.config !== null) {
    requireObject(value.config, joinPath(path, 'config'), diagnostics);
  }
}

/**
 * Validate resource limit objects attached to executors.
 *
 * 校验执行器上的资源限制配置。
 */
function validateResourceLimits(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireObject(value, path, diagnostics);
  if (!isPlainObject(value)) {
    return;
  }

  pushUnknownKeys(value, RESOURCE_LIMIT_KEYS, path, diagnostics);
  requireIntegerAtLeast(value.max_output_bytes, joinPath(path, 'max_output_bytes'), diagnostics, { 'min': 1 });
  requireIntegerAtLeast(value.max_artifacts, joinPath(path, 'max_artifacts'), diagnostics, { 'min': 0 });
}

/**
 * Validate string-to-string maps such as executor environment variables.
 *
 * 校验仅允许字符串值的键值映射，例如环境变量。
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

export {validateFinalOutput, validatePolicies, validateRoot, validateSteps};
