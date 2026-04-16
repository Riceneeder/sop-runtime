import {SopDefinition} from '@sop-exec/definition';
import {Diagnostic, ValidationResult} from './diagnostic';

export function validateDefinition(definition: SopDefinition): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  const seenStepIds = new Set<string>();

  for (const step of definition.steps) {
    if (seenStepIds.has(step.id)) {
      diagnostics.push({
        'code': 'duplicate_step_id',
        'message': `Duplicate step id: ${step.id}`,
        'path': `steps.${step.id}`,
      });
      continue;
    }

    seenStepIds.add(step.id);
  }

  if (!seenStepIds.has(definition.entry_step)) {
    diagnostics.push({
      'code': 'entry_step_missing',
      'message': `Entry step does not exist: ${definition.entry_step}`,
      'path': 'entry_step',
    });
  }

  return {
    'ok': diagnostics.length === 0,
    diagnostics,
  };
}
