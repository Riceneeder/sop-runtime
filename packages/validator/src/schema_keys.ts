/**
 * Allowed key sets and pattern constants for schema validation.
 *
 * 结构校验中使用的字段白名单和正则模式常量。
 */

/** Allowed top-level keys on a SOP definition object. SOP 定义对象允许出现的顶层字段。 */
export const ROOT_KEYS = new Set([
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
export const POLICY_KEYS = new Set([
  'cooldown_secs',
  'max_run_secs',
  'idempotency_key_template',
  'concurrency',
]);

/** Allowed keys inside `policies.concurrency`. `policies.concurrency` 允许出现的字段。 */
export const CONCURRENCY_KEYS = new Set(['mode', 'key_template']);

/** Allowed keys on each step definition. 单个步骤定义允许出现的字段。 */
export const STEP_KEYS = new Set([
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
export const EXECUTOR_KEYS = new Set([
  'kind',
  'name',
  'config',
  'timeout_secs',
  'allow_network',
  'env',
  'resource_limits',
]);

/** Allowed keys inside resource limit objects. 资源限制对象允许出现的字段。 */
export const RESOURCE_LIMIT_KEYS = new Set(['max_output_bytes', 'max_artifacts']);

/** Allowed keys inside retry policies. 重试策略对象允许出现的字段。 */
export const RETRY_POLICY_KEYS = new Set(['max_attempts', 'backoff_secs', 'retry_on']);

/** Allowed keys inside supervision config. 监督配置对象允许出现的字段。 */
export const SUPERVISION_KEYS = new Set(['owner', 'allowed_outcomes', 'default_outcome']);

/** Allowed keys inside allowed outcome entries. allowed outcome 条目允许出现的字段。 */
export const OUTCOME_KEYS = new Set(['id', 'description']);

/** Allowed keys inside terminal transition payloads. 终止转移对象允许出现的字段。 */
export const TERMINAL_KEYS = new Set(['run_status', 'reason']);

/** Canonical step id format enforced by the schema validator. 结构校验要求的步骤标识格式。 */
export const STEP_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Canonical SOP id format enforced by the schema validator. 结构校验要求的 SOP 标识格式。 */
export const SOP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Semantic version format required by the definition. 定义中要求的语义化版本格式。 */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Canonical allowed outcome id format. allowed outcome 标识要求的格式。 */
export const OUTCOME_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
