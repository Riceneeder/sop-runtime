import {AcceptedStepResult, Decision, RunState, SopDefinition} from '@sop-runtime/definition';
import {RuntimeError} from './runtime_error.js';

export type {Decision};

/** Supplies the supervision outcome after a step result has been accepted. 在步骤结果被接纳后提供监督决策 outcome。 */
export interface DecisionProvider {
  decide(input: {
    definition: SopDefinition;
    state: RunState;
    accepted_result: AcceptedStepResult;
  }): Promise<Decision>;
}

/** Chooses the current step's default outcome without external supervision. 在无外部监督时为当前步骤选择默认 outcome。 */
export class DefaultDecisionProvider implements DecisionProvider {
  async decide(input: {
    definition: SopDefinition;
    state: RunState;
    accepted_result: AcceptedStepResult;
  }): Promise<Decision> {
    if (input.state.current_step_id === null || input.state.current_attempt === null) {
      throw new RuntimeError('invalid_runtime_state', {
        'message': 'Default decisions require a current step and attempt.',
      });
    }

    const currentStep = input.definition.steps.find((step) => step.id === input.state.current_step_id);
    if (currentStep === undefined) {
      throw new RuntimeError('invalid_runtime_state', {
        'message': 'Current step is missing from the SOP definition.',
        'details': {'step_id': input.state.current_step_id},
      });
    }

    return {
      'run_id': input.state.run_id,
      'step_id': input.state.current_step_id,
      'attempt': input.state.current_attempt,
      'outcome_id': currentStep.supervision.default_outcome,
      'reason': `default outcome for ${input.accepted_result.status}`,
    };
  }
}
