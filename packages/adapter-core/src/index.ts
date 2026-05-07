/**
 * @packageDocumentation
 *
 * Public entrypoint for the adapter-core package.
 *
 * Shared adapter types and helpers for building sop-runtime executor adapters.
 */

export {
  AdapterConfigError,
  assertJsonObject,
  getRequiredString,
  getOptionalString,
  getOptionalStringArray,
  getOptionalJsonObject,
  getOptionalBoolean,
  getOptionalStringRecord,
} from './config.js';

export {
  resolveExecutorConfigTemplate,
} from './config-template.js';
export type {
  ResolveExecutorConfigTemplateParams,
} from './config-template.js';

export {
  AdapterError,
  normalizeAdapterError,
  buildErrorDetails,
} from './error.js';

export {
  MAX_SET_TIMEOUT_MS,
  executeHandlerWithTimeout,
  enforceResourceLimits,
  computeJsonUtf8Size,
  normalizeTimeoutMs,
} from './enforcer.js';
export type {
  EnforceResourceLimitsParams,
  ErrorResult,
  HandlerResult,
  InvalidPayloadPolicy,
  TimeoutResult,
} from './enforcer.js';

export {
  REDACTED_VALUE,
  redactSecrets,
} from './redact.js';

export {
  buildSuccessResult,
  buildToolErrorResult,
  buildTimeoutResult,
  buildSandboxErrorResult,
} from './result.js';

export type {
  ExecutorAdapter,
  ExecutorAdapterRegistration,
  ExecutorConfigResolver,
  ExecutorHandler,
  ExecutorHandlerInput,
  ExecutorResult,
  RuntimeStepPacket,
  StepExecutor,
} from './types.js';
