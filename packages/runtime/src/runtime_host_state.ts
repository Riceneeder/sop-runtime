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

export async function getRunStateImpl(store: StateStore, runId: string): Promise<RunState> {
  return requireRun(store, runId);
}

export async function getCurrentStepImpl(
  store: StateStore,
  definition: SopDefinition,
  runId: string,
): Promise<CurrentStepView | null> {
  const state = await requireRun(store, runId);
  assertDefinitionMatchesRun(definition, state);
  return getCurrentStep({'definition': definition, state});
}
