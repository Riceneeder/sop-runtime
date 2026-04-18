import {ExpressionNode, ExpressionSyntaxError, SopDefinition, parseExpressionTemplate} from '@sop-exec/definition';
import {Diagnostic} from './diagnostic';
import {joinPath} from './path';

type SchemaPathResult = 'missing' | 'present' | 'unknown';

interface ExpressionValidationContext {
  inputSchema: unknown;
  defaultsSchema: unknown;
  knownStepIds: Set<string>;
  outputSchemasByStepId: Map<string, unknown>;
}

interface ExpressionValidationOptions {
  reachableStepIds?: Set<string>;
}

export function validateExpressionDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  const knownStepIds = new Set<string>();
  const outputSchemasByStepId = new Map<string, unknown>();

  for (const step of steps) {
    if (typeof step === 'object' && step !== null && typeof step.id === 'string') {
      knownStepIds.add(step.id);
      outputSchemasByStepId.set(step.id, step.output_schema);
    }
  }

  const context: ExpressionValidationContext = {
    'inputSchema': definition.input_schema,
    'defaultsSchema': definition.defaults,
    knownStepIds,
    outputSchemasByStepId,
  };
  const finalOutputOptions: ExpressionValidationOptions = {
    'reachableStepIds': computeReachableStepIds(definition, steps, knownStepIds),
  };

  if (typeof definition.policies?.idempotency_key_template === 'string') {
    validateTemplate(definition.policies.idempotency_key_template, 'policies.idempotency_key_template', context, diagnostics);
  }

  if (typeof definition.policies?.concurrency?.key_template === 'string') {
    validateTemplate(definition.policies.concurrency.key_template, 'policies.concurrency.key_template', context, diagnostics);
  }

  steps.forEach((step, stepIndex) => {
    if (typeof step !== 'object' || step === null) {
      return;
    }

    if (typeof step.inputs === 'object' && step.inputs !== null && !Array.isArray(step.inputs)) {
      visitTemplateValue(step.inputs, joinPath('steps', stepIndex, 'inputs'), context, diagnostics);
    }

    if (typeof step.executor === 'object' && step.executor !== null) {
      if (typeof step.executor.path === 'string') {
        validateTemplate(step.executor.path, joinPath('steps', stepIndex, 'executor', 'path'), context, diagnostics);
      }
    }
  });

  visitTemplateValue(definition.final_output, 'final_output', context, diagnostics, finalOutputOptions);

  return diagnostics;
}

function visitTemplateValue(
  value: unknown,
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
  options: ExpressionValidationOptions = {},
): void {
  if (typeof value === 'string') {
    validateTemplate(value, path, context, diagnostics, options);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitTemplateValue(item, joinPath(path, index), context, diagnostics, options));
    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      visitTemplateValue(item, joinPath(path, key), context, diagnostics, options);
    }
  }
}

function validateTemplate(
  template: string,
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
  options: ExpressionValidationOptions = {},
): void {
  try {
    const segments = parseExpressionTemplate(template);
    for (const segment of segments) {
      if (segment.kind === 'expression') {
        validateExpressionNode(segment.expression, path, context, diagnostics, options);
      }
    }
  } catch (error) {
    if (error instanceof ExpressionSyntaxError) {
      pushExpressionSyntaxDiagnostic(error, path, diagnostics);
      return;
    }

    throw error;
  }
}

function pushExpressionSyntaxDiagnostic(error: ExpressionSyntaxError, path: string, diagnostics: Diagnostic[]): void {
  diagnostics.push({
    'code': 'expression_syntax',
    'message': error.message,
    'path': path,
  });
}

