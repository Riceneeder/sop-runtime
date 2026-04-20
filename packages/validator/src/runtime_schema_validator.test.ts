import {describe, expect, test} from 'bun:test';
import {validateRuntimeValue} from './index';

describe('validateRuntimeValue', () => {
  test('validates nested runtime values and keeps stable diagnostic paths', () => {
    const result = validateRuntimeValue({
      'path': 'run.input',
      'schema': {
        'type': 'object',
        'required': ['name', 'items'],
        'properties': {
          'name': {'type': 'string', 'minLength': 2},
          'age': {'type': 'integer', 'minimum': 18},
          'items': {
            'type': 'array',
            'minItems': 1,
            'items': {
              'type': 'object',
              'required': ['id'],
              'properties': {
                'id': {'type': 'string'},
              },
            },
          },
        },
        'additionalProperties': false,
      },
      'value': {
        'name': 'A',
        'age': 17,
        'items': [{}],
        'extra': true,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_min_length', 'path': 'run.input.name'}),
      expect.objectContaining({'code': 'schema_minimum', 'path': 'run.input.age'}),
      expect.objectContaining({'code': 'schema_required', 'path': 'run.input.items.0.id'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'run.input.extra'}),
    ]));
  });

  test('supports enum and const with deep value comparison', () => {
    const okResult = validateRuntimeValue({
      'schema': {
        'enum': [{'status': 'ready'}, {'status': 'done'}],
        'const': {'status': 'done'},
      },
      'value': {'status': 'done'},
    });

    const failResult = validateRuntimeValue({
      'path': 'payload',
      'schema': {
        'enum': [1, 2],
        'const': 2,
      },
      'value': 3,
    });

    expect(okResult).toEqual({'ok': true, 'diagnostics': []});
    expect(failResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_enum', 'path': 'payload'}),
      expect.objectContaining({'code': 'schema_const', 'path': 'payload'}),
    ]));
  });

  test('applies additionalProperties schema and escapes ambiguous keys in paths', () => {
    const result = validateRuntimeValue({
      'path': 'data',
      'schema': {
        'type': 'object',
        'properties': {
          'known': {'type': 'string'},
        },
        'additionalProperties': {
          'type': 'array',
          'items': {
            'type': 'number',
            'minimum': 5,
          },
        },
      },
      'value': {
        'known': 'ok',
        'a.b': [3],
      },
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_minimum', 'path': 'data["a.b"].0'}),
    ]));
  });

  test('checks type unions and minProperties at root path', () => {
    const typeResult = validateRuntimeValue({
      'path': 'result',
      'schema': {'type': ['string', 'number']},
      'value': true,
    });

    const propertyResult = validateRuntimeValue({
      'schema': {'type': 'object', 'minProperties': 2},
      'value': {'only': 1},
    });

    expect(typeResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_type', 'path': 'result'}),
    ]));
    expect(propertyResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_min_properties', 'path': ''}),
    ]));
  });

  test('keeps unsupported keywords and malformed keyword values permissive', () => {
    const result = validateRuntimeValue({
      'schema': {
        'type': 'object',
        'properties': 'not-an-object',
        'required': 'not-an-array',
        'minimum': 'not-a-number',
        'not': {'type': 'null'},
        'patternProperties': {
          '^x': {'type': 'string'},
        },
      },
      'value': {'x': 123},
    });

    expect(result).toEqual({'ok': true, 'diagnostics': []});
  });
});
