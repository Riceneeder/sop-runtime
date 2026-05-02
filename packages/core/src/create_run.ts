import {JsonObject, RunState, SopDefinition, StepState} from '@sop-runtime/definition';
import {validateDefinition, validateRuntimeValue} from '@sop-runtime/validator';
import {CoreError} from './core_error.js';

export function createRun(params: {
  definition: SopDefinition;
  input: JsonObject;
  runId: string;
  now?: string;
}): RunState {
  const runInput = validateAndMergeInput(params.definition, params.input);
  const steps = buildInitialSteps(params.definition);

  return {
    'run_id': params.runId,
    'sop_id': params.definition.sop_id,
    'sop_version': params.definition.version,
    'status': 'running',
    'phase': 'ready',
    'run_input': runInput,
    'entry_step_id': params.definition.entry_step,
    'current_step_id': params.definition.entry_step,
    'current_attempt': 1,
    steps,
    'accepted_results': {},
    'history': [buildRunCreatedHistory({
      'entryStepId': params.definition.entry_step,
      'now': params.now,
    })],
    'created_at': params.now,
    'updated_at': params.now,
  };
}

function validateAndMergeInput(definition: SopDefinition, input: JsonObject): JsonObject {
  const validation = validateDefinition(definition);
  if (!validation.ok) {
    throw new CoreError('definition_invalid', {
      'message': 'Definition validation failed.',
      'diagnostics': validation.diagnostics,
    });
  }

  const runInput = {
    ...(definition.defaults ?? {}),
    ...input,
  };
  const inputValidation = validateRuntimeValue({
    'schema': definition.input_schema,
    'value': runInput,
    'path': 'run_input',
  });
  if (!inputValidation.ok) {
    throw new CoreError('run_input_invalid', {
      'message': 'Run input validation failed.',
      'diagnostics': inputValidation.diagnostics,
    });
  }

  return runInput;
}

function buildInitialSteps(definition: SopDefinition): Record<string, StepState> {
  const steps: Record<string, StepState> = {};
  for (const step of definition.steps) {
    steps[step.id] = {
      'step_id': step.id,
      'status': step.id === definition.entry_step ? 'active' : 'pending',
      'attempt_count': step.id === definition.entry_step ? 1 : 0,
    };
  }
  return steps;
}

function buildRunCreatedHistory(params: {
  entryStepId: string;
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'run_created',
    'step_id': params.entryStepId,
  };

  if (params.now !== undefined) {
    return {
      ...entry,
      'at': params.now,
    };
  }

  return entry;
}
