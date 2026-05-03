import { Diagnostic } from './diagnostic.js';
import { joinPath } from './path.js';

/**
 * Push a diagnostic for each unknown key in an object that is not in the allowed set.
 *
 * 为对象中不在允许集合中的每个未知键推送诊断信息。
 *
 * @param value - The object to check.
 * @param allowed - The set of allowed keys.
 * @param basePath - The base path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @public
 */
export function pushUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  basePath: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push({
        'code': 'schema_additional_property',
        'message': `Unexpected property: ${key}`,
        'path': joinPath(basePath, key),
      });
    }
  }
}

/**
 * Assert that a value is an array with at least the minimum number of items.
 *
 * 断言值为数组且至少包含指定数量的元素。
 *
 * @param value - The value to check.
 * @param path - The path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @param opts - Options including minItems.
 * @public
 */
export function requireArrayWithMinItems(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  opts: { minItems: number },
): void {
  if (!Array.isArray(value)) {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected array.', 'path': path });
    return;
  }

  if (value.length < opts.minItems) {
    diagnostics.push({
      'code': 'schema_min_items',
      'message': `Expected at least ${opts.minItems} items.`,
      'path': path,
    });
  }
}

/**
 * Assert that a value is a plain object.
 *
 * 断言值为普通对象。
 *
 * @param value - The value to check.
 * @param path - The path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @public
 */
export function requireObject(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isPlainObject(value)) {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected object.', 'path': path });
  }
}

/**
 * Assert that a value is a string.
 *
 * 断言值为字符串。
 *
 * @param value - The value to check.
 * @param path - The path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @public
 */
export function requireString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected string.', 'path': path });
  }
}

/**
 * Assert that a value is a non-empty string.
 *
 * 断言值为非空字符串。
 *
 * @param value - The value to check.
 * @param path - The path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @public
 */
export function requireNonEmptyString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireString(value, path, diagnostics);

  if (typeof value === 'string' && value.length === 0) {
    diagnostics.push({ 'code': 'schema_min_length', 'message': 'Expected non-empty string.', 'path': path });
  }
}

/**
 * Assert that a value matches a regular expression pattern.
 *
 * 断言值匹配正则表达式模式。
 *
 * @param value - The value to check.
 * @param path - The path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @param opts - Options including the pattern.
 * @public
 */
export function requirePattern(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  opts: { pattern: RegExp },
): void {
  if (typeof value === 'string' && !opts.pattern.test(value)) {
    diagnostics.push({
      'code': 'schema_pattern',
      'message': `Value does not match ${opts.pattern}.`,
      'path': path,
    });
  }
}

/**
 * Assert that a value is an integer at least the specified minimum.
 *
 * 断言值为整数且至少为指定最小值。
 *
 * @param value - The value to check.
 * @param path - The path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @param opts - Options including the minimum value.
 * @public
 */
export function requireIntegerAtLeast(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  opts: { min: number },
): void {
  if (!Number.isInteger(value)) {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected integer.', 'path': path });
    return;
  }

  if (typeof value === 'number' && value < opts.min) {
    diagnostics.push({
      'code': 'schema_minimum',
      'message': `Expected integer >= ${opts.min}.`,
      'path': path,
    });
  }
}

/**
 * Assert that a value is one of the allowed string values.
 *
 * 断言值为允许的字符串值之一。
 *
 * @param value - The value to check.
 * @param path - The path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @param opts - Options including the allowed values.
 * @public
 */
export function requireEnum(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  opts: { allowed: string[] },
): void {
  if (typeof value !== 'string') {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected string.', 'path': path });
    return;
  }

  if (!opts.allowed.includes(value)) {
    diagnostics.push({
      'code': 'schema_enum',
      'message': `Expected one of: ${opts.allowed.join(', ')}`,
      'path': path,
    });
  }
}

/**
 * Assert that a value is a boolean.
 *
 * 断言值为布尔值。
 *
 * @param value - The value to check.
 * @param path - The path for diagnostics.
 * @param diagnostics - The diagnostics accumulator.
 * @public
 */
export function requireBoolean(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'boolean') {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected boolean.', 'path': path });
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
