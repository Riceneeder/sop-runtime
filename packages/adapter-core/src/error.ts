import { JsonObject } from '@sop-runtime/definition';

/**
 * Typed error for adapter-layer failures.
 *
 * 适配器层失败的类型化错误。
 *
 * @public
 */
export class AdapterError extends Error {
  /** Machine-readable error code. 机器可读的错误码。 */
  readonly code: string;
  /** Structured metadata describing the error context. 描述错误上下文的结构化元数据。 */
  readonly details?: JsonObject;

  constructor(code: string, message: string, details?: JsonObject) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Normalize an unknown error into an AdapterError.
 *
 * 将未知错误归一化为 AdapterError。
 *
 * @param error - The raw error (Error, string, or unknown).
 * @param defaultCode - Fallback error code if the input has none.
 * @returns A normalized AdapterError.
 * @public
 */
export function normalizeAdapterError(error: unknown, defaultCode = 'adapter_error'): AdapterError {
  if (error instanceof AdapterError) {
    return error;
  }
  if (error instanceof Error) {
    return new AdapterError(defaultCode, error.message);
  }
  return new AdapterError(defaultCode, String(error));
}

/**
 * Build a merged error details object.
 *
 * 构建合并的错误详情对象。
 *
 * @param base - The base details object (may be undefined).
 * @param extra - Additional fields to merge in.
 * @returns A new JsonObject with all fields merged.
 * @public
 */
export function buildErrorDetails(base: JsonObject | undefined, extra: JsonObject): JsonObject {
  return { ...base, ...extra };
}
