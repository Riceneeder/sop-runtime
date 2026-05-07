import { JsonObject } from '@sop-runtime/definition';

/**
 * Assert that a value is a non-null, non-array object.
 *
 * 断言一个值是非 null、非数组的对象。
 *
 * @param value - The value to check.
 * @param path - Optional path for error messages.
 * @returns The value as a JsonObject.
 * @throws {AdapterError} If the value is not a JsonObject.
 * @public
 */
export function assertJsonObject(value: unknown, path?: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AdapterConfigError(
      `Expected a JSON object${path !== undefined ? ` at ${path}` : ''}, got ${typeof value}.`,
    );
  }
  return value as JsonObject;
}

/**
 * Read a required string field from a config object.
 *
 * 从配置对象中读取必需的字符串字段。
 *
 * @param config - The config object.
 * @param key - The field key.
 * @returns The string value.
 * @throws {AdapterConfigError} If the key is missing or not a string.
 * @public
 */
export function getRequiredString(config: JsonObject, key: string): string {
  const value = config[key];
  if (typeof value !== 'string') {
    throw new AdapterConfigError(
      `Required config field "${key}" must be a string, got ${typeof value}.`,
    );
  }
  return value;
}

/**
 * Read an optional string field from a config object.
 *
 * 从配置对象中读取可选的字符串字段。
 *
 * @param config - The config object.
 * @param key - The field key.
 * @returns The string value, or undefined if absent.
 * @throws {AdapterConfigError} If the value is present but not a string.
 * @public
 */
export function getOptionalString(config: JsonObject, key: string): string | undefined {
  if (!(key in config)) return undefined;
  return getRequiredString(config, key);
}

/**
 * Read an optional string array field from a config object.
 *
 * 从配置对象中读取可选的字符串数组字段。
 *
 * @param config - The config object.
 * @param key - The field key.
 * @returns The string array, or undefined if absent.
 * @throws {AdapterConfigError} If the value is present but not an array of strings.
 * @public
 */
export function getOptionalStringArray(config: JsonObject, key: string): string[] | undefined {
  if (!(key in config)) return undefined;
  const value = config[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new AdapterConfigError(
      `Optional config field "${key}" must be a string array, got ${typeof value}.`,
    );
  }
  return value;
}

/**
 * Read an optional nested JsonObject field from a config object.
 *
 * 从配置对象中读取可选的嵌套 JsonObject 字段。
 *
 * @param config - The config object.
 * @param key - The field key.
 * @returns The nested object, or undefined if absent.
 * @throws {AdapterConfigError} If the value is present but not a JsonObject.
 * @public
 */
export function getOptionalJsonObject(config: JsonObject, key: string): JsonObject | undefined {
  if (!(key in config)) return undefined;
  return assertJsonObject(config[key], key);
}

/**
 * Read an optional boolean field from a config object.
 *
 * 从配置对象中读取可选的布尔字段。
 *
 * @param config - The config object.
 * @param key - The field key.
 * @returns The boolean value, or undefined if absent.
 * @throws {AdapterConfigError} If the value is present but not a boolean.
 * @public
 */
export function getOptionalBoolean(config: JsonObject, key: string): boolean | undefined {
  if (!(key in config)) return undefined;
  const value = config[key];
  if (typeof value !== 'boolean') {
    throw new AdapterConfigError(
      `Optional config field "${key}" must be a boolean, got ${typeof value}.`,
    );
  }
  return value;
}

/**
 * Read an optional string record field from a config object.
 *
 * 从配置对象中读取可选的字符串字典字段。
 *
 * @param config - The config object.
 * @param key - The field key.
 * @returns The string record, or undefined if absent.
 * @throws {AdapterConfigError} If the value is present but not a Record<string, string>.
 * @public
 */
export function getOptionalStringRecord(
  config: JsonObject,
  key: string,
): Record<string, string> | undefined {
  if (!(key in config)) return undefined;
  const value = config[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AdapterConfigError(
      `Optional config field "${key}" must be a string record, got ${typeof value}.`,
    );
  }
  const record = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(record)) {
    if (typeof v !== 'string') {
      throw new AdapterConfigError(
        `Optional config field "${key}.${k}" must be a string, got ${typeof v}.`,
      );
    }
  }
  return record as Record<string, string>;
}

/**
 * Error thrown by config reader functions.
 *
 * 配置读取函数抛出的错误。
 *
 * @public
 */
export class AdapterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterConfigError';
  }
}
