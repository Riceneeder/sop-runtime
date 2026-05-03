import {describe, expect, test} from 'bun:test';
import {
  isJsonSafeObject,
  isJsonSafeValue,
  isStrictPlainObject,
  isStringRecord,
} from '../src/index.js';

describe('isStrictPlainObject', () => {
  test('returns true for object literals', () => {
    expect(isStrictPlainObject({})).toBe(true);
    expect(isStrictPlainObject({'a': 1, 'b': 2})).toBe(true);
  });

  test('returns true for Object() created objects', () => {
    expect(isStrictPlainObject(Object())).toBe(true);
    expect(isStrictPlainObject(Object.create(null))).toBe(true);
  });

  test('returns false for null', () => {
    expect(isStrictPlainObject(null)).toBe(false);
  });

  test('returns false for arrays', () => {
    expect(isStrictPlainObject([])).toBe(false);
    expect(isStrictPlainObject([1, 2, 3])).toBe(false);
  });

  test('returns false for primitives', () => {
    expect(isStrictPlainObject('hello')).toBe(false);
    expect(isStrictPlainObject(42)).toBe(false);
    expect(isStrictPlainObject(true)).toBe(false);
    expect(isStrictPlainObject(undefined)).toBe(false);
  });

  test('returns false for class instances', () => {
    expect(isStrictPlainObject(new Date())).toBe(false);
    expect(isStrictPlainObject(new Map())).toBe(false);
    expect(isStrictPlainObject(new Set())).toBe(false);
  });

  test('returns false for custom class instances', () => {
    class Foo {
      x = 1;
    }
    expect(isStrictPlainObject(new Foo())).toBe(false);
  });
});

describe('isJsonSafeValue', () => {
  test('accepts null', () => {
    expect(isJsonSafeValue(null)).toBe(true);
  });

  test('accepts strings', () => {
    expect(isJsonSafeValue('')).toBe(true);
    expect(isJsonSafeValue('hello')).toBe(true);
  });

  test('accepts booleans', () => {
    expect(isJsonSafeValue(true)).toBe(true);
    expect(isJsonSafeValue(false)).toBe(true);
  });

  test('accepts finite numbers', () => {
    expect(isJsonSafeValue(0)).toBe(true);
    expect(isJsonSafeValue(42)).toBe(true);
    expect(isJsonSafeValue(-1)).toBe(true);
    expect(isJsonSafeValue(3.14)).toBe(true);
  });

  test('rejects NaN', () => {
    expect(isJsonSafeValue(NaN)).toBe(false);
  });

  test('rejects Infinity', () => {
    expect(isJsonSafeValue(Infinity)).toBe(false);
  });

  test('rejects -Infinity', () => {
    expect(isJsonSafeValue(-Infinity)).toBe(false);
  });

  test('rejects functions', () => {
    expect(isJsonSafeValue(() => {})).toBe(false);
    expect(isJsonSafeValue(function() {})).toBe(false);
  });

  test('rejects symbols', () => {
    expect(isJsonSafeValue(Symbol('test'))).toBe(false);
  });

  test('accepts empty arrays', () => {
    expect(isJsonSafeValue([])).toBe(true);
  });

  test('accepts arrays of valid values', () => {
    expect(isJsonSafeValue([1, 'two', true, null])).toBe(true);
  });

  test('rejects arrays with NaN', () => {
    expect(isJsonSafeValue([1, NaN, 3])).toBe(false);
  });

  test('rejects arrays with Infinity', () => {
    expect(isJsonSafeValue([1, Infinity])).toBe(false);
  });

  test('accepts empty plain objects', () => {
    expect(isJsonSafeValue({})).toBe(true);
  });

  test('accepts nested valid JSON structures', () => {
    const nested = {
      'a': 1,
      'b': {'c': [1, 2, {'d': 'deep'}]},
      'e': [null, true, false, 'str', 42],
    };
    expect(isJsonSafeValue(nested)).toBe(true);
  });

  test('rejects nested structures with invalid values', () => {
    expect(isJsonSafeValue({'a': NaN})).toBe(false);
    expect(isJsonSafeValue({'a': [1, undefined]})).toBe(false);
    expect(isJsonSafeValue({'a': () => {}})).toBe(false);
  });

  test('rejects non-plain objects', () => {
    expect(isJsonSafeValue(new Date())).toBe(false);
    expect(isJsonSafeValue(new Map())).toBe(false);
    expect(isJsonSafeValue(new Set())).toBe(false);
    expect(isJsonSafeValue(new RegExp('x'))).toBe(false);
  });

  test('detects circular reference and returns false', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(isJsonSafeValue(obj)).toBe(false);
  });

  test('detects nested circular reference and returns false', () => {
    const child: Record<string, unknown> = {};
    const parent: Record<string, unknown> = {'child': child};
    child.parent = parent;
    expect(isJsonSafeValue(parent)).toBe(false);
  });

  test('allows shared reference (same object in 2 places, not a cycle)', () => {
    const shared = {'x': 1};
    const root = {
      'a': shared,
      'b': shared,
    };
    expect(isJsonSafeValue(root)).toBe(true);
  });

  test('detects cycle in array and returns false', () => {
    const arr: unknown[] = [];
    arr.push(arr);
    expect(isJsonSafeValue(arr)).toBe(false);
  });

  test('detects cycle in nested array and returns false', () => {
    const inner: unknown[] = [];
    const outer: unknown[] = [inner];
    inner.push(outer);
    expect(isJsonSafeValue(outer)).toBe(false);
  });

  test('allows shared array reference (same array in 2 places)', () => {
    const shared = [1, 2, 3];
    const root = {
      'a': shared,
      'b': shared,
    };
    expect(isJsonSafeValue(root)).toBe(true);
  });

  test('custom class instance with circular reference returns false', () => {
    class Node {
      next: Node | null = null;
    }
    const node = new Node();
    node.next = node;
    expect(isJsonSafeValue(node)).toBe(false);
  });
});

