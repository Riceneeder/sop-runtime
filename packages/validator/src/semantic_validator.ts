/**
 * Semantic validation that checks cross-reference integrity inside a definition.
 *
 * 检查定义内部引用关系与一致性的语义层校验。
 */
import {SopDefinition} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic.js';
import {joinPath} from './path.js';

/**
 * Validate step ids, outcomes, transitions, and the declared entry step.
 *
 * 校验步骤标识、outcome、转移规则以及入口步骤的引用正确性。
 *
 * @param definition - SOP definition to inspect.
 * 需要检查引用关系的 SOP 定义。
 * @returns Semantic diagnostics discovered in the definition.
 * 在定义中发现的语义层诊断信息。
 */
export function validateSemanticDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seenStepIds = new Set<string>();
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  const knownStepIds = new Set<string>();

  for (const step of steps) {
    if (typeof step === 'object' && step !== null && typeof step.id === 'string') {
      knownStepIds.add(step.id);
    }
  }

  for (const [stepIndex, step] of steps.entries()) {
    if (typeof step !== 'object' || step === null) {
      continue;
    }

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

    const allowedOutcomes = Array.isArray(step.supervision?.allowed_outcomes) ? step.supervision.allowed_outcomes : [];
    const outcomeIds = new Set<string>();
    for (const [outcomeIndex, outcome] of allowedOutcomes.entries()) {
      if (typeof outcome !== 'object' || outcome === null || typeof outcome.id !== 'string') {
        continue;
      }

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

    if (typeof step.supervision?.default_outcome === 'string' && !outcomeIds.has(step.supervision.default_outcome)) {
      diagnostics.push({
        'code': 'default_outcome_missing',
        'message': `Default outcome does not exist: ${step.supervision.default_outcome}`,
        'path': joinPath('steps', stepIndex, 'supervision', 'default_outcome'),
      });
    }

    const transitions = typeof step.transitions === 'object' && step.transitions !== null && !Array.isArray(step.transitions)
      ? step.transitions
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

  if (typeof definition.entry_step === 'string' && !knownStepIds.has(definition.entry_step)) {
    diagnostics.push({
      'code': 'entry_step_missing',
      'message': `Entry step does not exist: ${definition.entry_step}`,
      'path': 'entry_step',
    });
  }

  return diagnostics;
}
