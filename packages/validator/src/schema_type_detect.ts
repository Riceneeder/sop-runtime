/**
 * JSON Schema type detection utilities for path resolution.
 *
 * JSON Schema 类型判断工具函数，用于 schema 路径解析。
 */

/**
 * Check whether a schema behaves like an array schema.
 *
 * 判断 schema 是否表现为数组类型。
 */
export function isArraySchema(schema: Record<string, unknown>): boolean {
  return hasSchemaType(schema, 'array') || Object.hasOwn(schema, 'items');
}

/**
 * Check whether a schema behaves like an object schema.
 *
 * 判断 schema 是否表现为对象类型。
 */
export function isObjectSchema(schema: Record<string, unknown>): boolean {
  return hasSchemaType(schema, 'object')
    || Object.hasOwn(schema, 'properties')
    || Object.hasOwn(schema, 'additionalProperties')
    || Object.hasOwn(schema, 'patternProperties');
}

/**
 * Detect whether `schema.type` declares the expected JSON Schema type.
 *
 * 判断 `schema.type` 是否声明了期望的类型。
 */
function hasSchemaType(schema: Record<string, unknown>, expectedType: string): boolean {
  if (typeof schema.type === 'string') {
    return schema.type === expectedType;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.includes(expectedType);
  }

  return false;
}

/**
 * Detect primitive schemas whose children can never be traversed.
 *
 * 判断那些不可能再向下遍历字段的原始值叶子 schema。
 */
export function isKnownPrimitiveLeafSchema(schema: Record<string, unknown>): boolean {
  if (isPrimitiveTypedSchema(schema)) {
    return true;
  }

  if (Object.hasOwn(schema, 'const')) {
    return isPrimitiveJsonValue(schema.const);
  }

  return Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((value) => isPrimitiveJsonValue(value));
}

/**
 * Detect whether the schema's declared types are all primitive.
 *
 * 判断 schema 声明的类型是否全部是原始类型。
 */
function isPrimitiveTypedSchema(schema: Record<string, unknown>): boolean {
  if (typeof schema.type === 'string') {
    return isPrimitiveSchemaType(schema.type);
  }

  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return schema.type.every((item) => typeof item === 'string' && isPrimitiveSchemaType(item));
  }

  return false;
}

/**
 * Check whether a schema type string is primitive.
 *
 * 判断 schema 类型字符串是否为原始类型。
 */
function isPrimitiveSchemaType(type: string): boolean {
  return type === 'string'
    || type === 'number'
    || type === 'integer'
    || type === 'boolean'
    || type === 'null';
}

/**
 * Check whether a runtime value is a primitive JSON value.
 *
 * 判断运行时值是否为 JSON 原始值。
 */
function isPrimitiveJsonValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Safely test a property name against a possibly-invalid regex pattern.
 *
 * 用可能无效的正则模式安全匹配属性名。
 */
export function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