describe('isJsonSafeObject', () => {
  test('returns true for plain objects with safe values', () => {
    expect(isJsonSafeObject({})).toBe(true);
    expect(isJsonSafeObject({'a': 1, 'b': 'str'})).toBe(true);
  });

  test('returns false for null', () => {
    expect(isJsonSafeObject(null)).toBe(false);
  });

  test('returns false for arrays', () => {
    expect(isJsonSafeObject([])).toBe(false);
  });

  test('returns false for non-plain objects', () => {
    expect(isJsonSafeObject(new Date())).toBe(false);
  });

  test('returns false when values contain unsafe data', () => {
    expect(isJsonSafeObject({'a': NaN})).toBe(false);
  });

  test('returns false for circular references', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(isJsonSafeObject(obj)).toBe(false);
  });

  test('allows shared reference (same object in 2 places)', () => {
    const shared = {'x': 1};
    const root = {
      'a': shared,
      'b': shared,
    };
    expect(isJsonSafeObject(root)).toBe(true);
  });
});

describe('isStringRecord', () => {
  test('returns true for empty object', () => {
    expect(isStringRecord({})).toBe(true);
  });

  test('returns true when all values are strings', () => {
    expect(isStringRecord({'a': 'hello', 'b': 'world'})).toBe(true);
  });

  test('returns false for null', () => {
    expect(isStringRecord(null)).toBe(false);
  });

  test('returns false for arrays', () => {
    expect(isStringRecord([])).toBe(false);
  });

  test('returns false for non-plain objects', () => {
    expect(isStringRecord(new Date())).toBe(false);
  });

  test('returns false when a value is a number', () => {
    expect(isStringRecord({'a': 'ok', 'b': 42})).toBe(false);
  });

  test('returns false when a value is a boolean', () => {
    expect(isStringRecord({'a': 'ok', 'b': true})).toBe(false);
  });

  test('returns false when a value is null', () => {
    expect(isStringRecord({'a': 'ok', 'b': null})).toBe(false);
  });

  test('returns false when a value is a nested object', () => {
    expect(isStringRecord({'a': 'ok', 'b': {'nested': 'string'}})).toBe(false);
  });

  test('returns false when a value is undefined', () => {
    expect(isStringRecord({'a': 'ok', 'b': undefined})).toBe(false);
  });
});
