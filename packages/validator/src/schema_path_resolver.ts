/**
 * JSON Schema path descent logic for expression reference validation.
 *
 * 表达式引用校验中使用的 JSON Schema 路径向下解析逻辑。
 */
import {SchemaPathResult} from './expression_reference_validator.js';
import {
  isArraySchema,
  isKnownPrimitiveLeafSchema,
  isObjectSchema,
  isPlainObject,
  matchesPattern,
} from './schema_type_detect.js';

/**
 * Follow a reference path through a schema-like object.
 *
 * 沿着引用路径在类 Schema 对象中逐层向下解析。
 */
export function checkSchemaPath(schema: unknown, path: string[]): SchemaPathResult {
  let currentSchema: unknown = schema;

  for (const segment of path) {
    const result = descendSchema(currentSchema, segment);
    if (result.kind !== 'schema') {
      return result.kind;
    }

    currentSchema = result.schema;
  }

  if (currentSchema === false) {
    return 'missing';
  }

  return 'present';
}

type DescendResult = {kind: 'missing' | 'unknown'} | {kind: 'schema'; schema: unknown};

/**
 * Descend one path segment into a schema and report whether the path stays known.
 *
 * 沿着单个路径片段深入 schema，并报告该路径是否仍然可知。
 */
export function descendSchema(
  schema: unknown,
  segment: string,
): DescendResult {
  if (schema === false) {
    return {'kind': 'missing'};
  }

  if (!isPlainObject(schema)) {
    return {'kind': 'unknown'};
  }

  const isBothArrayAndObject = isArraySchema(schema) && isObjectSchema(schema);

  if (isArraySchema(schema)) {
    if (/^\d+$/.test(segment)) {
      const arrayResult = descendArraySchema(schema, segment);
      if (!isBothArrayAndObject) {
        return arrayResult;
      }
      if (arrayResult.kind === 'schema') {
        const objectResult = descendObjectSchema(schema, segment);
        if (objectResult.kind !== 'missing') {
          return objectResult;
        }
      }
      return arrayResult.kind !== 'schema' ? descendObjectSchema(schema, segment) : arrayResult;
    }

    if (!isBothArrayAndObject) {
      return {'kind': 'missing'};
    }
  }

  if (isObjectSchema(schema)) {
    return descendObjectSchema(schema, segment);
  }

  if (isKnownPrimitiveLeafSchema(schema)) {
    return {'kind': 'missing'};
  }

  return {'kind': 'unknown'};
}

/**
 * Resolve a numeric segment against an array schema.
 *
 * 针对数组 schema 解析一个数字路径片段。
 */
export function descendArraySchema(
  schema: Record<string, unknown>,
  segment: string,
): DescendResult {
  if (schema.items === false) {
    return {'kind': 'missing'};
  }

  if (isPlainObject(schema.items)) {
    return {'kind': 'schema', 'schema': schema.items};
  }

  if (Array.isArray(schema.items)) {
    return descendTupleArraySchema(schema, segment);
  }

  return {'kind': 'unknown'};
}

/**
 * Resolve tuple-style arrays that declare per-index item schemas.
 *
 * 解析逐索引声明 item schema 的元组风格数组。
 */
function descendTupleArraySchema(
  schema: Record<string, unknown>,
  segment: string,
): DescendResult {
  const items = schema.items as unknown[];
  const itemSchema = items[Number(segment)];
  if (itemSchema !== undefined) {
    if (itemSchema === false) {
      return {'kind': 'missing'};
    }
    return {'kind': 'schema', 'schema': itemSchema};
  }

  if (schema.additionalItems === false) {
    return {'kind': 'missing'};
  }

  if (isPlainObject(schema.additionalItems)) {
    return {'kind': 'schema', 'schema': schema.additionalItems};
  }

  return {'kind': 'unknown'};
}

/**
 * Resolve a property segment against `properties`, `patternProperties`, and `additionalProperties`.
 *
 * 按 `properties`、`patternProperties` 与 `additionalProperties` 的优先级解析对象属性路径。
 */
export function descendObjectSchema(
  schema: Record<string, unknown>,
  segment: string,
): DescendResult {
  const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
  const hasProperty = properties !== undefined && Object.hasOwn(properties, segment);
  const propertySchema = hasProperty ? properties[segment] : undefined;
  const matchingPatternSchemas = collectMatchingPatternSchemas(schema, segment);

  if (hasProperty && matchingPatternSchemas.length > 0) {
    return resolvePropertyAndPatternConflict(propertySchema, matchingPatternSchemas);
  }

  if (hasProperty) {
    return resolveExactPropertySchema(propertySchema);
  }

  if (matchingPatternSchemas.length > 0) {
    return resolvePatternSchemas(schema, matchingPatternSchemas);
  }

  return resolveFromAdditionalProperties(schema);
}

/**
 * Collect pattern property schemas whose regex matches the given segment.
 */
function collectMatchingPatternSchemas(
  schema: Record<string, unknown>,
  segment: string,
): unknown[] {
  if (!isPlainObject(schema.patternProperties)) {
    return [];
  }

  return Object.entries(schema.patternProperties)
    .filter(([pattern]) => matchesPattern(segment, pattern))
    .map(([, patternSchema]) => patternSchema);
}

/**
 * Resolve when both an exact property and pattern properties match the segment.
 * When both match with potentially conflicting constraints, the result is 'missing'
 * if any schema is false, otherwise 'unknown' due to ambiguity.
 */
function resolvePropertyAndPatternConflict(
  propertySchema: unknown,
  matchingPatternSchemas: unknown[],
): DescendResult {
  if (propertySchema === false || matchingPatternSchemas.some((s) => s === false)) {
    return {'kind': 'missing'};
  }

  return {'kind': 'unknown'};
}

/**
 * Resolve when only the exact property matches (no pattern properties match).
 */
function resolveExactPropertySchema(propertySchema: unknown): DescendResult {
  if (propertySchema === false) {
    return {'kind': 'missing'};
  }

  return {'kind': 'schema', 'schema': propertySchema};
}

/**
 * Resolve when only pattern properties match (no exact property matches).
 */
function resolvePatternSchemas(
  schema: Record<string, unknown>,
  matchingPatternSchemas: unknown[],
): DescendResult {
  if (matchingPatternSchemas.length === 1) {
    if (matchingPatternSchemas[0] === false) {
      return {'kind': 'missing'};
    }
    return {'kind': 'schema', 'schema': matchingPatternSchemas[0]};
  }

  // Multiple pattern properties match — ambiguous unless one prohibits
  if (matchingPatternSchemas.some((s) => s === false)) {
    if (isArraySchema(schema)) {
      return {'kind': 'unknown'};
    }
    return {'kind': 'missing'};
  }
  return {'kind': 'unknown'};
}

/**
 * Resolve via additionalProperties when neither exact nor pattern properties match.
 */
function resolveFromAdditionalProperties(schema: Record<string, unknown>): DescendResult {
  if (schema.additionalProperties === false) {
    return {'kind': 'missing'};
  }

  if (isPlainObject(schema.additionalProperties)) {
    return {'kind': 'schema', 'schema': schema.additionalProperties};
  }

  return {'kind': 'unknown'};
}
