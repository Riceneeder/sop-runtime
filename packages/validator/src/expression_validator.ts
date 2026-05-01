/**
 * Expression-aware validation for templates embedded in SOP definitions.
 *
 * 针对 SOP 定义中嵌入模板表达式的引用校验器。
 */
import {ExpressionNode, ExpressionSyntaxError, SopDefinition, parseExpressionTemplate} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic.js';
import {joinPath} from './path.js';

type SchemaPathResult = 'missing' | 'present' | 'unknown';

interface ExpressionValidationContext {
  /** Input schema used to validate `run.input.*` references. 用于校验 `run.input.*` 引用的输入模式。 */
  inputSchema: unknown;
  /** Default input values that may legally satisfy missing input paths. 可以补足缺失输入路径的默认值集合。 */
  defaultsSchema: unknown;
  /** All known step ids declared in the definition. 当前定义中声明的所有步骤标识。 */
  knownStepIds: Set<string>;
  /** Output schemas indexed by step id for output-path validation. 按步骤标识索引的输出模式，用于校验输出路径。 */
  outputSchemasByStepId: Map<string, unknown>;
}

interface ExpressionValidationOptions {
  /** Reachable step ids when validating final output references. 校验最终输出时可达的步骤标识集合。 */
  reachableStepIds?: Set<string>;
}

/**
 * Validate every template-bearing field in the SOP definition.
 *
 * 校验 SOP 定义中所有允许出现模板表达式的字段。
 *
 * @param definition - SOP definition to inspect for template expressions.
 * 需要检查模板表达式的 SOP 定义。
 * @returns Expression diagnostics discovered during validation.
 * 表达式校验过程中发现的诊断结果。
 */
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

    const stepObj = step as unknown as Record<string, unknown>;

    if (typeof stepObj.inputs === 'object' && stepObj.inputs !== null && !Array.isArray(stepObj.inputs)) {
      visitTemplateValue(stepObj.inputs, joinPath('steps', stepIndex, 'inputs'), context, diagnostics);
    }

    // Validate expression templates in executor config string values.
    if (typeof stepObj.executor === 'object' && stepObj.executor !== null && !Array.isArray(stepObj.executor)) {
      const executorConfig = (stepObj.executor as Record<string, unknown>).config;
      if (typeof executorConfig === 'object' && executorConfig !== null && !Array.isArray(executorConfig)) {
        for (const [key, value] of Object.entries(executorConfig)) {
          if (typeof value === 'string') {
            validateTemplate(value, joinPath('steps', stepIndex, 'executor', 'config', key), context, diagnostics);
          }
        }
      }
    }
  });

  visitTemplateValue(definition.final_output, 'final_output', context, diagnostics, finalOutputOptions);

  return diagnostics;
}

/**
 * Walk arbitrary JSON-like values and validate any string templates found within.
 *
 * 遍历任意 JSON 风格值，并校验其中出现的字符串模板。
 *
 * @param value - JSON-like value to traverse.
 * 待遍历的 JSON 风格值。
 * @param path - Diagnostic path for the current value.
 * 当前值对应的诊断路径。
 * @param context - Shared validation context.
 * 共享的表达式校验上下文。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 * @param options - Additional validation options for the current walk.
 * 当前遍历过程使用的附加校验选项。
 */
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

/**
 * Parse a template and validate every embedded expression segment.
 *
 * 解析模板字符串，并校验其中每个嵌入表达式片段。
 *
 * @param template - Raw template string to parse.
 * 需要解析的原始模板字符串。
 * @param path - Diagnostic path for the template field.
 * 模板字段对应的诊断路径。
 * @param context - Shared validation context.
 * 共享的表达式校验上下文。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 * @param options - Additional validation options for the current template.
 * 当前模板使用的附加校验选项。
 */
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

/**
 * Convert parser syntax errors into user-facing diagnostics.
 *
 * 把解析器抛出的语法错误转换为用户可见的诊断信息。
 *
 * @param error - Syntax error thrown by the expression parser.
 * 表达式解析器抛出的语法错误。
 * @param path - Diagnostic path for the invalid template field.
 * 非法模板字段对应的诊断路径。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 */
