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

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export interface RuntimeErrorOptions {
  message?: string;
  details?: Record<string, unknown>;
}

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
