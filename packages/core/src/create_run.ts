import {JsonObject, RunState, SopDefinition, StepState} from '@sop-runtime/definition';
import {validateDefinition} from '@sop-runtime/validator';
import {CoreError} from './core_error';

export function createRun(params: {
  definition: SopDefinition;
  input: JsonObject;
  runId: string;
}): RunState {
  const validation = validateDefinition(params.definition);
  if (!validation.ok) {
    throw new CoreError('Definition validation failed.');
  }

  const runInput = {
    ...params.definition.defaults,
    ...params.input,
  };
  const steps: Record<string, StepState> = {};
  for (const step of params.definition.steps) {
    steps[step.id] = {
      'step_id': step.id,
      'status': step.id === params.definition.entry_step ? 'active' : 'pending',
      'attempt_count': step.id === params.definition.entry_step ? 1 : 0,
    };
  }

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
    'history': [{
      'kind': 'run_created',
      'step_id': params.definition.entry_step,
    }],
  };
}
