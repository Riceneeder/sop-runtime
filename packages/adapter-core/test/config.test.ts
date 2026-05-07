import { describe, expect, test } from 'bun:test';
import {
  assertJsonObject,
  getRequiredString,
  getOptionalString,
  getOptionalStringArray,
  getOptionalJsonObject,
  getOptionalBoolean,
  getOptionalStringRecord,
  AdapterConfigError,
} from '../src/config.js';

describe('assertJsonObject', () => {
  test('returns object for plain object', () => {
    expect(assertJsonObject({ key: 'val' })).toEqual({ key: 'val' });
  });

  test('throws for non-object values', () => {
    expect(() => assertJsonObject(null)).toThrow(AdapterConfigError);
    expect(() => assertJsonObject('string')).toThrow(AdapterConfigError);
    expect(() => assertJsonObject(42)).toThrow(AdapterConfigError);
    expect(() => assertJsonObject([1, 2])).toThrow(AdapterConfigError);
    expect(() => assertJsonObject(undefined)).toThrow(AdapterConfigError);
  });
});

describe('getRequiredString', () => {
  test('returns string value when present', () => {
    expect(getRequiredString({ name: 'hello' }, 'name')).toBe('hello');
  });

  test('throws when key is missing', () => {
    expect(() => getRequiredString({}, 'missing')).toThrow(AdapterConfigError);
  });

  test('throws when value is not a string', () => {
    expect(() => getRequiredString({ count: 42 }, 'count')).toThrow(AdapterConfigError);
  });
});

describe('getOptionalString', () => {
  test('returns value when present', () => {
    expect(getOptionalString({ name: 'hello' }, 'name')).toBe('hello');
  });

  test('returns undefined when absent', () => {
    expect(getOptionalString({}, 'missing')).toBeUndefined();
  });

  test('throws when present but wrong type', () => {
    expect(() => getOptionalString({ count: 42 }, 'count')).toThrow(AdapterConfigError);
  });
});

describe('getOptionalStringArray', () => {
  test('returns array when present and valid', () => {
    expect(getOptionalStringArray({ tags: ['a', 'b'] }, 'tags')).toEqual(['a', 'b']);
  });

  test('returns undefined when absent', () => {
    expect(getOptionalStringArray({}, 'tags')).toBeUndefined();
  });

  test('throws when not an array', () => {
    expect(() => getOptionalStringArray({ tags: 'not-array' }, 'tags')).toThrow(AdapterConfigError);
  });

  test('throws when array contains non-strings', () => {
    expect(() => getOptionalStringArray({ tags: ['a', 42] }, 'tags')).toThrow(AdapterConfigError);
  });
});

describe('getOptionalJsonObject', () => {
  test('returns object when present and valid', () => {
    expect(getOptionalJsonObject({ nested: { a: 1 } }, 'nested')).toEqual({ a: 1 });
  });

  test('returns undefined when absent', () => {
    expect(getOptionalJsonObject({}, 'nested')).toBeUndefined();
  });

  test('throws when present but not an object', () => {
    expect(() => getOptionalJsonObject({ nested: 'str' }, 'nested')).toThrow(AdapterConfigError);
  });
});

describe('getOptionalBoolean', () => {
  test('returns true when set', () => {
    expect(getOptionalBoolean({ enabled: true }, 'enabled')).toBeTrue();
  });

  test('returns false when set', () => {
    expect(getOptionalBoolean({ enabled: false }, 'enabled')).toBeFalse();
  });

  test('returns undefined when absent', () => {
    expect(getOptionalBoolean({}, 'enabled')).toBeUndefined();
  });

  test('throws when present but not boolean', () => {
    expect(() => getOptionalBoolean({ enabled: 'yes' }, 'enabled')).toThrow(AdapterConfigError);
  });
});

describe('getOptionalStringRecord', () => {
  test('returns record when present and valid', () => {
    expect(getOptionalStringRecord({ env: { PATH: '/usr/bin' } }, 'env')).toEqual({ PATH: '/usr/bin' });
  });

  test('returns undefined when absent', () => {
    expect(getOptionalStringRecord({}, 'env')).toBeUndefined();
  });

  test('throws when not an object', () => {
    expect(() => getOptionalStringRecord({ env: 'str' }, 'env')).toThrow(AdapterConfigError);
  });

  test('throws when value contains non-string', () => {
    expect(() => getOptionalStringRecord({ env: { PATH: 42 } }, 'env')).toThrow(AdapterConfigError);
  });
});
