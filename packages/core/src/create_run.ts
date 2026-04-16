import {JsonObject, RunState, SopDefinition} from '@sop-exec/definition';
import {validateDefinition} from '@sop-exec/validator';
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
  };
}
