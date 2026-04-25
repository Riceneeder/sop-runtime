import {JsonObject, JsonValue, StepPacket, RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {renderJsonValueTemplates} from './expression_evaluator.js';
import {assertDefinitionMatchesRun, getCurrentStep} from './get_current_step.js';

export type CoreStepPacket = StepPacket;

export function buildStepPacket(params: {
  definition: SopDefinition;
  state: RunState;
}): CoreStepPacket {
  assertDefinitionMatchesRun(params);

  if (params.state.phase !== 'ready') {
    throw new CoreError('invalid_state', {
      'message': 'Step packets can only be built while the run phase is ready.',
      'details': {
        'phase': params.state.phase,
      },
    });
  }

  const currentStep = getCurrentStep({
    'definition': params.definition,
    'state': params.state,
  });
  if (currentStep === null) {
    throw new CoreError('invalid_state', {
      'message': 'No current step available for step packet construction.',
      'details': {
        'phase': params.state.phase,
      },
    });
  }

  if (currentStep.step_state.status !== 'active') {
    throw new CoreError('invalid_state', {
      'message': 'Current step must be active before building a step packet.',
      'details': {
        'step_id': currentStep.step_id,
        'step_status': currentStep.step_state.status,
      },
    });
  }

  const renderedInputs = renderJsonValueTemplates({
    'value': currentStep.step.inputs,
    'state': params.state,
  });
  if (!isJsonObject(renderedInputs)) {
    throw new CoreError('expression_evaluation_failed', {
      'message': 'Step inputs must resolve to a JSON object.',
      'details': {
        'step_id': currentStep.step_id,
      },
    });
  }

  const renderedExecutorPath = renderJsonValueTemplates({
    'value': currentStep.step.executor.path,
    'state': params.state,
  });
  if (typeof renderedExecutorPath !== 'string') {
    throw new CoreError('expression_evaluation_failed', {
      'message': 'Executor path must resolve to a string.',
      'details': {
        'step_id': currentStep.step_id,
      },
    });
  }

  return {
    'run_id': params.state.run_id,
    'step_id': currentStep.step.id,
    'attempt': currentStep.attempt,
    'inputs': renderedInputs,
    'executor': {
      ...currentStep.step.executor,
      'path': renderedExecutorPath,
    },
    'output_schema': currentStep.step.output_schema,
  };
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
