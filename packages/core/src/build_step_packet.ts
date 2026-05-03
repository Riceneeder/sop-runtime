import {JsonObject, JsonValue, StepPacket, RunState, SopDefinition} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';
import {renderJsonValueTemplates} from './expression_evaluator.js';
import {assertDefinitionMatchesRun, CurrentStepView, getCurrentStep} from './get_current_step.js';

/**
 * Resolved step packet type, exported for external consumers.
 *
 * 已解析的步骤数据包类型，导出供外部消费者使用。
 *
 * @public
 */
export type CoreStepPacket = StepPacket;

/**
 * Build a fully resolved StepPacket for the current step, rendering expression templates in inputs and executor config.
 *
 * 为当前步骤构建完全解析的 StepPacket，渲染输入和执行器配置中的表达式模板。
 *
 * @param params - Object containing the definition and current run state.
 * @param params.definition - The SOP definition.
 * @param params.state - The current run state (must be in ready phase).
 * @returns The built step packet.
 * @throws {CoreError} If the run is not ready or the current step is not active.
 * @public
 */
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

/**
 * Resolve and validate that the current step is in the ready phase with active status.
 *
 * 解析并验证当前步骤处于 ready 阶段且状态为 active。
 */
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

/**
 * Render expression templates in the step's input definitions.
 *
 * 渲染步骤输入定义中的表达式模板。
 */
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
