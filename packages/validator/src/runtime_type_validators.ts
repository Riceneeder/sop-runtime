/**
 * Type, enum, and const keyword validators for runtime value validation.
 *
 * 运行时值校验中用到的类型、枚举和常量关键字校验器。
 */
import {Diagnostic} from './diagnostic.js';

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

export {SUPPORTED_SCHEMA_TYPES, SupportedSchemaType};

/**
 * Validate the `type` keyword against a runtime value.
 */
export function validateTypeKeyword(
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

/**
 * Validate the `enum` keyword against a runtime value.
 */
export function validateEnumKeyword(
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

/**
 * Validate the `const` keyword against a runtime value.
 */
export function validateConstKeyword(
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

/**
 * Collect declared schema types from the `type` keyword.
 */
export function collectDeclaredTypes(typeKeyword: unknown): SupportedSchemaType[] {
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
