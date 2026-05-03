/**
 * Error codes raised by runtime orchestration functions.
 *
 * 运行时编排函数抛出的错误码。
 *
 * @public
 */
export const RUNTIME_ERROR_CODES = [
  'run_not_found',
  'invalid_runtime_state',
  'runtime_policy_rejected',
  'runtime_step_limit_exceeded',
  'runtime_key_render_failed',
  'run_id_conflict',
  'executor_not_registered',
  'hook_rejected',
] as const;

/**
 * Union of all runtime error codes.
 *
 * 运行时错误码的联合类型。
 *
 * @public
 */
export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

/**
 * Optional parameters for constructing a RuntimeError.
 *
 * RuntimeError 的可选构造参数。
 *
 * @public
 */
export interface RuntimeErrorOptions {
  /** Human-readable error message. 人类可读的错误消息。 */
  message?: string;
  /** Structured metadata describing the error context. 描述错误上下文的结构化元数据。 */
  details?: Record<string, unknown>;
}

/**
 * Typed error for runtime package precondition rejections.
 *
 * 运行时包前置条件拒绝的类型化错误。
 *
 * @public
 */
export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: RuntimeErrorCode, options: RuntimeErrorOptions = {}) {
    super(options.message ?? code);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = options.details;
  }
}
