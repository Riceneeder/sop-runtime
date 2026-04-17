import {JsonObject, JsonValue, StepPacket, RunState, SopDefinition} from '@sop-exec/definition';
import {CoreError} from './core_error';

export type CoreStepPacket = StepPacket;

function resolveInput(template: string, state: RunState): JsonValue {
  if (template === '${run.input.company}') {
    const company = state.run_input.company;
    if (company === undefined) {
      throw new CoreError('Missing run input: company.');
    }

    return company;
  }

  return template;
}

export function buildStepPacket(params: {
  definition: SopDefinition;
  state: RunState;
}): CoreStepPacket {
  const step = params.definition.steps.find((item) => item.id === params.state.current_step_id);
  if (!step || params.state.current_attempt === null) {
    throw new CoreError('No active step.');
  }

  const inputs: JsonObject = {};
  for (const [key, value] of Object.entries(step.inputs)) {
    inputs[key] = typeof value === 'string' ? resolveInput(value, params.state) : value;
  }

  return {
    'run_id': params.state.run_id,
    'step_id': step.id,
    'attempt': params.state.current_attempt,
    inputs,
    'executor': step.executor,
    'output_schema': step.output_schema,
  };
}
