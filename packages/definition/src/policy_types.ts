/**
 * Policy-related types: retry, resource limits, and retryable statuses.
 *
 * 策略相关类型：重试、资源上限及可重试状态。
 */

/**
 * Step result statuses that are eligible for retry.
 *
 * 可用于触发重试策略的步骤结果状态集合。
 *
 * @public
 */
export const RETRYABLE_STEP_RESULT_STATUSES = [
  'timeout',
  'tool_error',
  'invalid_output',
  'sandbox_error',
] as const;

/**
 * Union of statuses accepted by {@link RetryPolicy.retry_on}.
 *
 * {@link RetryPolicy.retry_on} 可使用的状态联合类型。
 *
 * @public
 */
export type RetryableStepResultStatus = (typeof RETRYABLE_STEP_RESULT_STATUSES)[number];

/**
 * Retry configuration for a step.
 *
 * 单个步骤的重试策略配置。
 *
 * @public
 */
export interface RetryPolicy {
  /**
   * Maximum total attempts, including the first execution.
   *
   * 最大总尝试次数，包含首次执行。
   */
  max_attempts: number;
  /**
   * Delay schedule in seconds between retries.
   *
   * 每次重试之间的延迟秒数序列。
   */
  backoff_secs: number[];
  /**
   * Result statuses that are eligible for retry.
   *
   * 允许触发重试的结果状态集合。
   */
  retry_on: RetryableStepResultStatus[];
}

/**
 * Resource ceilings enforced for one executor attempt.
 *
 * 单次执行器尝试需要遵守的资源上限。
 *
 * @public
 */
export interface ResourceLimits {
  /**
   * Maximum serialized output size accepted from the executor.
   *
   * 执行器输出允许的最大序列化字节数。
   */
  max_output_bytes: number;
  /**
   * Maximum number of artifacts the executor may emit.
   *
   * 执行器允许产出的最大制品数量。
   */
  max_artifacts: number;
}
