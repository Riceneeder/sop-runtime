/**
 * Canonical JSON-compatible value types shared across packages.
 *
 * 两个包共享的标准 JSON 值类型定义。
 */
/**
 * Primitive JSON value.
 *
 * JSON 原始值类型。
 *
 * @public
 */
export type JsonPrimitive = boolean | number | string | null;

/**
 * JSON array whose elements are themselves {@link JsonValue} values.
 *
 * 元素同样为 {@link JsonValue} 的 JSON 数组类型。
 *
 * @public
 */
export interface JsonArray extends Array<JsonValue> {}

/**
 * JSON object keyed by strings.
 *
 * 以字符串为键的 JSON 对象类型。
 *
 * @public
 */
export interface JsonObject {
  /**
   * Arbitrary JSON field keyed by string.
   *
   * 以字符串为键的任意 JSON 字段。
   */
  [key: string]: JsonValue;
}

/**
 * Any JSON-compatible value.
 *
 * 任意 JSON 兼容值。
 *
 * @public
 */
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

/**
 * Returns true only for objects created by literal syntax or `Object()`.
 *
 * 仅对通过字面量语法或 `Object()` 创建的对象返回 true。
 *
 * @public
 */
export function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value as object);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Cycle-safe JSON-safe value guard.
 *
 * Tracks visited objects in a `Set<object>` to detect circular references.
 * Shared references (the same object appearing in multiple places) are NOT
 * treated as cycles — only a true circular path returns false.
 *
 * Accepts: null, string, boolean, finite number, array, plain object.
 * Rejects: NaN, Infinity, -Infinity, functions, symbols, Date, Map, Set,
 * class instances, circular references.
 *
 * 循环安全的 JSON 安全值类型守卫。通过 `Set<object>` 跟踪已访问对象以检测循环引用。
 * 共享引用（同一对象出现在多个位置）不会被视为循环 —— 只有真正的循环路径才返回 false。
 *
 * @public
 */
export function isJsonSafeValue(value: unknown, seen?: Set<object>): value is JsonValue {
  if (value === null) {
    return true;
  }
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return true;
  }
  if (valueType === 'number') {
    return Number.isFinite(value);
  }
  if (valueType !== 'object') {
    return false;
  }
  const visited = seen ?? new Set<object>();
  const objectValue = value as object;
  if (visited.has(objectValue)) {
    return false;
  }
  visited.add(objectValue);
  if (Array.isArray(value)) {
    const safe = value.every((item) => isJsonSafeValue(item, visited));
    visited.delete(objectValue);
    return safe;
  }
  if (!isStrictPlainObject(value)) {
    visited.delete(objectValue);
    return false;
  }
  for (const entry of Object.values(value)) {
    if (!isJsonSafeValue(entry, visited)) {
      visited.delete(objectValue);
      return false;
    }
  }
  visited.delete(objectValue);
  return true;
}

/**
 * Convenience guard: `isJsonSafeValue(value)` AND `isStrictPlainObject(value)`.
 *
 * 便捷类型守卫：`isJsonSafeValue(value)` 且 `isStrictPlainObject(value)`。
 *
 * @public
 */
export function isJsonSafeObject(value: unknown): value is JsonObject {
  return isStrictPlainObject(value) && isJsonSafeValue(value);
}

/**
 * Returns true when `value` is a plain object and every own value is a string.
 *
 * 当 `value` 为纯对象且所有自有值均为字符串时返回 true。
 *
 * @public
 */
export function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isStrictPlainObject(value)) {
    return false;
  }
  for (const entry of Object.values(value)) {
    if (typeof entry !== 'string') {
      return false;
    }
  }
  return true;
}
