/**
 * Generic diagnostic helper functions for schema validation.
 *
 * 结构校验中通用的诊断辅助函数。
 */
import {Diagnostic} from './diagnostic.js';
import {joinPath} from './path.js';

/**
 * Emit diagnostics for unknown keys not listed in the allowed set.
 *
 * 为未列入白名单的额外字段生成诊断信息。
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
 * Require an array and enforce a minimum length.
 *
 * 要求值为数组并满足最小长度。
 */
export function requireArrayWithMinItems(value: unknown, minItems: number, path: string, diagnostics: Diagnostic[]): void {
  if (!Array.isArray(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected array.', 'path': path});
    return;
  }

  if (value.length < minItems) {
    diagnostics.push({'code': 'schema_min_items', 'message': `Expected at least ${minItems} items.`, 'path': path});
  }
}

/**
 * Require the value to be a plain object.
 *
 * 要求值为普通对象。
 */
export function requireObject(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isPlainObject(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected object.', 'path': path});
  }
}

/**
 * Require the value to be a string.
 *
 * 要求值为字符串。
 */
export function requireString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': path});
  }
}

/**
 * Require the value to be a non-empty string.
 *
 * 要求值为非空字符串。
 */
export function requireNonEmptyString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireString(value, path, diagnostics);

  if (typeof value === 'string' && value.length === 0) {
    diagnostics.push({'code': 'schema_min_length', 'message': 'Expected non-empty string.', 'path': path});
  }
}

/**
 * Require the string value to match a regular-expression pattern.
 *
 * 要求字符串值匹配指定正则模式。
 */
export function requirePattern(value: unknown, pattern: RegExp, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value === 'string' && !pattern.test(value)) {
    diagnostics.push({'code': 'schema_pattern', 'message': `Value does not match ${pattern}.`, 'path': path});
  }
}

/**
 * Require an integer value that is greater than or equal to `min`.
 *
 * 要求整数值大于等于 `min`。
 */
export function requireIntegerAtLeast(value: unknown, min: number, path: string, diagnostics: Diagnostic[]): void {
  if (!Number.isInteger(value)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected integer.', 'path': path});
    return;
  }

  if (typeof value === 'number' && value < min) {
    diagnostics.push({'code': 'schema_minimum', 'message': `Expected integer >= ${min}.`, 'path': path});
  }
}

/**
 * Require the string value to be one of the allowed literals.
 *
 * 要求字符串值位于允许的枚举集合中。
 */
export function requireEnum(value: unknown, allowed: string[], path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected string.', 'path': path});
    return;
  }

  if (!allowed.includes(value)) {
    diagnostics.push({'code': 'schema_enum', 'message': `Expected one of: ${allowed.join(', ')}`, 'path': path});
  }
}

/**
 * Require a boolean value.
 *
 * 要求值为布尔类型。
 */
export function requireBoolean(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'boolean') {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected boolean.', 'path': path});
  }
}

/**
 * Check whether an unknown value is a plain record-like object.
 *
 * 判断未知值是否为普通记录对象。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
