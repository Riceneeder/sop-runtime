import { describe, expect, test } from 'bun:test';
import {
  AdapterError,
  normalizeAdapterError,
  buildErrorDetails,
} from '../src/error.js';

describe('AdapterError', () => {
  test('creates error with code and message', () => {
    const err = new AdapterError('my_code', 'my message', { detail: 'value' });
    expect(err.code).toBe('my_code');
    expect(err.message).toBe('my message');
    expect(err.details).toEqual({ detail: 'value' });
    expect(err.name).toBe('AdapterError');
  });
});

describe('normalizeAdapterError', () => {
  test('passes through AdapterError', () => {
    const original = new AdapterError('custom', 'custom msg');
    const normalized = normalizeAdapterError(original);
    expect(normalized).toBe(original);
  });

  test('wraps Error', () => {
    const normalized = normalizeAdapterError(new Error('boom'));
    expect(normalized).toBeInstanceOf(AdapterError);
    expect(normalized.code).toBe('adapter_error');
    expect(normalized.message).toBe('boom');
  });

  test('wraps string', () => {
    const normalized = normalizeAdapterError('string error');
    expect(normalized.message).toBe('string error');
  });

  test('uses default code', () => {
    const normalized = normalizeAdapterError('oops');
    expect(normalized.code).toBe('adapter_error');
  });

  test('uses custom default code', () => {
    const normalized = normalizeAdapterError('oops', 'custom_fallback');
    expect(normalized.code).toBe('custom_fallback');
  });
});

describe('buildErrorDetails', () => {
  test('merges base and extra', () => {
    const result = buildErrorDetails({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test('handles undefined base', () => {
    const result = buildErrorDetails(undefined, { b: 2 });
    expect(result).toEqual({ b: 2 });
  });
});
