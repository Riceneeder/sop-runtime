/**
 * Validators for per-step sub-sections: retry, supervision, and transitions.
 *
 * 针对步骤级别子配置的校验器：重试策略、人工监督和转移规则。
 */
import {RETRYABLE_STEP_RESULT_STATUSES} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic.js';
import {joinPath} from './path.js';
import {
  OUTCOME_ID_PATTERN,
  OUTCOME_KEYS,
  RETRY_POLICY_KEYS,
  STEP_ID_PATTERN,
  SUPERVISION_KEYS,
  TERMINAL_KEYS,
} from './schema_keys.js';
import {
  isPlainObject,
  pushUnknownKeys,
  requireEnum,
  requireIntegerAtLeast,
  requireNonEmptyString,
  requireObject,
  requirePattern,
} from './schema_require.js';

/**
 * Validate retry policy structure and allowed retry statuses.
 *
 * 校验重试策略结构以及允许的重试状态。
 */
export function validateRetryPolicy(value: unknown, path: string, diagnostics: Diagnostic[]): void {
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
 */
export function validateSupervision(value: unknown, path: string, diagnostics: Diagnostic[]): void {
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
 */
export function validateTransitions(value: unknown, path: string, diagnostics: Diagnostic[]): void {
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
