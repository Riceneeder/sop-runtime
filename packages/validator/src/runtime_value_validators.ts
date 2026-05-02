/**
 * String, number, array, and object keyword validators for runtime value validation.
 *
 * 运行时值校验中用到的字符串、数字、数组和对象关键字校验器。
 */
import {Diagnostic} from './diagnostic.js';
import {joinPath} from './path.js';
import {validateRuntimeSchemaValue} from './runtime_schema_validator.js';

/**
 * Validate string-related keywords (minLength, etc.) against a runtime string value.
 */
export function validateStringKeywords(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (typeof value !== 'string') {
    return;
  }

  const minLength = getNonNegativeInteger(schema.minLength);
  if (minLength !== undefined && value.length < minLength) {
    diagnostics.push({'code': 'schema_min_length', 'message': `Expected length >= ${minLength}.`, 'path': path});
  }
}

/**
 * Validate number-related keywords (minimum, etc.) against a runtime number value.
 */
export function validateNumberKeywords(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (typeof value !== 'number') {
    return;
  }

  const minimum = getFiniteNumber(schema.minimum);
  if (minimum !== undefined && value < minimum) {
    diagnostics.push({'code': 'schema_minimum', 'message': `Expected number >= ${minimum}.`, 'path': path});
  }
}

/**
 * Validate array-related keywords (minItems, items) against a runtime array value.
 */
export function validateArrayKeywords(
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
      validateRuntimeSchemaValue({ 'schema': schema.items, 'value': item, 'path': joinPath(path, index), 'diagnostics': diagnostics });
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

    validateRuntimeSchemaValue({ 'schema': itemSchema, 'value': value[index], 'path': joinPath(path, index), 'diagnostics': diagnostics });
  });
}

/**
 * Validate object-related keywords (required, minProperties, properties, additionalProperties).
 */
export function validateObjectKeywords(
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

    validateRuntimeSchemaValue({ 'schema': propertySchema, 'value': value[key], 'path': joinPath(path, key), 'diagnostics': diagnostics });
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

    validateRuntimeSchemaValue({ 'schema': additionalProperties, 'value': propertyValue, 'path': joinPath(path, key), 'diagnostics': diagnostics });
  }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
