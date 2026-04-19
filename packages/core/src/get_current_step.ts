import {RunState, SopDefinition, StepDefinition} from '@sop-runtime/definition';

export interface CurrentStepView {
  step_id: string;
  attempt: number;
  step: StepDefinition;
}

export function getCurrentStep(params: {
  definition: SopDefinition;
  state: RunState;
}): CurrentStepView | null {
  if (params.state.current_step_id === null || params.state.current_attempt === null) {
    return null;
  }

  const step = params.definition.steps.find((item) => item.id === params.state.current_step_id);
  if (!step) {
    return null;
  }

  return {
    'step_id': step.id,
    'attempt': params.state.current_attempt,
    step,
  };
}
