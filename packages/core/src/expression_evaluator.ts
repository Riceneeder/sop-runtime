import {
  ExpressionNode,
  JsonObject,
  JsonValue,
  RunState,
  parseExpressionTemplate,
} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';

/**
 * Internal details about a missing expression value.
 *
 * 表达式值缺失的内部细节信息。
 */
interface MissingExpressionValueDetails {
  /** The raw expression string. 原始表达式字符串。 */
  expression: string;
  /** Optional segment identifier within the expression. 表达式内可选的片段标识。 */
  segment?: string;
}

/**
 * Internal error raised when an expression cannot resolve a required value.
 *
 * 当表达式无法解析所需值时抛出的内部错误。
 */
class MissingExpressionValueError extends Error {
  readonly details: MissingExpressionValueDetails;

  constructor(message: string, details: MissingExpressionValueDetails) {
    super(message);
    this.name = 'MissingExpressionValueError';
    this.details = details;
  }
}

/**
 * Evaluate an expression template against the current run state.
 *
 * 基于当前运行状态解析表达式模板。
 *
 * @param params - Object containing the template and the run state.
 * @param params.template - The expression template string to evaluate.
 * @param params.state - Current run state used for variable resolution.
 * @returns The evaluated JSON value.
 * @throws {CoreError} If evaluation fails or the template is malformed.
 * @public
 */
export function evaluateExpressionTemplate(params: {
  template: string;
  state: RunState;
}): JsonValue {
  try {
    const segments = parseExpressionTemplate(params.template);
    if (segments.length === 1) {
      const segment = segments[0];
      if (!segment) {
        throw new CoreError('expression_evaluation_failed', {
          'message': 'Expression template parsing returned no segments.',
          'details': {'template': params.template},
        });
      }
      if (segment.kind === 'text') {
        return segment.value;
      }

      const result = evaluateExpressionNode(segment.expression, params.state);
      return typeof result === 'object' && result !== null ? structuredClone(result) : result;
    }

    let rendered = '';
    for (const segment of segments) {
      if (segment.kind === 'text') {
        rendered += segment.value;
        continue;
      }

      const value = evaluateExpressionNode(segment.expression, params.state);
      rendered += stringifyTemplateValue(value);
    }

    return rendered;
  } catch (error: unknown) {
    throw toExpressionError(error, {'template': params.template});
  }
}

/**
 * Recursively render expression templates within a JSON value.
 *
 * 递归渲染 JSON 值中的表达式模板。
 *
 * @param params - Object containing the JSON value and the run state.
 * @param params.value - The JSON value to render (strings are treated as templates).
 * @param params.state - Current run state used for variable resolution.
 * @returns The fully rendered JSON value.
 * @throws {CoreError} If any template evaluation fails.
 * @public
 */
export function renderJsonValueTemplates(params: {
  value: JsonValue;
  state: RunState;
}): JsonValue {
  if (typeof params.value === 'string') {
    return evaluateExpressionTemplate({
      'template': params.value,
      'state': params.state,
    });
  }

  if (Array.isArray(params.value)) {
    return params.value.map((item) => {
      return renderJsonValueTemplates({
        'value': item,
        'state': params.state,
      });
    });
  }

  if (isPlainObject(params.value)) {
    const rendered: JsonObject = {};
    for (const [key, value] of Object.entries(params.value)) {
      rendered[key] = renderJsonValueTemplates({
        value,
        'state': params.state,
      });
    }
    return rendered;
  }

  return params.value;
}

/**
 * Evaluate an expression AST node against the run state.
 *
 * 基于运行状态求解表达式 AST 节点。
 */
