import { JsonObject, StepResult } from '@sop-runtime/definition';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_OUTPUT_SIZE = 'max_output_bytes_exceeded';
const CODE_ARTIFACT_COUNT = 'max_artifacts_exceeded';
const CODE_NON_SERIALIZABLE = 'non_serializable_output';
const MAX_SET_TIMEOUT_MS = 2_147_483_647;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

  // Wall-clock check: a synchronous/blocking handler can prevent setTimeout
  // from firing. If the handler took longer than the timeout, reject the result
  // even though the race resolved with the handler outcome.
  if (outcome.kind === 'result') {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= timeoutMs) {
      return { 'kind': 'timeout' };
    }
  }

  return outcome;
}

export function enforceResourceLimits(
  result: StepResult,
  resourceLimits: { max_output_bytes: number; max_artifacts: number },
  runId: string,
  stepId: string,
  attempt: number,
): StepResult {
  // Enforce artifact limits on all statuses — failing attempts still persist
  // artifacts via applyStepResult, so the ceiling must apply regardless.
  const artifactCount = Object.keys(result.artifacts ?? {}).length;
  if (artifactCount > resourceLimits.max_artifacts) {
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

  if (result.status !== 'success') {
    return result;
  }

  const output = result.output ?? {};

  const outputSize = computeJsonUtf8Size(output);
  if (outputSize === null) {
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

  if (outputSize > resourceLimits.max_output_bytes) {
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

  return result;
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

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
