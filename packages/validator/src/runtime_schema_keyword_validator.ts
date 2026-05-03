import { Diagnostic } from './diagnostic.js';
import { joinPath } from './path.js';

/**
 * Parameters for validating the structure of supported JSON Schema keywords.
 *
 * 校验支持的 JSON Schema 关键字自身结构的参数。
 */
export interface SchemaKeywordValidationParams {
  /** The schema value to validate keywords on. 待校验关键字的 schema。 */
  schema: unknown;
  /** Dot-separated path prefix. 点号分隔的路径前缀。 */
  path: string;
  /** Diagnostics accumulator. 诊断收集器。 */
  diagnostics: Diagnostic[];
}

interface NarrowParams {
  schema: Record<string, unknown>;
  path: string;
  diagnostics: Diagnostic[];
}

const SUPPORTED_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);

/**
 * Validate that supported JSON Schema keywords have correct types/shapes.
 *
 * 校验支持的 JSON Schema 关键字的类型和结构是否正确。
 * Unsupported keywords (e.g. `not`, `patternProperties`) are silently ignored.
 *
 * @param params - The validation parameters including schema, path, and diagnostics.
 */
export function validateRuntimeSchemaKeywords(params: SchemaKeywordValidationParams): void {
  const { path, diagnostics } = params;
  if (!isPlainObject(params.schema)) {
    return;
  }

  const schema: Record<string, unknown> = params.schema;

  validateTypeKeywordShape({ schema, path, diagnostics });
  validatePropertiesKeywordShape({ schema, path, diagnostics });
  validateRequiredKeywordShape({ schema, path, diagnostics });
  validateItemsKeywordShape({ schema, path, diagnostics });
  validateAdditionalPropertiesKeywordShape({ schema, path, diagnostics });

  // minimum must be a finite number
  if ('minimum' in schema && (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum))) {
    diagnostics.push({
      'code': 'schema_type',
      'message': 'Expected number.',
      'path': joinPath(path, 'minimum'),
    });
  }

  // enum must be an array
  if ('enum' in schema && !Array.isArray(schema.enum)) {
    diagnostics.push({
      'code': 'schema_type',
      'message': 'Expected array.',
      'path': joinPath(path, 'enum'),
    });
  }

  // minLength, minItems, minProperties must be non-negative integers
  ['minLength', 'minItems', 'minProperties'].forEach((key) => {
    validateNonNegativeIntegerKeyword({ 'schema': schema, 'key': key, 'path': path, 'diagnostics': diagnostics });
  });

  // Recurse into sub-schemas
  recurseSubSchemas({ schema, path, diagnostics });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recurse into nested sub-schemas in properties, items, and additionalProperties.
 */
function recurseSubSchemas(params: NarrowParams): void {
  const { schema, path, diagnostics } = params;

  if (isPlainObject(schema.properties)) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      const subPath = joinPath(path, 'properties', key);
      validateRuntimeSchemaKeywords({ 'schema': subSchema, 'path': subPath, 'diagnostics': diagnostics });
    }
  }

  if (isPlainObject(schema.items)) {
    const itemsPath = joinPath(path, 'items');
    validateRuntimeSchemaKeywords({ 'schema': schema.items, 'path': itemsPath, 'diagnostics': diagnostics });
  } else if (Array.isArray(schema.items)) {
    schema.items.forEach((item, index) => {
      if (isPlainObject(item)) {
        const itemPath = joinPath(path, 'items', index);
        validateRuntimeSchemaKeywords({ 'schema': item, 'path': itemPath, 'diagnostics': diagnostics });
      }
    });
  }

  if (isPlainObject(schema.additionalProperties)) {
    const apPath = joinPath(path, 'additionalProperties');
    validateRuntimeSchemaKeywords({ 'schema': schema.additionalProperties, 'path': apPath, 'diagnostics': diagnostics });
  }
}

