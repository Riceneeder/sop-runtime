import {SopDefinition} from '@sop-exec/definition';
import {Diagnostic, ValidationResult} from './diagnostic';
import {validateExpressionDefinition} from './expression_validator';
import {validateSchemaDefinition} from './schema_validator';
import {validateSemanticDefinition} from './semantic_validator';

export function validateDefinition(definition: SopDefinition): ValidationResult {
  const normalizedDefinition = isPlainObject(definition)
    ? definition
    : {} as SopDefinition;

  const diagnostics: Diagnostic[] = [];

  if (!isPlainObject(definition)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected object.', 'path': ''});
  }

  diagnostics.push(
    ...validateSchemaDefinition(normalizedDefinition),
    ...validateSemanticDefinition(normalizedDefinition),
    ...validateExpressionDefinition(normalizedDefinition),
  );

  return {
    'ok': diagnostics.length === 0,
    diagnostics,
  };
}

function isPlainObject(value: unknown): value is SopDefinition {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
