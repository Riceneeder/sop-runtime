/**
 * Compatibility re-exports from @sop-runtime/adapter-core.
 *
 * @sop-runtime/runtime 内部及外部消费者仍可从本路径导入。
 *
 * @packageDocumentation
 */

export {
  MAX_SET_TIMEOUT_MS,
  computeJsonUtf8Size,
  enforceResourceLimits,
  executeHandlerWithTimeout,
  normalizeTimeoutMs,
} from '@sop-runtime/adapter-core';

export type {
  EnforceResourceLimitsParams,
  ErrorResult,
  HandlerResult,
  InvalidPayloadPolicy,
  TimeoutResult,
} from '@sop-runtime/adapter-core';
