import { describe, expect, test } from 'bun:test';
import { JsonObject, JsonValue } from '@sop-runtime/definition';
import { redactSecrets, REDACTED_VALUE } from '../src/redact.js';

describe('redactSecrets', () => {
  test('redacts known sensitive keys case-insensitively', () => {
    const input: JsonObject = {
      Authorization: 'Bearer token123',
      'x-api-key': 'abc123',
      name: 'public',
      nested: {
        secret: 'sensitive',
        Password: 'p@ss',
      },
    };
    const result = redactSecrets(input) as JsonObject;
    expect(result.Authorization).toBe(REDACTED_VALUE);
    expect(result.name).toBe('public');
    const nested = result.nested as JsonObject;
    expect(nested.secret).toBe(REDACTED_VALUE);
    expect(nested.Password).toBe(REDACTED_VALUE);
  });

  test('is immutable', () => {
    const input: JsonObject = { token: 'abc', sub: { secret: 'xyz' } };
    const result = redactSecrets(input) as JsonObject;
    expect(result.token).toBe(REDACTED_VALUE);
    expect(input.token).toBe('abc');
    expect((result.sub as JsonObject).secret).toBe(REDACTED_VALUE);
    expect((input.sub as JsonObject).secret).toBe('xyz');
  });

  test('handles arrays', () => {
    const input: JsonValue = [{ token: 'abc' }, { name: 'public' }];
    const result = redactSecrets(input) as Array<JsonObject>;
    expect(result[0]!.token).toBe(REDACTED_VALUE);
    expect(result[1]!.name).toBe('public');
  });

  test('handles null and primitives', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('hello')).toBe('hello');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBeTrue();
  });

  test('accepts custom sensitive keys', () => {
    const input: JsonObject = { myKey: 'secret', name: 'hello' };
    const result = redactSecrets(input, ['myKey']) as JsonObject;
    expect(result.myKey).toBe(REDACTED_VALUE);
    expect(result.name).toBe('hello');
  });

  test('does not leak secrets through cyclic references', () => {
    const input: Record<string, unknown> = { secret: 'sensitive-data' };
    input.self = input;

    const result = redactSecrets(input as unknown as JsonValue) as Record<string, unknown>;
    expect(result.secret).toBe(REDACTED_VALUE);

    // The cycle must NOT re-attach the original unredacted object; the
    // self-reference must return the redacted-in-progress object instead.
    const selfRef = result.self as Record<string, unknown>;
    expect(selfRef).not.toBe(input);
    expect(selfRef.secret).toBe(REDACTED_VALUE);
  });

  test('does not leak secrets through nested cyclic references', () => {
    const inner: Record<string, unknown> = { secret: 'nested-secret' };
    inner.parent = null as unknown as undefined; // placeholder until outer assigned
    const outer: Record<string, unknown> = { name: 'public', inner };
    inner.parent = outer;

    const result = redactSecrets(outer as unknown as JsonValue) as Record<string, unknown>;
    expect(result.name).toBe('public');
    const resultInner = result.inner as Record<string, unknown>;
    expect(resultInner.secret).toBe(REDACTED_VALUE);

    // Cycle: inner.parent → outer → inner. The inner.parent must point to the
    // redacted outer, not the original unredacted one.
    const parentRef = resultInner.parent as Record<string, unknown>;
    expect(parentRef).not.toBe(outer);
    expect(parentRef.name).toBe('public');

    // And most importantly: navigating the cycle must not leak inner's secret.
    const parentInner = parentRef.inner as Record<string, unknown>;
    expect(parentInner.secret).toBe(REDACTED_VALUE);
  });
});
