import {JsonObject, RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error';
import {renderJsonValueTemplates} from './expression_evaluator';
import {assertDefinitionMatchesRun} from './get_current_step';

export function renderFinalOutput(params: {
  definition: SopDefinition;
  state: RunState;
}): JsonObject {
  assertDefinitionMatchesRun(params);

  if (params.state.phase !== 'terminated') {
    throw new CoreError('invalid_state', {
      'message': 'Final output can only be rendered after the run has terminated.',
      'details': {
        'phase': params.state.phase,
        'status': params.state.status,
      },
    });
  }

  const rendered = renderJsonValueTemplates({
    'value': params.definition.final_output,
    'state': params.state,
  });
  if (!isJsonObject(rendered)) {
    throw new CoreError('expression_evaluation_failed', {
      'message': 'Final output must resolve to a JSON object.',
    });
  }

  return rendered;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
