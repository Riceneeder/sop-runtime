/**
 * Run input / step output reference validation for template expressions.
 *
 * 对模板表达式中 run.input.* 与 steps.*.output.* 引用进行校验。
 */
import {ExpressionNode} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic.js';
import {checkSchemaPath} from './schema_path_resolver.js';

type SchemaPathResult = 'missing' | 'present' | 'unknown';

export interface ExpressionValidationContext {
  /** Input schema used to validate `run.input.*` references. 用于校验 `run.input.*` 引用的输入模式。 */
  inputSchema: unknown;
  /** Default input values that may legally satisfy missing input paths. 可以补足缺失输入路径的默认值集合。 */
  defaultsSchema: unknown;
  /** All known step ids declared in the definition. 当前定义中声明的所有步骤标识。 */
  knownStepIds: Set<string>;
  /** Output schemas indexed by step id for output-path validation. 按步骤标识索引的输出模式，用于校验输出路径。 */
  outputSchemasByStepId: Map<string, unknown>;
}

export interface ExpressionValidationOptions {
  /** Reachable step ids when validating final output references. 校验最终输出时可达的步骤标识集合。 */
  reachableStepIds?: Set<string>;
}

export {SchemaPathResult};

/**
 * Validate one parsed expression node against the available definition context.
 *
 * 结合定义上下文校验单个已解析表达式节点。
 */
export function validateExpressionNode(
  node: ExpressionNode,
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
  options: ExpressionValidationOptions = {},
): void {
  if (node.kind === 'coalesce') {
    for (const expression of node.expressions) {
      validateExpressionNode(expression, path, context, diagnostics, options);
    }
    return;
  }

  if (node.kind !== 'reference') {
    return;
  }

  validateReferenceExpression(node, path, context, diagnostics, options);
}

/**
 * Validate a single reference expression node by routing to the appropriate source validator.
 */
function validateReferenceExpression(
  node: ExpressionNode & {kind: 'reference'},
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
  options: ExpressionValidationOptions,
): void {
  const stepCheckResult = validateStepIdReference(node, context, options);
  if (stepCheckResult === 'blocked') {
    diagnostics.push(buildUnknownStepDiagnostic(node, path));
    return;
  }
  if (stepCheckResult === 'unreachable') {
    diagnostics.push(buildUnreachableStepDiagnostic(node, path));
    return;
  }

  if (node.source === 'run_input') {
    validateRunInputReference(node, path, context, diagnostics);
    return;
  }

  if (node.source === 'step_output' && node.step_id !== undefined) {
    validateStepOutputReference(node, path, context, diagnostics);
  }
}

type StepCheckResult = 'ok' | 'blocked' | 'unreachable';

/**
 * Check whether a referenced step id is known and reachable.
 *
 * Returns 'blocked' for unknown steps, 'unreachable' for reachability violations, or 'ok'.
 */
function validateStepIdReference(
  node: ExpressionNode & {kind: 'reference'},
  context: ExpressionValidationContext,
  options: ExpressionValidationOptions,
): StepCheckResult {
  if (node.source === 'run_input' || node.step_id === undefined) {
    return 'ok';
  }

  if (!context.knownStepIds.has(node.step_id)) {
    return 'blocked';
  }

  if (
    options.reachableStepIds !== undefined
    && !options.reachableStepIds.has(node.step_id)
  ) {
    return 'unreachable';
  }

  return 'ok';
}

function buildUnknownStepDiagnostic(node: ExpressionNode & {kind: 'reference'}, path: string): Diagnostic {
  return {
    'code': 'expression_unknown_step',
    'message': `Expression references unknown step: ${node.step_id!}`,
    'path': path,
  };
}

function buildUnreachableStepDiagnostic(node: ExpressionNode & {kind: 'reference'}, path: string): Diagnostic {
  return {
    'code': 'expression_unreachable_step',
    'message': `Final output references unreachable step: ${node.step_id!}`,
    'path': path,
  };
}

/**
 * Validate a `run.input.*` reference against the input schema and defaults.
 */
function validateRunInputReference(
  node: ExpressionNode & {kind: 'reference'},
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
): void {
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
}

/**
 * Validate a `steps.<id>.output.*` reference against the step's output schema.
 */
function validateStepOutputReference(
  node: ExpressionNode & {kind: 'reference'},
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
): void {
  const outputSchema = context.outputSchemasByStepId.get(node.step_id!);
  if (checkSchemaPath(outputSchema, node.path) === 'missing') {
    diagnostics.push({
      'code': 'expression_unknown_output',
      'message': `Expression references unknown step output field: ${node.raw}`,
      'path': path,
    });
  }
}

/**
 * Check whether a concrete defaults object contains the referenced path.
 *
 * 检查具体的默认值对象里是否存在被引用的字段路径。
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
