import { JsonObject, StepResult } from '@sop-runtime/definition';

/** Internal error code for output size exceeded. 输出大小超限的内部错误码。 */
const CODE_OUTPUT_SIZE = 'max_output_bytes_exceeded';
/** Internal error code for artifact count exceeded. 制品数量超限的内部错误码。 */
const CODE_ARTIFACT_COUNT = 'max_artifacts_exceeded';
/** Internal error code for non-serializable output. 输出无法序列化的内部错误码。 */
const CODE_NON_SERIALIZABLE = 'non_serializable_output';

/**
 * Max allowed value for setTimeout in milliseconds (signed 32-bit int).
 *
 * setTimeout 最大允许值（有符号 32 位整数）。
 *
 * @public
 */
export const MAX_SET_TIMEOUT_MS = 2_147_483_647;

/**
 * Policy for handling payloads that exceed resource limits.
 *
 * 超出资源限制时的负载处理策略。
 *
 * @public
 */
export type InvalidPayloadPolicy = 'convert_to_sandbox_error' | 'preserve';

/**
 * Parameters for enforceResourceLimits.
 *
 * enforceResourceLimits 的参数。
 *
 * @public
 */
export interface EnforceResourceLimitsParams {
  /** The step result to enforce limits against. 需要执行限制的步骤结果。 */
  result: StepResult;
  /** The resource limits to enforce. 需要执行限制的资源限制。 */
  resourceLimits: { max_output_bytes: number; max_artifacts: number };
  /** Run identifier for error result construction. 用于错误结果构造的运行标识符。 */
  runId: string;
  /** Step identifier for error result construction. 用于错误结果构造的步骤标识符。 */
  stepId: string;
  /** Attempt number for error result construction. 用于错误结果构造的尝试次数。 */
  attempt: number;
  /** Policy for handling invalid payloads (default: convert_to_sandbox_error). 处理无效负载的策略（默认：convert_to_sandbox_error）。 */
  invalidPayloadPolicy?: InvalidPayloadPolicy;
}

/**
 * Result indicating the handler timed out.
 *
 * 指示处理器超时的结果。
 *
 * @public
 */
export interface TimeoutResult {
  kind: 'timeout';
}

/**
 * Result indicating the handler threw an error.
 *
 * 指示处理器抛出错误的结果。
 *
 * @public
 */
export interface ErrorResult {
  kind: 'error';
  error: unknown;
}

/**
 * Result indicating the handler completed successfully.
 *
 * 指示处理器成功完成的结果。
 *
 * @public
 */
export interface HandlerResult {
  kind: 'result';
  result: StepResult;
}

/**
 * Execute a handler function with a timeout guard.
 *
 * 在超时保护下执行处理器函数。
 *
 * @param handler - The handler to execute.
 * @param timeoutSecs - Timeout in seconds.
 * @returns The result of execution (handler result, timeout, or error).
 * @public
 */
export async function executeHandlerWithTimeout(
  handler: () => Promise<StepResult> | StepResult,
  timeoutSecs: number,
): Promise<HandlerResult | TimeoutResult | ErrorResult> {
  const safePromise = Promise.resolve()
    .then(() => handler())
    .then((result) => ({ 'kind': 'result' as const, 'result': result }))
    .catch((err) => ({ 'kind': 'error' as const, 'error': err }));

  const timeoutMs = normalizeTimeoutMs(timeoutSecs);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<TimeoutResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({ 'kind': 'timeout' });
    }, timeoutMs);
  });

  const startTime = Date.now();
  const outcome = await Promise.race([safePromise, timeoutPromise]);
  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }

  if (outcome.kind === 'result') {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= timeoutMs) {
      return { 'kind': 'timeout' };
    }
  }

  return outcome;
}

/**
 * Enforce output size and artifact count limits on a step result.
 *
 * 对步骤结果执行输出大小和制品数量限制。
 *
 * @param params - The enforcement parameters.
 * @returns The original result if limits are satisfied, or a sandbox_error result if limits are exceeded.
 * @public
 */
