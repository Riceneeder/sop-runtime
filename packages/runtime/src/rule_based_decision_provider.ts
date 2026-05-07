import { AcceptedStepResult, Decision, RunState, SopDefinition } from '@sop-runtime/definition';
import { evaluateExpressionTemplate } from '@sop-runtime/core';
import { DecisionProvider } from './decision_provider.js';
import { RuntimeError } from './runtime_error.js';

export interface RuleBasedDecisionRule {
  when: string;
  outcome_id: string;
  reason?: string;
}

export class RuleBasedDecisionProvider implements DecisionProvider {
  private readonly rules: readonly RuleBasedDecisionRule[];
  private readonly fallbackOutcomeId: string | undefined;

  constructor(options: {
    rules: readonly RuleBasedDecisionRule[];
    fallback_outcome_id?: string;
  }) {
    this.rules = options.rules;
    this.fallbackOutcomeId = options.fallback_outcome_id;
  }

  async decide(input: {
    definition: SopDefinition;
    state: RunState;
    accepted_result: AcceptedStepResult;
  }): Promise<Decision> {
    const { definition, state } = input;
    if (state.current_step_id === null || state.current_attempt === null) {
      throw new RuntimeError('invalid_runtime_state', {
        message: 'Rule-based decisions require a current step and attempt.',
      });
    }

    const currentStep = definition.steps.find((step) => step.id === state.current_step_id);
    if (currentStep === undefined) {
      throw new RuntimeError('invalid_runtime_state', {
        message: 'Current step is missing from the SOP definition.',
        details: { step_id: state.current_step_id },
      });
    }

    for (const rule of this.rules) {
      const value = evaluateExpressionTemplate({ template: rule.when, state });
      if (isTruthy(value)) {
        validateOutcome(currentStep.supervision.allowed_outcomes.map((o) => o.id), rule.outcome_id);
        return {
          run_id: state.run_id,
          step_id: state.current_step_id,
          attempt: state.current_attempt,
          outcome_id: rule.outcome_id,
          reason: rule.reason ?? 'rule-based decision',
        };
      }
    }

    if (this.fallbackOutcomeId !== undefined) {
      validateOutcome(currentStep.supervision.allowed_outcomes.map((o) => o.id), this.fallbackOutcomeId);
      return {
        run_id: state.run_id,
        step_id: state.current_step_id,
        attempt: state.current_attempt,
        outcome_id: this.fallbackOutcomeId,
        reason: 'fallback decision',
      };
    }

    throw new RuntimeError('invalid_runtime_state', {
      message: 'No rule matched and no fallback outcome configured.',
      details: { step_id: state.current_step_id, attempt: state.current_attempt },
    });
  }
}

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (value === 0) return false;
  if (value === '') return false;
  if (typeof value === 'number' && Number.isNaN(value)) return false;
  return true;
}

function validateOutcome(allowedOutcomeIds: string[], outcomeId: string): void {
  if (!allowedOutcomeIds.includes(outcomeId)) {
    throw new RuntimeError('invalid_runtime_state', {
      message: `Outcome "${outcomeId}" is not in allowed outcomes: ${allowedOutcomeIds.join(', ')}.`,
    });
  }
}
