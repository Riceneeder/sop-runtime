import {JsonObject, JsonValue, StepPacket, RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {renderJsonValueTemplates} from './expression_evaluator.js';
import {assertDefinitionMatchesRun, CurrentStepView, getCurrentStep} from './get_current_step.js';

export type CoreStepPacket = StepPacket;

export function buildStepPacket(params: {
  definition: SopDefinition;
  state: RunState;
}): CoreStepPacket {
  assertDefinitionMatchesRun(params);
  const currentStep = resolveReadyStep(params);

  const renderedInputs = renderStepInputs({
    'step': currentStep.step,
    'state': params.state,
  });

  return {
    'run_id': params.state.run_id,
    'step_id': currentStep.step.id,
    'attempt': currentStep.attempt,
    'inputs': renderedInputs,
    'executor': structuredClone(currentStep.step.executor),
    'output_schema': currentStep.step.output_schema,
  };
}

function resolveReadyStep(params: {
  definition: SopDefinition;
  state: RunState;
}): CurrentStepView {
  if (params.state.phase !== 'ready') {
    throw new CoreError('invalid_state', {
      'message': 'Step packets can only be built while the run phase is ready.',
      'details': {'phase': params.state.phase},
    });
  }

  const currentStep = getCurrentStep({
    'definition': params.definition,
    'state': params.state,
  });
  if (currentStep === null) {
    throw new CoreError('invalid_state', {
      'message': 'No current step available for step packet construction.',
      'details': {'phase': params.state.phase},
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

  return currentStep;
}

function renderStepInputs(params: {
  step: SopDefinition['steps'][number];
  state: RunState;
}): JsonObject {
  const rendered = renderJsonValueTemplates({
    'value': params.step.inputs,
    'state': params.state,
  });
  if (!isJsonObject(rendered)) {
    throw new CoreError('expression_evaluation_failed', {
      'message': 'Step inputs must resolve to a JSON object.',
      'details': {'step_id': params.step.id},
    });
  }
  return rendered;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
