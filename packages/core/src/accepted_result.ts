import {
  AcceptedStepResult,
  SopDefinition,
  StepError,
  StepResult,
} from '@sop-runtime/definition';
import {validateRuntimeValue} from '@sop-runtime/validator';

export function normalizeAcceptedResult(params: {
  step: SopDefinition['steps'][number];
  stepResult: StepResult;
}): AcceptedStepResult {
  const {step, stepResult} = params;

  if (stepResult.status !== 'success') {
    return normalizeNonSuccessResult(stepResult);
  }

  return validateAndNormalizeSuccessResult({step, stepResult});
}

function normalizeNonSuccessResult(stepResult: StepResult): AcceptedStepResult {
  return {
    'step_id': stepResult.step_id,
    'attempt': stepResult.attempt,
    'status': stepResult.status,
    'output': undefined,
    'artifacts': cloneOptional(stepResult.artifacts),
    'error': cloneOptional(stepResult.error),
    'metrics': cloneOptional(stepResult.metrics),
  };
}

function validateAndNormalizeSuccessResult(params: {
  step: SopDefinition['steps'][number];
  stepResult: StepResult;
}): AcceptedStepResult {
  const {step, stepResult} = params;

  if (stepResult.output === undefined) {
    return {
      'step_id': stepResult.step_id,
      'attempt': stepResult.attempt,
      'status': 'invalid_output',
      'output': undefined,
      'artifacts': cloneOptional(stepResult.artifacts),
      'error': buildMissingOutputError(),
      'metrics': cloneOptional(stepResult.metrics),
    };
  }

  const validation = validateRuntimeValue({
    'schema': step.output_schema,
    'value': stepResult.output,
    'path': 'output',
  });

  if (!validation.ok) {
    return {
      'step_id': stepResult.step_id,
      'attempt': stepResult.attempt,
      'status': 'invalid_output',
      'output': undefined,
      'artifacts': cloneOptional(stepResult.artifacts),
      'error': buildInvalidOutputError(validation),
      'metrics': cloneOptional(stepResult.metrics),
    };
  }

  return {
    'step_id': stepResult.step_id,
    'attempt': stepResult.attempt,
    'status': 'success',
    'output': cloneOptional(stepResult.output),
    'artifacts': cloneOptional(stepResult.artifacts),
    'error': cloneOptional(stepResult.error),
    'metrics': cloneOptional(stepResult.metrics),
  };
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
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
