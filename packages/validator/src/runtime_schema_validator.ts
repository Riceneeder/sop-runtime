import { Diagnostic, ValidationResult } from './diagnostic.js';
import { validateArrayKeywords, validateNumberKeywords, validateObjectKeywords, validateStringKeywords } from './runtime_value_validators.js';
import { validateConstKeyword, validateEnumKeyword, validateTypeKeyword } from './runtime_type_validators.js';

export interface RuntimeValidationParams {
  schema: unknown;
  value: unknown;
  path?: string;
}

export function validateRuntimeValue(params: RuntimeValidationParams): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  validateRuntimeSchemaValue({
    'schema': params.schema,
    'value': params.value,
    'path': params.path ?? '',
    'diagnostics': diagnostics,
  });

  return {
    'ok': diagnostics.length === 0,
    diagnostics,
  };
}

export function validateRuntimeSchemaValue(opts: {
  schema: unknown;
  value: unknown;
  path: string;
  diagnostics: Diagnostic[];
}): void {
  if (!isPlainObject(opts.schema)) {
    return;
  }

  const { schema, value, path, diagnostics } = opts;
  validateTypeKeyword(schema, value, path, diagnostics);
  validateEnumKeyword(schema, value, path, diagnostics);
  validateConstKeyword(schema, value, path, diagnostics);
  validateStringKeywords(schema, value, path, diagnostics);
  validateNumberKeywords(schema, value, path, diagnostics);
  validateArrayKeywords(schema, value, path, diagnostics);
  validateObjectKeywords(schema, value, path, diagnostics);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
