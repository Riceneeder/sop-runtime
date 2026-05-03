import { SopDefinition } from '@sop-runtime/definition';
import { Diagnostic } from './diagnostic.js';
import { joinPath } from './path.js';

/**
 * Validate semantic consistency of an SOP definition (entry step, duplicate IDs, transition references).
 *
 * 校验 SOP 定义的语义一致性（入口步骤、重复 ID、转移引用）。
 *
 * @param definition - The SOP definition to validate.
 * @returns An array of validation diagnostics (empty if valid).
 * @public
 */
export function validateSemanticDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const knownStepIds = computeKnownStepIds(definition.steps);

  validateEntryStep(definition, knownStepIds, diagnostics);

  if (Array.isArray(definition.steps)) {
    const seenStepIds = new Set<string>();
    definition.steps.forEach((step, stepIndex) => {
      if (typeof step !== 'object' || step === null) return;
      validateStepSemantics(step as unknown as Record<string, unknown>, stepIndex, knownStepIds, seenStepIds, diagnostics);
    });
  }

  return diagnostics;
}

function computeKnownStepIds(steps: unknown): Set<string> {
  const known = new Set<string>();
  if (!Array.isArray(steps)) return known;
  for (const step of steps) {
    if (typeof step === 'object' && step !== null && typeof step.id === 'string') {
      known.add(step.id);
    }
  }
  return known;
}

function validateEntryStep(
  definition: SopDefinition,
  knownStepIds: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (typeof definition.entry_step === 'string' && !knownStepIds.has(definition.entry_step)) {
    diagnostics.push({
      'code': 'entry_step_missing',
      'message': `Entry step does not exist: ${definition.entry_step}`,
      'path': 'entry_step',
    });
  }
}

function validateStepSemantics(
  step: Record<string, unknown>,
  stepIndex: number,
  knownStepIds: Set<string>,
  seenStepIds: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (typeof step.id === 'string') {
    if (seenStepIds.has(step.id)) {
      diagnostics.push({
        'code': 'duplicate_step_id',
        'message': `Duplicate step id: ${step.id}`,
        'path': joinPath('steps', stepIndex, 'id'),
      });
    } else {
      seenStepIds.add(step.id);
    }
  }

  const outcomeIds = validateOutcomes(step, stepIndex, diagnostics);
  validateDefaultOutcome(step, stepIndex, outcomeIds, diagnostics);
  validateTransitions(step, stepIndex, outcomeIds, knownStepIds, diagnostics);
}

function validateOutcomes(
  step: Record<string, unknown>,
  stepIndex: number,
  diagnostics: Diagnostic[],
): Set<string> {
  const outcomeIds = new Set<string>();
  const supervision = step.supervision as Record<string, unknown> | undefined;
  const allowedOutcomes = Array.isArray(supervision?.allowed_outcomes)
    ? supervision.allowed_outcomes
    : [];
  for (const [outcomeIndex, outcome] of allowedOutcomes.entries()) {
    if (typeof outcome !== 'object' || outcome === null || typeof outcome.id !== 'string') continue;
    if (outcomeIds.has(outcome.id)) {
      diagnostics.push({
        'code': 'duplicate_step_outcome_id',
        'message': `Duplicate allowed outcome id: ${outcome.id}`,
        'path': joinPath('steps', stepIndex, 'supervision', 'allowed_outcomes', outcomeIndex, 'id'),
      });
    } else {
      outcomeIds.add(outcome.id);
    }
  }
  return outcomeIds;
}

function validateDefaultOutcome(
  step: Record<string, unknown>,
  stepIndex: number,
  outcomeIds: Set<string>,
  diagnostics: Diagnostic[],
): void {
  const supervision = step.supervision as Record<string, unknown> | undefined;
  if (typeof supervision?.default_outcome === 'string' && !outcomeIds.has(supervision.default_outcome)) {
    diagnostics.push({
      'code': 'default_outcome_missing',
      'message': `Default outcome does not exist: ${supervision.default_outcome}`,
      'path': joinPath('steps', stepIndex, 'supervision', 'default_outcome'),
    });
  }
}

function validateTransitions(
  step: Record<string, unknown>,
  stepIndex: number,
  outcomeIds: Set<string>,
  knownStepIds: Set<string>,
  diagnostics: Diagnostic[],
): void {
  const transitions = typeof step.transitions === 'object' && step.transitions !== null && !Array.isArray(step.transitions)
    ? step.transitions as Record<string, unknown>
    : {};

  for (const outcomeId of outcomeIds) {
    if (!Object.hasOwn(transitions, outcomeId)) {
      diagnostics.push({
        'code': 'transition_definition_missing',
        'message': `Transition missing for allowed outcome: ${outcomeId}`,
        'path': joinPath('steps', stepIndex, 'transitions'),
      });
    }
  }

  for (const [transitionKey, transition] of Object.entries(transitions)) {
    if (!outcomeIds.has(transitionKey)) {
      diagnostics.push({
        'code': 'transition_outcome_missing',
        'message': `Transition has no matching allowed outcome: ${transitionKey}`,
        'path': joinPath('steps', stepIndex, 'transitions', transitionKey),
      });
    }

    if (
      typeof transition === 'object'
      && transition !== null
      && typeof (transition as Record<string, unknown>).next_step === 'string'
      && !knownStepIds.has((transition as Record<string, unknown>).next_step as string)
    ) {
      diagnostics.push({
        'code': 'next_step_missing',
        'message': `Transition points to unknown step: ${(transition as Record<string, unknown>).next_step}`,
        'path': joinPath('steps', stepIndex, 'transitions', transitionKey, 'next_step'),
      });
    }
  }
}
