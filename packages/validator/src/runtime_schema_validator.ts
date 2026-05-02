/**
 * Runtime value validation against a JSON Schema-like subset.
 *
 * 基于 JSON Schema 子集对运行时值进行校验。
 *
 * This file is a thin public facade that delegates to keyword-specific modules.
 */
import {Diagnostic, ValidationResult} from './diagnostic.js';
import {validateArrayKeywords, validateNumberKeywords, validateObjectKeywords, validateStringKeywords} from './runtime_value_validators.js';
import {validateConstKeyword, validateEnumKeyword, validateTypeKeyword} from './runtime_type_validators.js';

/**
 * Parameters for runtime value validation.
 *
 * 运行时值校验的输入参数。
 *
 * @public
 */
export interface RuntimeValidationParams {
  /** JSON Schema-like object. JSON Schema 风格对象。 */
  schema: unknown;
  /** Runtime value to be validated. 待校验的运行时值。 */
  value: unknown;
  /** Optional base diagnostic path. 可选的诊断路径前缀。 */
  path?: string;
}

/**
 * Validate a runtime value against a permissive schema subset.
 *
 * 以宽松策略使用 Schema 子集校验运行时值。
 *
 * @param params - Validation input parameters.
 * 校验输入参数。
 * @returns Validation result with collected diagnostics.
 * 聚合诊断后的校验结果。
 *
 * @public
 */
export function validateRuntimeValue(params: RuntimeValidationParams): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  validateRuntimeSchemaValue(params.schema, params.value, params.path ?? '', diagnostics);

  return {
    'ok': diagnostics.length === 0,
    diagnostics,
  };
}

export function validateRuntimeSchemaValue(schema: unknown, value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isPlainObject(schema)) {
    return;
  }

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