function validateTypeKeywordShape(params: NarrowParams): void {
  const { schema, path, diagnostics } = params;

  if (!('type' in schema)) {
    return;
  }

  const typeVal: unknown = schema.type;

  // string type
  if (typeof typeVal === 'string') {
    if (!SUPPORTED_SCHEMA_TYPES.has(typeVal)) {
      diagnostics.push({
        'code': 'schema_enum',
        'message': 'Expected one of: array, boolean, integer, null, number, object, string',
        'path': joinPath(path, 'type'),
      });
    }
    return;
  }

  // array type
  if (Array.isArray(typeVal)) {
    if (typeVal.length === 0) {
      diagnostics.push({
        'code': 'schema_min_items',
        'message': 'Expected at least 1 items.',
        'path': joinPath(path, 'type'),
      });
    }

    typeVal.forEach((t, i) => {
      if (typeof t !== 'string' || !SUPPORTED_SCHEMA_TYPES.has(t)) {
        const itemPath = joinPath(path, 'type', i);
        diagnostics.push({
          'code': 'schema_enum',
          'message': 'Expected one of: array, boolean, integer, null, number, object, string',
          'path': itemPath,
        });
      }
    });
    return;
  }

  // any other type value
  diagnostics.push({
    'code': 'schema_type',
    'message': 'Expected string or array.',
    'path': joinPath(path, 'type'),
  });
}

function validatePropertiesKeywordShape(params: NarrowParams): void {
  const { schema, path, diagnostics } = params;

  if (!('properties' in schema)) {
    return;
  }

  if (!isPlainObject(schema.properties)) {
    diagnostics.push({
      'code': 'schema_type',
      'message': 'Expected object.',
      'path': joinPath(path, 'properties'),
    });
    return;
  }

  for (const [key, value] of Object.entries(schema.properties)) {
    if (!isPlainObject(value)) {
      const propPath = joinPath(path, 'properties', key);
      diagnostics.push({
        'code': 'schema_type',
        'message': 'Expected object.',
        'path': propPath,
      });
    }
  }
}

function validateRequiredKeywordShape(params: NarrowParams): void {
  const { schema, path, diagnostics } = params;

  if (!('required' in schema)) {
    return;
  }

  if (!Array.isArray(schema.required)) {
    diagnostics.push({
      'code': 'schema_type',
      'message': 'Expected array.',
      'path': joinPath(path, 'required'),
    });
    return;
  }

  schema.required.forEach((req, i) => {
    if (typeof req !== 'string') {
      const reqPath = joinPath(path, 'required', i);
      diagnostics.push({
        'code': 'schema_type',
        'message': 'Expected string.',
        'path': reqPath,
      });
    }
  });
}

function validateNonNegativeIntegerKeyword(params: NarrowParams & { key: string }): void {
  const { schema, key, path, diagnostics } = params;

  if (!(key in schema)) {
    return;
  }

  const value = (schema as Record<string, unknown>)[key];

  if (!Number.isInteger(value)) {
    diagnostics.push({
      'code': 'schema_type',
      'message': 'Expected integer.',
      'path': joinPath(path, key),
    });
    return;
  }

  if ((value as number) < 0) {
    diagnostics.push({
      'code': 'schema_minimum',
      'message': 'Expected integer >= 0.',
      'path': joinPath(path, key),
    });
  }
}

function validateItemsKeywordShape(params: NarrowParams): void {
  const { schema, path, diagnostics } = params;

  if (!('items' in schema)) {
    return;
  }

  if (isPlainObject(schema.items) || Array.isArray(schema.items)) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((item, i) => {
        if (!isPlainObject(item)) {
          const itemPath = joinPath(path, 'items', i);
          diagnostics.push({
            'code': 'schema_type',
            'message': 'Expected object.',
            'path': itemPath,
          });
        }
      });
    }
    return;
  }

  diagnostics.push({
    'code': 'schema_type',
    'message': 'Expected object or array.',
    'path': joinPath(path, 'items'),
  });
}

function validateAdditionalPropertiesKeywordShape(params: NarrowParams): void {
  const { schema, path, diagnostics } = params;

  if (!('additionalProperties' in schema)) {
    return;
  }

  const value = schema.additionalProperties;
  if (typeof value === 'boolean' || isPlainObject(value)) {
    return;
  }

  diagnostics.push({
    'code': 'schema_type',
    'message': 'Expected boolean or object.',
    'path': joinPath(path, 'additionalProperties'),
  });
}
