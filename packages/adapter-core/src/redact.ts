import { JsonObject, JsonValue } from '@sop-runtime/definition';

/**
 * Sentinel value that replaces redacted fields.
 *
 * 替换已编辑字段的标记值。
 *
 * @public
 */
export const REDACTED_VALUE = '***';

/**
 * Default sensitive key patterns (case-insensitive matching).
 *
 * 默认敏感键模式（不区分大小写匹配）。
 */
const DEFAULT_SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'token',
  'secret',
  'password',
];

/**
 * Recursively redact sensitive fields from a JSON value.
 *
 * 递归地从 JSON 值中编辑敏感字段。
 *
 * The input is not mutated; a new object is returned.
 * Key matching is case-insensitive.
 * 不会修改输入；返回新对象。键匹配不区分大小写。
 *
 * @param input - The JSON value to redact.
 * @param sensitiveKeys - List of sensitive key patterns (defaults to built-in list).
 * @returns A new JSON value with sensitive fields redacted.
 * @public
 */
export function redactSecrets(input: JsonValue, sensitiveKeys?: string[]): JsonValue {
  const keys = (sensitiveKeys ?? DEFAULT_SENSITIVE_KEYS).map((k) => k.toLowerCase());

  return redactInternal(input, keys, new WeakMap<object, JsonValue>());
}

function redactInternal(
  value: JsonValue,
  sensitiveLowerKeys: string[],
  cache: WeakMap<object, JsonValue>,
): JsonValue {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  // Return cached redacted result if already seen (handles cycles safely by
  // returning the in-progress redacted copy instead of the original object).
  const cached = cache.get(value);
  if (cached !== undefined) {
    return cached;
  }

  if (Array.isArray(value)) {
    const arr: JsonValue[] = [];
    cache.set(value, arr);
    for (const item of value) {
      arr.push(redactInternal(item, sensitiveLowerKeys, cache));
    }
    return arr;
  }

  const obj: JsonObject = {};
  cache.set(value, obj);
  for (const [key, val] of Object.entries(value as JsonObject)) {
    if (isSensitiveKey(key, sensitiveLowerKeys)) {
      obj[key] = REDACTED_VALUE;
    } else {
      obj[key] = redactInternal(val, sensitiveLowerKeys, cache);
    }
  }
  return obj;
}

function isSensitiveKey(key: string, sensitiveLowerKeys: string[]): boolean {
  const lower = key.toLowerCase();
  return sensitiveLowerKeys.some((pattern) => lower === pattern || lower.includes(pattern));
}
