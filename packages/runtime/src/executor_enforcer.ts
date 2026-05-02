import { JsonObject, StepResult } from '@sop-runtime/definition';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_OUTPUT_SIZE = 'max_output_bytes_exceeded';
const CODE_ARTIFACT_COUNT = 'max_artifacts_exceeded';
const CODE_NON_SERIALIZABLE = 'non_serializable_output';
const MAX_SET_TIMEOUT_MS = 2_147_483_647;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvalidPayloadPolicy = 'convert_to_sandbox_error' | 'preserve';

export interface EnforceResourceLimitsParams {
  result: StepResult;
  resourceLimits: { max_output_bytes: number; max_artifacts: number };
  runId: string;
  stepId: string;
  attempt: number;
  invalidPayloadPolicy?: InvalidPayloadPolicy;
}

export interface TimeoutResult {
  kind: 'timeout';
}

export interface ErrorResult {
  kind: 'error';
  error: unknown;
}

export interface HandlerResult {
  kind: 'result';
  result: StepResult;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!isJsonSafeValue(value[i], seen)) return false;
    }
    return true;
  }

  if (!isStrictPlainObject(value)) return false;

  const entries = Object.entries(value);
  for (const [, val] of entries) {
    if (!isJsonSafeValue(val, seen)) return false;
  }
  return true;
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

function computeJsonUtf8Size(value: JsonObject): number | null {
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

function normalizeTimeoutMs(timeoutSecs: number): number {
  const timeoutMs = Math.max(0, timeoutSecs * 1000);
  return Math.min(timeoutMs, MAX_SET_TIMEOUT_MS);
}
