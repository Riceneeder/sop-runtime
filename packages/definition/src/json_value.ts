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