function validateExpressionNode(
  node: ExpressionNode,
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
  options: ExpressionValidationOptions = {},
): void {
  if (node.kind === 'coalesce') {
    node.expressions.forEach((expression) => validateExpressionNode(expression, path, context, diagnostics, options));
    return;
  }

  if (node.kind !== 'reference') {
    return;
  }

  if (node.source !== 'run_input' && node.step_id !== undefined && !context.knownStepIds.has(node.step_id)) {
    diagnostics.push({
      'code': 'expression_unknown_step',
      'message': `Expression references unknown step: ${node.step_id}`,
      'path': path,
    });
    return;
  }

  if (
    options.reachableStepIds !== undefined
    && node.source !== 'run_input'
    && node.step_id !== undefined
    && !options.reachableStepIds.has(node.step_id)
  ) {
    diagnostics.push({
      'code': 'expression_unreachable_step',
      'message': `Final output references unreachable step: ${node.step_id}`,
      'path': path,
    });
    return;
  }

  if (node.source === 'run_input') {
    const inputResult = checkSchemaPath(context.inputSchema, node.path);
    if (inputResult === 'missing') {
      if (context.defaultsSchema === undefined || !pathExistsInObject(context.defaultsSchema, node.path)) {
        diagnostics.push({
          'code': 'expression_unknown_input',
          'message': `Expression references unknown run input field: ${node.raw}`,
          'path': path,
        });
      }
    }
    return;
  }

  if (node.source === 'step_output' && node.step_id !== undefined) {
    const outputSchema = context.outputSchemasByStepId.get(node.step_id);
    if (checkSchemaPath(outputSchema, node.path) === 'missing') {
      diagnostics.push({
        'code': 'expression_unknown_output',
        'message': `Expression references unknown step output field: ${node.raw}`,
        'path': path,
      });
    }
  }
}

function computeReachableStepIds(
  definition: SopDefinition,
  steps: unknown[],
  knownStepIds: Set<string>,
): Set<string> | undefined {
  if (typeof definition.entry_step !== 'string' || !knownStepIds.has(definition.entry_step)) {
    return undefined;
  }

  const stepById = new Map<string, Record<string, unknown>>();
  for (const step of steps) {
    if (isPlainObject(step) && typeof step.id === 'string' && !stepById.has(step.id)) {
      stepById.set(step.id, step);
    }
  }

  const reachableStepIds = new Set<string>();
  const queue = [definition.entry_step];

  while (queue.length > 0) {
    const stepId = queue.shift();
    if (stepId === undefined || reachableStepIds.has(stepId)) {
      continue;
    }

    reachableStepIds.add(stepId);
    const step = stepById.get(stepId);
    if (step === undefined || !isPlainObject(step.transitions)) {
      continue;
    }

    const allowedOutcomeIds = collectAllowedOutcomeIds(step);
    for (const [transitionKey, transition] of Object.entries(step.transitions)) {
      if (allowedOutcomeIds !== undefined && !allowedOutcomeIds.has(transitionKey)) {
        continue;
      }

      const nextStepId = getValidTransitionNextStepId(transition);
      if (nextStepId !== undefined && knownStepIds.has(nextStepId) && !reachableStepIds.has(nextStepId)) {
        queue.push(nextStepId);
      }
    }
  }

  return reachableStepIds;
}

function collectAllowedOutcomeIds(step: Record<string, unknown>): Set<string> | undefined {
  if (!isPlainObject(step.supervision) || !Array.isArray(step.supervision.allowed_outcomes)) {
    return undefined;
  }

  const outcomeIds = new Set<string>();
  for (const outcome of step.supervision.allowed_outcomes) {
    if (isPlainObject(outcome) && typeof outcome.id === 'string') {
      outcomeIds.add(outcome.id);
    }
  }

  return outcomeIds;
}

function getValidTransitionNextStepId(transition: unknown): string | undefined {
  if (!isPlainObject(transition)) {
    return undefined;
  }

  const hasNextStep = Object.hasOwn(transition, 'next_step');
  const hasTerminate = Object.hasOwn(transition, 'terminate');
  if (!hasNextStep || hasTerminate || typeof transition.next_step !== 'string') {
    return undefined;
  }

  return transition.next_step;
}

