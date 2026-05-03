import {
  AcceptedStepResult,
  RunState,
  SopDefinition,
} from '@sop-runtime/definition';
import {
  CurrentStepView,
  evaluateExpressionTemplate,
  getCurrentStep,
} from '@sop-runtime/core';
import { RuntimeError } from './runtime_error.js';
import { StateStore } from './state_store.js';

/**
 * Load a run from the store and throw if it does not exist.
 *
 * 从存储加载运行，若不存在则抛出异常。
 *
 * @param store - The state store.
 * @param runId - The run identifier.
 * @returns The loaded run state.
 * @throws {RuntimeError} If the run is not found.
 * @public
 */
export async function requireRun(store: StateStore, runId: string): Promise<RunState> {
  const state = await store.loadRun(runId);
  if (state === null) {
    throw new RuntimeError('run_not_found', {
      'message': `Run not found: ${runId}`,
      'details': {'run_id': runId},
    });
  }

  return state;
}

/**
 * Assert that a given SOP definition matches the identity of an existing run.
 *
 * 断言给定 SOP 定义与现有运行的身份匹配。
 *
 * @param definition - The SOP definition to check.
 * @param state - The run state to match against.
 * @throws {RuntimeError} If the sop_id or version do not match.
 * @public
 */
export function assertDefinitionMatchesRun(definition: SopDefinition, state: RunState): void {
  if (definition.sop_id === state.sop_id && definition.version === state.sop_version) {
    return;
  }

  throw new RuntimeError('invalid_runtime_state', {
    'message': 'Provided definition does not match the run SOP identity/version.',
    'details': {
      'run_sop_id': state.sop_id,
      'run_sop_version': state.sop_version,
      'definition_sop_id': definition.sop_id,
      'definition_version': definition.version,
    },
  });
}

/**
 * Get the accepted step result for the current step.
 *
 * 获取当前步骤的已接纳步骤结果。
 *
 * @param state - The run state.
 * @returns The accepted step result.
 * @throws {RuntimeError} If there is no current step or no accepted result.
 * @public
 */
export function getCurrentAcceptedResult(state: RunState): AcceptedStepResult {
  if (state.current_step_id === null) {
    throw new RuntimeError('invalid_runtime_state', {
      'message': 'A decision requires a current step.',
    });
  }

  const acceptedResult = state.accepted_results[state.current_step_id];
  if (acceptedResult === undefined) {
    throw new RuntimeError('invalid_runtime_state', {
      'message': 'A decision requires an accepted step result.',
      'details': {'step_id': state.current_step_id},
    });
  }

  return acceptedResult;
}

/**
 * Render a policy key template against the run state, ensuring the result is a string.
 *
 * 基于运行状态渲染策略键模板，确保结果为字符串。
 *
 * @param params - Object containing the template, state, and field name for error reporting.
 * @param params.template - The expression template to render.
 * @param params.state - The run state.
 * @param params.field - The field name for error diagnostics.
 * @returns The rendered string key.
 * @throws {RuntimeError} If the rendered value is not a string.
 * @public
 */
export function renderPolicyKey(params: {
  template: string;
  state: RunState;
  field: string;
}): string {
  const rendered = evaluateExpressionTemplate({
    'template': params.template,
    'state': params.state,
  });
  if (typeof rendered !== 'string') {
    throw new RuntimeError('runtime_key_render_failed', {
      'message': 'Runtime policy key templates must render to strings.',
      'details': {
        'field': params.field,
        'rendered_type': Array.isArray(rendered) ? 'array' : typeof rendered,
      },
    });
  }

  return rendered;
}

/**
 * Load and return a run state by its identifier.
 *
 * 根据标识符加载并返回运行状态。
 *
 * @param store - The state store.
 * @param runId - The run identifier.
 * @returns The run state.
 * @public
 */
export async function getRunStateImpl(store: StateStore, runId: string): Promise<RunState> {
  return requireRun(store, runId);
}

/**
 * Load a run and resolve its current step view.
 *
 * 加载运行并解析其当前步骤视图。
 *
 * @param store - The state store.
 * @param definition - The SOP definition.
 * @param runId - The run identifier.
 * @returns The current step view, or null if terminated.
 * @public
 */
export async function getCurrentStepImpl(
  store: StateStore,
  definition: SopDefinition,
  runId: string,
): Promise<CurrentStepView | null> {
  const state = await requireRun(store, runId);
  assertDefinitionMatchesRun(definition, state);
  return getCurrentStep({'definition': definition, state});
}
