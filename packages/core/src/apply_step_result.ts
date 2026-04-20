import {
  AcceptedStepResult,
  EXECUTOR_RESULT_STATUSES,
  RunState,
  SopDefinition,
  StepError,
  StepResult,
} from '@sop-runtime/definition';
import {validateRuntimeValue} from '@sop-runtime/validator';
import {CoreError} from './core_error';
import {assertDefinitionMatchesRun, getCurrentStep} from './get_current_step';

const STEP_RESULT_ALLOWED_KEYS = new Set([
  'run_id',
  'step_id',
  'attempt',
  'status',
  'output',
  'artifacts',
  'error',
  'metrics',
]);

export function applyStepResult(params: {
  definition: SopDefinition;
  state: RunState;
  stepResult: StepResult;
  now?: string;
}): RunState {
  assertDefinitionMatchesRun(params);
  assertAcceptingStepResult(params.state);
  validateStepResultShape(params.stepResult);

  const currentStep = getCurrentStep({
    'definition': params.definition,
    'state': params.state,
  });
  if (currentStep === null) {
    throw new CoreError('invalid_state', {
      'message': 'Cannot accept a step result for a terminated run.',
    });
  }

  if (params.stepResult.run_id !== params.state.run_id) {
    throw new CoreError('step_result_rejected', {
      'message': 'Step result run_id does not match the current run.',
      'details': {
        'expected_run_id': params.state.run_id,
        'actual_run_id': params.stepResult.run_id,
      },
    });
  }

  if (params.stepResult.step_id !== currentStep.step_id) {
    throw new CoreError('step_result_rejected', {
      'message': 'Step result step_id does not match the current step.',
      'details': {
        'expected_step_id': currentStep.step_id,
        'actual_step_id': params.stepResult.step_id,
      },
    });
  }

  if (params.stepResult.attempt !== currentStep.attempt) {
    throw new CoreError('step_result_rejected', {
      'message': 'Step result attempt does not match the current attempt.',
      'details': {
        'expected_attempt': currentStep.attempt,
        'actual_attempt': params.stepResult.attempt,
      },
    });
  }

  const acceptedResult = normalizeAcceptedResult({
    'step': currentStep.step,
    'stepResult': params.stepResult,
  });

  return {
    ...params.state,
    'phase': 'awaiting_decision',
    'accepted_results': {
      ...params.state.accepted_results,
      [currentStep.step_id]: acceptedResult,
    },
    'steps': {
      ...params.state.steps,
      [currentStep.step_id]: {
        ...currentStep.step_state,
        'status': 'waiting_decision',
        'last_result_status': acceptedResult.status,
      },
    },
    'history': [
      ...params.state.history,
      buildStepResultAcceptedHistory({
        'step_id': currentStep.step_id,
        'attempt': currentStep.attempt,
        'result_status': acceptedResult.status,
        'now': params.now,
      }),
    ],
    'updated_at': params.now ?? params.state.updated_at,
  };
}

function assertAcceptingStepResult(state: RunState): void {
  if (state.status !== 'running' || state.phase !== 'ready') {
    throw new CoreError('invalid_state', {
      'message': 'Step results can only be accepted while the run is running and ready.',
      'details': {
        'status': state.status,
        'phase': state.phase,
      },
    });
  }
}

function validateStepResultShape(stepResult: StepResult): void {
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

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizeAcceptedResult(params: {
  step: SopDefinition['steps'][number];
  stepResult: StepResult;
}): AcceptedStepResult {
  if (params.stepResult.status !== 'success') {
    return {
      'step_id': params.stepResult.step_id,
      'attempt': params.stepResult.attempt,
      'status': params.stepResult.status,
      'output': undefined,
      'artifacts': cloneOptional(params.stepResult.artifacts),
      'error': cloneOptional(params.stepResult.error),
      'metrics': cloneOptional(params.stepResult.metrics),
    };
  }

  if (params.stepResult.output === undefined) {
    return {
      'step_id': params.stepResult.step_id,
      'attempt': params.stepResult.attempt,
      'status': 'invalid_output',
      'output': undefined,
      'artifacts': cloneOptional(params.stepResult.artifacts),
      'error': buildMissingOutputError(),
      'metrics': cloneOptional(params.stepResult.metrics),
    };
  }

  const validation = validateRuntimeValue({
    'schema': params.step.output_schema,
    'value': params.stepResult.output,
    'path': 'output',
  });
  if (validation.ok) {
    return {
      'step_id': params.stepResult.step_id,
      'attempt': params.stepResult.attempt,
      'status': 'success',
      'output': cloneOptional(params.stepResult.output),
      'artifacts': cloneOptional(params.stepResult.artifacts),
      'error': cloneOptional(params.stepResult.error),
      'metrics': cloneOptional(params.stepResult.metrics),
    };
  }

  return {
    'step_id': params.stepResult.step_id,
    'attempt': params.stepResult.attempt,
    'status': 'invalid_output',
    'output': undefined,
    'artifacts': cloneOptional(params.stepResult.artifacts),
    'error': buildInvalidOutputError(validation),
    'metrics': cloneOptional(params.stepResult.metrics),
  };
}

function buildMissingOutputError(): StepError {
  return {
    'code': 'invalid_output',
    'message': 'Step result output is required when status is success.',
    'details': {
      'reason': 'missing_output',
    },
  };
}

function buildInvalidOutputError(validation: ReturnType<typeof validateRuntimeValue>): StepError {
  const firstDiagnostic = validation.diagnostics[0];
  return {
    'code': 'invalid_output',
    'message': 'Step output failed output schema validation.',
    'details': firstDiagnostic === undefined
      ? undefined
      : {
        'diagnostic_count': validation.diagnostics.length,
        'first_diagnostic_code': firstDiagnostic.code,
        'first_diagnostic_path': firstDiagnostic.path,
      },
  };
}

function buildStepResultAcceptedHistory(params: {
  step_id: string;
  attempt: number;
  result_status: AcceptedStepResult['status'];
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'step_result_accepted',
    'step_id': params.step_id,
    'attempt': params.attempt,
    'result_status': params.result_status,
  };

  if (params.now !== undefined) {
    return {
      ...entry,
      'at': params.now,
    };
  }

  return entry;
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonSafeObject(value: unknown): value is Record<string, unknown> {
  return isStrictPlainObject(value) && Object.values(value).every((item) => isJsonSafeValue(item));
}

function isJsonSafeValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonSafeValue(item));
  }

  return isJsonSafeObject(value);
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