function evaluateExpressionNode(node: ExpressionNode, state: RunState): JsonValue {
  if (node.kind === 'literal') {
    return node.value;
  }

  if (node.kind === 'coalesce') {
    for (const candidate of node.expressions) {
      try {
        return evaluateExpressionNode(candidate, state);
      } catch (error: unknown) {
        if (isMissingExpressionValueError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new MissingExpressionValueError('All coalesce candidates are missing.', {
      'expression': stringifyExpressionNode(node),
    });
  }

  return evaluateReferenceNode(node, state);
}

/**
 * Resolve a reference expression node (run_input, step_output, step_artifacts).
 *
 * 解析引用表达式节点（run_input、step_output、step_artifacts）。
 */
function evaluateReferenceNode(node: Extract<ExpressionNode, {kind: 'reference'}>, state: RunState): JsonValue {
  if (node.source === 'run_input') {
    return readPath(state.run_input, node.path, node.raw);
  }

  const stepId = node.step_id;
  if (!stepId) {
    throw new CoreError('expression_evaluation_failed', {
      'message': 'Step reference is missing a step id.',
      'details': {'expression': node.raw},
    });
  }

  const acceptedResult = state.accepted_results[stepId];
  if (acceptedResult === undefined) {
    throw new MissingExpressionValueError(`No accepted result for step "${stepId}".`, {
      'expression': node.raw,
      'segment': stepId,
    });
  }

  if (node.source === 'step_output') {
    if (acceptedResult.output === undefined) {
      throw new MissingExpressionValueError(`Step "${stepId}" has no accepted output.`, {
        'expression': node.raw,
        'segment': stepId,
      });
    }

    return readPath(acceptedResult.output, node.path, node.raw);
  }

  if (acceptedResult.artifacts === undefined) {
    throw new MissingExpressionValueError(`Step "${stepId}" has no accepted artifacts.`, {
      'expression': node.raw,
      'segment': stepId,
    });
  }

  return readPath(acceptedResult.artifacts, node.path, node.raw);
}

/**
 * Walk a dotted path into a nested object and return the resolved value.
 *
 * 沿点号路径访问嵌套对象并返回解析后的值。
 */
function readPath(root: unknown, path: string[], expression: string): JsonValue {
  let current: unknown = root;

  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        throw new MissingExpressionValueError(`Array index "${segment}" is missing in "${expression}".`, {
          expression,
          segment,
        });
      }

      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
        throw new MissingExpressionValueError(`Array index "${segment}" is out of bounds in "${expression}".`, {
          expression,
          segment,
        });
      }

      current = current[index];
      continue;
    }

    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      throw new MissingExpressionValueError(`Path segment "${segment}" is missing in "${expression}".`, {
        expression,
        segment,
      });
    }

    current = current[segment];
  }

  if (current === undefined) {
    throw new MissingExpressionValueError(`Expression "${expression}" resolved to an undefined value.`, {
      expression,
    });
  }

  if (!isJsonValue(current)) {
    throw new CoreError('expression_evaluation_failed', {
      'message': `Expression "${expression}" resolved to a non-JSON value.`,
      'details': {'expression': expression},
    });
  }

  return current;
}

/**
 * Convert an evaluated JSON value into a string for template interpolation.
 *
 * 将已求解的 JSON 值转换为字符串用于模板插值。
 */
function stringifyTemplateValue(value: JsonValue): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  return JSON.stringify(value);
}

/**
 * Render an expression AST node back to its string representation.
 *
 * 将表达式 AST 节点还原为字符串表示形式。
 */
function stringifyExpressionNode(node: ExpressionNode): string {
  if (node.kind === 'literal') {
    return JSON.stringify(node.value);
  }
  if (node.kind === 'reference') {
    return node.raw;
  }

  const renderedChildren = node.expressions.map((item) => stringifyExpressionNode(item));
  return `coalesce(${renderedChildren.join(', ')})`;
}

/**
 * Normalize any thrown value into a CoreError for expression failures.
 *
 * 将任意抛出的值归一化为表达式失败的 CoreError。
 */
function toExpressionError(error: unknown, details: Record<string, unknown>): CoreError {
  if (error instanceof CoreError) {
    return error;
  }

  if (isMissingExpressionValueError(error)) {
    return new CoreError('expression_evaluation_failed', {
      'message': error.message,
      'details': {
        ...details,
        'expression': error.details.expression,
        'segment': error.details.segment,
      },
    });
  }

  if (error instanceof Error) {
    return new CoreError('expression_evaluation_failed', {
      'message': error.message,
      details,
    });
  }

  return new CoreError('expression_evaluation_failed', {
    'message': 'Expression evaluation failed.',
    details,
  });
}

/**
 * Type-guard: check whether a value conforms to the JsonValue type.
 *
 * 类型守卫：检查值是否符合 JsonValue 类型。
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item));
  }

  return false;
}

/**
 * Type-guard: check whether a value is a plain object (not array, not null).
 *
 * 类型守卫：检查值是否为普通对象（非数组、非 null）。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Type-guard: check whether an unknown value is a MissingExpressionValueError.
 *
 * 类型守卫：检查未知值是否为 MissingExpressionValueError。
 */
function isMissingExpressionValueError(error: unknown): error is MissingExpressionValueError {
  return error instanceof MissingExpressionValueError;
}
