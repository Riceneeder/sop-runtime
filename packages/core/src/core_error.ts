import {Diagnostic} from '@sop-runtime/validator';

export const CORE_ERROR_CODES = [
  'definition_invalid',
  'run_input_invalid',
  'invalid_state',
  'step_result_rejected',
  'decision_rejected',
  'expression_evaluation_failed',
] as const;

export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number];

export interface CoreErrorOptions {
  message?: string;
  diagnostics?: Diagnostic[];
  details?: Record<string, unknown>;
}

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
