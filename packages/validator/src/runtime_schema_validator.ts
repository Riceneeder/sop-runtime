import { Diagnostic, ValidationResult } from './diagnostic.js';
import { validateRuntimeSchemaKeywords } from './runtime_schema_keyword_validator.js';
import { validateArrayKeywords, validateNumberKeywords, validateObjectKeywords, validateStringKeywords } from './runtime_value_validators.js';
import { validateConstKeyword, validateEnumKeyword, validateTypeKeyword } from './runtime_type_validators.js';

/**
 * Parameters for validating a runtime value against a JSON Schema.
 *
 * 运行时值校验的参数，用于将值对照 JSON Schema 进行校验。
 *
 * @public
 */
export interface RuntimeValidationParams {
  /** The JSON Schema to validate against. 用于校验的 JSON Schema。 */
  schema: unknown;
  /** The value to validate. 待校验的值。 */
  value: unknown;
  /** Dot-separated path prefix for diagnostic reporting. 诊断报告的点号分隔路径前缀。 */
  path?: string;
}

/**
 * Validate a runtime value against a JSON Schema and return validation diagnostics.
 *
 * 将运行时值对照 JSON Schema 进行校验并返回校验诊断信息。
 *
 * @param params - The validation parameters.
 * @returns A validation result with ok flag and diagnostics array.
 * @public
 */
export function validateRuntimeValue(params: RuntimeValidationParams): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  validateRuntimeSchemaKeywords({
    'schema': params.schema,
    'path': params.path ?? '',
    diagnostics,
  });
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

/**
 * Recursively validate a value against schema keywords, dispatching to keyword-specific validators.
 *
 * 根据 schema 关键字递归校验值，分发到关键字特定的校验器。
 *
 * @param opts - The validation options including schema, value, path, and diagnostics accumulator.
 */
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
