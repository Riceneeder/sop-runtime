import {Diagnostic} from '@sop-runtime/validator';

/**
 * Error codes raised by core state-machine functions.
 *
 * 核心状态机函数抛出的错误码。
 *
 * @public
 */
export const CORE_ERROR_CODES = [
  'definition_invalid',
  'run_input_invalid',
  'invalid_state',
  'step_result_rejected',
  'decision_rejected',
  'expression_evaluation_failed',
] as const;

/**
 * Union of all core error codes.
 *
 * 核心错误码的联合类型。
 *
 * @public
 */
export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number];

/**
 * Optional parameters for constructing a CoreError.
 *
 * CoreError 的可选构造参数。
 *
 * @public
 */
export interface CoreErrorOptions {
  /** Human-readable error message. 人类可读的错误消息。 */
  message?: string;
  /** Validation diagnostics, if the error originates from validation failure. 校验诊断信息（若错误源于校验失败）。 */
  diagnostics?: Diagnostic[];
  /** Structured metadata describing the error context. 描述错误上下文的结构化元数据。 */
  details?: Record<string, unknown>;
}

/**
 * Typed error for core package precondition rejections.
 *
 * 核心包前置条件拒绝的类型化错误。
 *
 * @public
 */
export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly diagnostics?: Diagnostic[];
  readonly details?: Record<string, unknown>;

  constructor(code: CoreErrorCode, options: CoreErrorOptions = {}) {
    super(options.message ?? code);
    this.name = 'CoreError';
    this.code = code;
    this.diagnostics = options.diagnostics;
    this.details = options.details;
  }
}
