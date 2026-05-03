import {JsonObject, RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {renderJsonValueTemplates} from './expression_evaluator.js';
import {assertDefinitionMatchesRun} from './get_current_step.js';

/**
 * Render the final_output template from the definition against the terminated run state.
 *
 * 基于已终止的运行状态渲染定义中的 final_output 模板。
 *
 * @param params - Object containing the definition and terminated run state.
 * @param params.definition - The SOP definition with final_output template.
 * @param params.state - The terminated run state.
 * @returns The rendered final output as a JSON object.
 * @throws {CoreError} If the run is not terminated or the output is not a JSON object.
 * @public
 */
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