function pushExpressionSyntaxDiagnostic(error: ExpressionSyntaxError, path: string, diagnostics: Diagnostic[]): void {
  diagnostics.push({
    'code': 'expression_syntax',
    'message': error.message,
    'path': path,
  });
}

/**
 * Validate one parsed expression node against the available definition context.
 *
 * 结合定义上下文校验单个已解析表达式节点。
 *
 * @param node - Parsed expression node to validate.
 * 需要校验的已解析表达式节点。
 * @param path - Diagnostic path for the template field.
 * 模板字段对应的诊断路径。
 * @param context - Shared validation context.
 * 共享的表达式校验上下文。
 * @param diagnostics - Mutable diagnostic collection.
 * 可变诊断结果集合。
 * @param options - Additional validation options for the current expression.
 * 当前表达式使用的附加校验选项。
 */
function validateExpressionNode(
  node: ExpressionNode,
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
  options: ExpressionValidationOptions = {},
): void {
  if (node.kind === 'coalesce') {
    node.expressions.forEach((expression: ExpressionNode) => validateExpressionNode(expression, path, context, diagnostics, options));
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

/**
 * Compute all steps reachable from the declared entry step via valid transitions.
 *
 * 从入口步骤出发，计算通过合法转移能够到达的全部步骤。
 *
 * @param definition - Root SOP definition.
 * SOP 根定义对象。
 * @param steps - Raw step list from the definition.
 * 定义中的原始步骤列表。
 * @param knownStepIds - Set of known step identifiers.
 * 已知步骤标识集合。
 * @returns Reachable step ids, or `undefined` when reachability cannot be computed safely.
 * 可达步骤标识集合；若无法安全计算则返回 `undefined`。
 */
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

/**
 * Collect the outcome ids that supervision explicitly allows for a step.
 *
 * 收集某个步骤监督配置里显式允许的 outcome 标识。
 *
 * @param step - Step-like record under inspection.
 * 正在检查的步骤记录对象。
 * @returns Allowed outcome id set, or `undefined` when supervision is not well-formed.
 * 允许的 outcome 标识集合；若监督配置结构不完整则返回 `undefined`。
 */
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

/**
 * Read the next-step target from a transition only when the transition is structurally valid.
 *
 * 仅当转移结构合法时，读取其中的下一步骤目标。
 *
 * @param transition - Candidate transition object.
 * 待检查的转移对象。
 * @returns Next step id when present and valid.
 * 下一步骤标识；仅在字段存在且合法时返回。
 */
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

/**
 * Follow a reference path through a schema-like object.
 *
 * 沿着引用路径在类 Schema 对象中逐层向下解析。
 *
 * @param schema - Starting schema-like value.
 * 起始的类 Schema 值。
 * @param path - Reference path segments to follow.
 * 需要依次跟随的引用路径片段。
 * @returns Whether the path is present, missing, or indeterminate.
 * 路径是存在、缺失还是无法确定。
 */
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

/**
 * Descend one path segment into a schema and report whether the path stays known.
 *
 * 沿着单个路径片段深入 schema，并报告该路径是否仍然可知。
 *
 * @param schema - Current schema node.
 * 当前 schema 节点。
 * @param segment - Next path segment to resolve.
 * 下一个需要解析的路径片段。
 * @returns Resolution result for the path segment.
 * 该路径片段的解析结果。
 */
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

/**
 * Resolve a numeric segment against an array schema.
 *
 * 针对数组 schema 解析一个数字路径片段。
 *
 * @param schema - Array-like schema node.
 * 数组风格的 schema 节点。
 * @param segment - Numeric path segment.
 * 数字型路径片段。
 * @returns Resolution result for the array segment.
 * 数组路径片段的解析结果。
 */
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

/**
 * Resolve tuple-style arrays that declare per-index item schemas.
 *
 * 解析逐索引声明 item schema 的元组风格数组。
 *
 * @param schema - Tuple-like schema node.
 * 元组风格的 schema 节点。
 * @param segment - Numeric path segment.
 * 数字型路径片段。
 * @returns Resolution result for the tuple segment.
 * 元组路径片段的解析结果。
 */
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

/**
 * Resolve a property segment against `properties`, `patternProperties`, and `additionalProperties`.
 *
 * 按 `properties`、`patternProperties` 与 `additionalProperties` 的优先级解析对象属性路径。
 *
 * @param schema - Object-like schema node.
 * 对象风格的 schema 节点。
 * @param segment - Property name to resolve.
 * 需要解析的属性名。
 * @returns Resolution result for the property segment.
 * 属性路径片段的解析结果。
 */
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

/**
 * Check whether a schema behaves like an array schema.
 *
 * 判断 schema 是否表现为数组类型。
 *
 * @param schema - Schema-like record to inspect.
 * 待检查的类 schema 记录对象。
 * @returns Whether the schema should be treated as array-like.
 * 该 schema 是否应被视为数组风格。
 */
function isArraySchema(schema: Record<string, unknown>): boolean {
  return hasSchemaType(schema, 'array') || Object.hasOwn(schema, 'items');
}

/**
 * Check whether a schema behaves like an object schema.
 *
 * 判断 schema 是否表现为对象类型。
 *
 * @param schema - Schema-like record to inspect.
 * 待检查的类 schema 记录对象。
 * @returns Whether the schema should be treated as object-like.
 * 该 schema 是否应被视为对象风格。
 */
function isObjectSchema(schema: Record<string, unknown>): boolean {
  return hasSchemaType(schema, 'object')
    || Object.hasOwn(schema, 'properties')
    || Object.hasOwn(schema, 'additionalProperties')
    || Object.hasOwn(schema, 'patternProperties');
}

/**
 * Detect whether `schema.type` declares the expected JSON Schema type.
 *
 * 判断 `schema.type` 是否声明了期望的类型。
 *
 * @param schema - Schema-like record to inspect.
 * 待检查的类 schema 记录对象。
 * @param expectedType - Expected JSON Schema type literal.
 * 期望的 JSON Schema 类型字面量。
 * @returns Whether the expected type is declared.
 * 是否声明了期望类型。
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
 *
 * @param schema - Schema-like record to inspect.
 * 待检查的类 schema 记录对象。
 * @returns Whether the schema is a primitive leaf.
 * 该 schema 是否是原始值叶子节点。
 */
function isKnownPrimitiveLeafSchema(schema: Record<string, unknown>): boolean {
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
 *
 * @param schema - Schema-like record to inspect.
 * 待检查的类 schema 记录对象。
 * @returns Whether all declared types are primitive.
 * 声明的类型是否全部属于原始类型。
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
 *
 * @param type - JSON Schema type string.
 * JSON Schema 类型字符串。
 * @returns Whether the type string is primitive.
 * 该类型字符串是否表示原始类型。
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
 *
 * @param value - Runtime value to inspect.
 * 待检查的运行时值。
 * @returns Whether the value is a primitive JSON value.
 * 该值是否为 JSON 原始值。
 */
function isPrimitiveJsonValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Check whether an unknown value is a plain record-like object.
 *
 * 判断未知值是否为普通记录对象。
 *
 * @param value - Unknown value to inspect.
 * 待判断的未知值。
 * @returns Whether the value is a non-array object.
 * 该值是否为非数组对象。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check whether a concrete defaults object contains the referenced path.
 *
 * 检查具体的默认值对象里是否存在被引用的字段路径。
 *
 * @param obj - Defaults object to traverse.
 * 待遍历的默认值对象。
 * @param path - Path segments to follow.
 * 需要依次跟随的路径片段。
 * @returns Whether the path exists in the concrete object.
 * 该路径是否存在于具体对象中。
 */
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

/**
 * Safely test a property name against a possibly-invalid regex pattern.
 *
 * 用可能无效的正则模式安全匹配属性名。
 *
 * @param value - Property name to test.
 * 需要匹配的属性名。
 * @param pattern - Regex source text from a schema.
 * 来自 schema 的正则表达式源码。
 * @returns Whether the property name matches the pattern.
 * 属性名是否匹配该正则模式。
 */
function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}
