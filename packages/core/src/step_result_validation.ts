import {
  EXECUTOR_RESULT_STATUSES,
  StepError,
  StepResult,
} from '@sop-runtime/definition';
import {isJsonSafeValue, isStrictPlainObject} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';

export const STEP_RESULT_ALLOWED_KEYS = new Set([
  'run_id',
  'step_id',
  'attempt',
  'status',
  'output',
  'artifacts',
  'error',
  'metrics',
]);

export function validateStepResultShape(stepResult: StepResult): void {
  const value = stepResult as unknown;
  if (!isStrictPlainObject(value)) {
    throw new CoreError('step_result_rejected', {
      'message': 'Step result must be an object.',
    });
  }

  for (const key of Object.keys(value)) {
    if (!STEP_RESULT_ALLOWED_KEYS.has(key)) {
      throw new CoreError('step_result_rejected', {
        'message': `Unexpected step result field: ${key}.`,
        'details': {'field': key},
      });
    }
  }

  if (typeof value.run_id !== 'string') {
    throw new CoreError('step_result_rejected', {'message': 'Step result run_id must be a string.'});
  }
  if (typeof value.step_id !== 'string') {
    throw new CoreError('step_result_rejected', {'message': 'Step result step_id must be a string.'});
  }
  if (typeof value.attempt !== 'number' || !Number.isInteger(value.attempt) || value.attempt < 1) {
    throw new CoreError('step_result_rejected', {'message': 'Step result attempt must be a positive integer.'});
  }
  if (
    typeof value.status !== 'string'
    || !EXECUTOR_RESULT_STATUSES.includes(value.status as (typeof EXECUTOR_RESULT_STATUSES)[number])
  ) {
    throw new CoreError('step_result_rejected', {'message': 'Step result status is not supported.'});
  }
  if (value.output !== undefined && !isJsonSafeObject(value.output)) {
    throw new CoreError('step_result_rejected', {'message': 'Step result output must be a JSON object when present.'});
  }
  if (value.metrics !== undefined && !isJsonSafeObject(value.metrics)) {
    throw new CoreError('step_result_rejected', {'message': 'Step result metrics must be a JSON object when present.'});
  }
  if (value.artifacts !== undefined && !isStringRecord(value.artifacts)) {
    throw new CoreError('step_result_rejected', {'message': 'Step result artifacts must be a string map when present.'});
  }
  if (value.error !== undefined && !isValidStepError(value.error)) {
    throw new CoreError('step_result_rejected', {'message': 'Step result error payload is invalid.'});
  }
}

function isJsonSafeObject(value: unknown): value is Record<string, unknown> {
  return isStrictPlainObject(value) && Object.values(value).every((item) => isJsonSafeValue(item));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isStrictPlainObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isValidStepError(value: unknown): value is StepError | null {
  if (value === null) {
    return true;
  }

  return isStrictPlainObject(value)
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && (value.details === undefined || isJsonSafeObject(value.details));
}
