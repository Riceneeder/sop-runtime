import { Diagnostic } from './diagnostic.js';
import { joinPath } from './path.js';

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

export function requireObject(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isPlainObject(value)) {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected object.', 'path': path });
  }
}

export function requireString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'string') {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected string.', 'path': path });
  }
}

export function requireNonEmptyString(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  requireString(value, path, diagnostics);

  if (typeof value === 'string' && value.length === 0) {
    diagnostics.push({ 'code': 'schema_min_length', 'message': 'Expected non-empty string.', 'path': path });
  }
}

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

export function requireBoolean(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value !== 'boolean') {
    diagnostics.push({ 'code': 'schema_type', 'message': 'Expected boolean.', 'path': path });
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