function checkSchemaPath(schema: unknown, path: string[]): SchemaPathResult {
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

function descendSchema(
  schema: unknown,
  segment: string,
): {kind: 'missing' | 'unknown'} | {kind: 'schema'; schema: unknown} {
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

function descendArraySchema(
  schema: Record<string, unknown>,
  segment: string,
): {kind: 'missing' | 'unknown'} | {kind: 'schema'; schema: unknown} {
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

function descendTupleArraySchema(
  schema: Record<string, unknown>,
  segment: string,
): {kind: 'missing' | 'unknown'} | {kind: 'schema'; schema: unknown} {
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

function descendObjectSchema(
  schema: Record<string, unknown>,
  segment: string,
): {kind: 'missing' | 'unknown'} | {kind: 'schema'; schema: unknown} {
  const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
  const hasProperty = properties !== undefined && Object.hasOwn(properties, segment);
  const propertySchema = hasProperty ? properties[segment] : undefined;

  const matchingPatternSchemas = isPlainObject(schema.patternProperties)
    ? Object.entries(schema.patternProperties)
        .filter(([pattern]) => matchesPattern(segment, pattern))
        .map(([, patternSchema]) => patternSchema)
    : [];

  if (hasProperty && matchingPatternSchemas.length > 0) {
    if (propertySchema === false || matchingPatternSchemas.some((s) => s === false)) {
      return {'kind': 'missing'};
    }

    return {'kind': 'unknown'};
  }

  if (hasProperty) {
    if (propertySchema === false) {
      return {'kind': 'missing'};
    }

    return {'kind': 'schema', 'schema': propertySchema};
  }

  if (matchingPatternSchemas.length === 1) {
    if (matchingPatternSchemas[0] === false) {
      return {'kind': 'missing'};
    }

    return {'kind': 'schema', 'schema': matchingPatternSchemas[0]};
  }

  if (matchingPatternSchemas.length > 1) {
    if (matchingPatternSchemas.some((s) => s === false)) {
      if (isArraySchema(schema)) {
        return {'kind': 'unknown'};
      }
      return {'kind': 'missing'};
    }
    return {'kind': 'unknown'};
  }

  if (schema.additionalProperties === false) {
    return {'kind': 'missing'};
  }

  if (isPlainObject(schema.additionalProperties)) {
    return {'kind': 'schema', 'schema': schema.additionalProperties};
  }

  return {'kind': 'unknown'};
}

function isArraySchema(schema: Record<string, unknown>): boolean {
  return hasSchemaType(schema, 'array') || Object.hasOwn(schema, 'items');
}

function isObjectSchema(schema: Record<string, unknown>): boolean {
  return hasSchemaType(schema, 'object')
    || Object.hasOwn(schema, 'properties')
    || Object.hasOwn(schema, 'additionalProperties')
    || Object.hasOwn(schema, 'patternProperties');
}

function hasSchemaType(schema: Record<string, unknown>, expectedType: string): boolean {
  if (typeof schema.type === 'string') {
    return schema.type === expectedType;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.includes(expectedType);
  }

  return false;
}

function isKnownPrimitiveLeafSchema(schema: Record<string, unknown>): boolean {
  if (isPrimitiveTypedSchema(schema)) {
    return true;
  }

  if (Object.hasOwn(schema, 'const')) {
    return isPrimitiveJsonValue(schema.const);
  }

  return Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((value) => isPrimitiveJsonValue(value));
}

function isPrimitiveTypedSchema(schema: Record<string, unknown>): boolean {
  if (typeof schema.type === 'string') {
    return isPrimitiveSchemaType(schema.type);
  }

  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return schema.type.every((item) => typeof item === 'string' && isPrimitiveSchemaType(item));
  }

  return false;
}

function isPrimitiveSchemaType(type: string): boolean {
  return type === 'string'
    || type === 'number'
    || type === 'integer'
    || type === 'boolean'
    || type === 'null';
}

function isPrimitiveJsonValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathExistsInObject(obj: unknown, path: string[]): boolean {
  if (!isPlainObject(obj)) {
    return false;
  }

  let current: unknown = obj;
  for (const segment of path) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (index >= current.length) {
        return false;
      }
      current = current[index];
    } else if (isPlainObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return false;
    }
  }

  return true;
}

function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}
