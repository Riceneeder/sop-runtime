/**
 * Runtime value validation against a JSON Schema-like subset.
 *
 * 基于 JSON Schema 子集对运行时值进行校验。
 */
import {Diagnostic, ValidationResult} from './diagnostic.js';
import {joinPath} from './path.js';

const SUPPORTED_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);

type SupportedSchemaType = 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string';

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

function validateRuntimeSchemaValue(schema: unknown, value: unknown, path: string, diagnostics: Diagnostic[]): void {
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

function validateTypeKeyword(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const declaredTypes = collectDeclaredTypes(schema.type);
  if (declaredTypes.length === 0) {
    return;
  }

  const matches = declaredTypes.some((declaredType) => matchesDeclaredType(value, declaredType));
  if (matches) {
    return;
  }

  diagnostics.push({
    'code': 'schema_type',
    'message': declaredTypes.length === 1
      ? `Expected ${declaredTypes[0]}.`
      : `Expected one of: ${declaredTypes.join(', ')}`,
    'path': path,
  });
}

function validateEnumKeyword(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(schema.enum)) {
    return;
  }

  if (schema.enum.some((candidate) => isDeepEqual(candidate, value))) {
    return;
  }

  diagnostics.push({'code': 'schema_enum', 'message': 'Value is not in enum.', 'path': path});
}

function validateConstKeyword(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!Object.hasOwn(schema, 'const')) {
    return;
  }

  if (isDeepEqual(schema.const, value)) {
    return;
  }

  diagnostics.push({'code': 'schema_const', 'message': 'Value does not match const.', 'path': path});
}

function validateStringKeywords(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (typeof value !== 'string') {
    return;
  }

  const minLength = getNonNegativeInteger(schema.minLength);
  if (minLength === undefined) {
    return;
  }

  if (value.length < minLength) {
    diagnostics.push({'code': 'schema_min_length', 'message': `Expected length >= ${minLength}.`, 'path': path});
  }
}

function validateNumberKeywords(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (typeof value !== 'number') {
    return;
  }

  const minimum = getFiniteNumber(schema.minimum);
  if (minimum === undefined) {
    return;
  }

  if (value < minimum) {
    diagnostics.push({'code': 'schema_minimum', 'message': `Expected number >= ${minimum}.`, 'path': path});
  }
}

function validateArrayKeywords(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(value)) {
    return;
  }

  const minItems = getNonNegativeInteger(schema.minItems);
  if (minItems !== undefined && value.length < minItems) {
    diagnostics.push({'code': 'schema_min_items', 'message': `Expected at least ${minItems} items.`, 'path': path});
  }

  if (isPlainObject(schema.items)) {
    value.forEach((item, index) => {
      validateRuntimeSchemaValue(schema.items, item, joinPath(path, index), diagnostics);
    });
    return;
  }

  if (!Array.isArray(schema.items)) {
    return;
  }

  schema.items.forEach((itemSchema, index) => {
    if (index >= value.length || !isPlainObject(itemSchema)) {
      return;
    }

    validateRuntimeSchemaValue(itemSchema, value[index], joinPath(path, index), diagnostics);
  });
}

function validateObjectKeywords(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isPlainObject(value)) {
    return;
  }

  validateRequiredKeywords(schema.required, value, path, diagnostics);

  const minProperties = getNonNegativeInteger(schema.minProperties);
  if (minProperties !== undefined && Object.keys(value).length < minProperties) {
    diagnostics.push({
      'code': 'schema_min_properties',
      'message': `Expected at least ${minProperties} properties.`,
      'path': path,
    });
  }

  const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
  if (properties !== undefined) {
    validatePropertiesKeyword(properties, value, path, diagnostics);
  }

  validateAdditionalPropertiesKeyword(schema.additionalProperties, properties, value, path, diagnostics);
}

function validateRequiredKeywords(
  required: unknown,
  value: Record<string, unknown>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(required)) {
    return;
  }

  for (const key of required) {
    if (typeof key !== 'string' || Object.hasOwn(value, key)) {
      continue;
    }

    diagnostics.push({
      'code': 'schema_required',
      'message': `Missing required property: ${key}`,
      'path': joinPath(path, key),
    });
  }
}

function validatePropertiesKeyword(
  properties: Record<string, unknown>,
  value: Record<string, unknown>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key) || !isPlainObject(propertySchema)) {
      continue;
    }

    validateRuntimeSchemaValue(propertySchema, value[key], joinPath(path, key), diagnostics);
  }
}

function validateAdditionalPropertiesKeyword(
  additionalProperties: unknown,
  properties: Record<string, unknown> | undefined,
  value: Record<string, unknown>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (properties !== undefined && Object.hasOwn(properties, key)) {
        continue;
      }

      diagnostics.push({
        'code': 'schema_additional_property',
        'message': `Unexpected property: ${key}`,
        'path': joinPath(path, key),
      });
    }
    return;
  }

  if (!isPlainObject(additionalProperties)) {
    return;
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    if (properties !== undefined && Object.hasOwn(properties, key)) {
      continue;
    }

    validateRuntimeSchemaValue(additionalProperties, propertyValue, joinPath(path, key), diagnostics);
  }
}

function collectDeclaredTypes(typeKeyword: unknown): SupportedSchemaType[] {
  if (typeof typeKeyword === 'string') {
    return isSupportedSchemaType(typeKeyword) ? [typeKeyword] : [];
  }

  if (!Array.isArray(typeKeyword)) {
    return [];
  }

  const declaredTypes: SupportedSchemaType[] = [];
  for (const item of typeKeyword) {
    if (typeof item !== 'string' || !isSupportedSchemaType(item) || declaredTypes.includes(item)) {
      continue;
    }

    declaredTypes.push(item);
  }

  return declaredTypes;
}

function matchesDeclaredType(value: unknown, declaredType: SupportedSchemaType): boolean {
  if (declaredType === 'array') {
    return Array.isArray(value);
  }

  if (declaredType === 'boolean') {
    return typeof value === 'boolean';
  }

  if (declaredType === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }

  if (declaredType === 'null') {
    return value === null;
  }

  if (declaredType === 'number') {
    return typeof value === 'number';
  }

  if (declaredType === 'object') {
    return isPlainObject(value);
  }

  return typeof value === 'string';
}

function isSupportedSchemaType(value: string): value is SupportedSchemaType {
  return SUPPORTED_SCHEMA_TYPES.has(value);
}

function getNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

function getFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => isDeepEqual(item, right[index]));
  }

  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => Object.hasOwn(right, key) && isDeepEqual(left[key], right[key]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