export function enforceResourceLimits(params: EnforceResourceLimitsParams): StepResult {
  const policy = params.invalidPayloadPolicy ?? 'convert_to_sandbox_error';
  const { result, resourceLimits, runId, stepId, attempt } = params;

  const artifactResult = enforceArtifactLimit(result, resourceLimits, runId, stepId, attempt, policy);
  if (artifactResult !== result) return artifactResult;

  if (result.status !== 'success') return result;

  return enforceOutputLimit(result, resourceLimits, runId, stepId, attempt, policy);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function enforceArtifactLimit(
  result: StepResult,
  resourceLimits: { max_output_bytes: number; max_artifacts: number },
  runId: string,
  stepId: string,
  attempt: number,
  policy: InvalidPayloadPolicy,
): StepResult {
  const artifacts = result.artifacts;

  if (policy === 'preserve' && artifacts !== undefined && !isStringRecord(artifacts)) {
    return result;
  }

  const artifactCount = Object.keys(artifacts ?? {}).length;
  if (artifactCount <= resourceLimits.max_artifacts) return result;

  return {
    'run_id': runId,
    'step_id': stepId,
    'attempt': attempt,
    'status': 'sandbox_error',
    'error': {
      'code': CODE_ARTIFACT_COUNT,
      'message': 'Step artifacts exceed max_artifacts.',
      'details': {
        'artifact_count': artifactCount,
        'max_artifacts': resourceLimits.max_artifacts,
      },
    },
  };
}

function enforceOutputLimit(
  result: StepResult,
  resourceLimits: { max_output_bytes: number; max_artifacts: number },
  runId: string,
  stepId: string,
  attempt: number,
  policy: InvalidPayloadPolicy,
): StepResult {
  if (policy === 'preserve' && result.output !== undefined && !isJsonSafeObject(result.output)) {
    return result;
  }

  const outputSize = computeJsonUtf8Size(result.output ?? {});

  if (outputSize !== null) {
    if (outputSize <= resourceLimits.max_output_bytes) return result;

    return {
      'run_id': runId,
      'step_id': stepId,
      'attempt': attempt,
      'status': 'sandbox_error',
      'error': {
        'code': CODE_OUTPUT_SIZE,
        'message': 'Step output exceeds max_output_bytes.',
        'details': {
          'output_bytes': outputSize,
          'max_output_bytes': resourceLimits.max_output_bytes,
        },
      },
    };
  }

  if (policy === 'preserve') return result;

  return {
    'run_id': runId,
    'step_id': stepId,
    'attempt': attempt,
    'status': 'sandbox_error',
    'error': {
      'code': CODE_NON_SERIALIZABLE,
      'message': 'Step output could not be serialized to JSON.',
    },
  };
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function isJsonSafeValue(value: unknown, seen: Set<object>): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;

  if (seen.has(value)) return false;
  seen.add(value);

  let ok: boolean;
  if (Array.isArray(value)) {
    ok = true;
    for (let i = 0; i < value.length && ok; i++) {
      ok = isJsonSafeValue(value[i], seen);
    }
  } else if (isStrictPlainObject(value)) {
    ok = true;
    const entries = Object.entries(value);
    for (const [, val] of entries) {
      if (!isJsonSafeValue(val, seen)) {
        ok = false;
        break;
      }
    }
  } else {
    ok = false;
  }

  seen.delete(value);
  return ok;
}

function isJsonSafeObject(value: unknown): value is Record<string, unknown> {
  if (!isStrictPlainObject(value)) return false;
  const seen = new Set<object>([value]);
  const entries = Object.entries(value);
  for (const [, val] of entries) {
    if (!isJsonSafeValue(val, seen)) return false;
  }
  return true;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isStrictPlainObject(value) && Object.values(value).every((v) => typeof v === 'string');
}

/**
 * Compute the UTF-8 byte length of a JSON-serialized object.
 *
 * 计算 JSON 序列化后对象的 UTF-8 字节长度。
 *
 * @param value - The JSON object to measure.
 * @returns The byte length, or null if serialization fails.
 * @public
 */
export function computeJsonUtf8Size(value: JsonObject): number | null {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      return null;
    }
    return new TextEncoder().encode(json).byteLength;
  } catch {
    return null;
  }
}

/**
 * Normalize a timeout in seconds to milliseconds, clamped to MAX_SET_TIMEOUT_MS.
 *
 * 将以秒为单位的超时归一化为毫秒，上限为 MAX_SET_TIMEOUT_MS。
 *
 * @param timeoutSecs - Timeout in seconds.
 * @returns Timeout in milliseconds.
 * @public
 */
export function normalizeTimeoutMs(timeoutSecs: number): number {
  const timeoutMs = Math.max(0, timeoutSecs * 1000);
  return Math.min(timeoutMs, MAX_SET_TIMEOUT_MS);
}
