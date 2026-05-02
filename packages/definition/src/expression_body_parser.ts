/**
 * Parse a single expression body into an AST node.
 *
 * 将单个表达式主体解析为 AST 节点。
 */
import {JsonValue} from './json_value.js';
import {ExpressionNode, ExpressionSyntaxError} from './expression_ast.js';
import {splitTopLevelArguments} from './expression_argument_splitter.js';

/**
 * Parse a single expression body into an AST node.
 *
 * 将单个表达式主体解析为 AST 节点。
 *
 * @param body - Raw expression body without the surrounding `${` and `}`.
 * 不包含外围 `${` 与 `}` 的表达式主体文本。
 * @returns Parsed expression node.
 * 解析得到的表达式节点。
 * @throws {@link ExpressionSyntaxError}
 * 当表达式语法不受支持或结构不平衡时抛出。
 *
 * @public
 */
export function parseExpressionBody(body: string): ExpressionNode {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new ExpressionSyntaxError('Empty expression body.');
  }

  if (trimmed.startsWith('coalesce(')) {
    if (!trimmed.endsWith(')')) {
      throw new ExpressionSyntaxError(`Malformed coalesce expression: ${body}`);
    }

    const inner = trimmed.slice('coalesce('.length, -1);
    const parts = splitTopLevelArguments(inner);
    if (parts.length === 0) {
      throw new ExpressionSyntaxError(`coalesce() requires at least one argument: ${body}`);
    }

    return {
      'kind': 'coalesce',
      'expressions': parts.map((part) => parseExpressionBody(part)),
    };
  }

  const literal = parseLiteral(trimmed);
  if (literal !== undefined) {
    return {
      'kind': 'literal',
      'value': literal,
    };
  }

  if (trimmed.startsWith('run.input.')) {
    return {
      'kind': 'reference',
      'source': 'run_input',
      'path': parsePath(trimmed.slice('run.input.'.length), body),
      'raw': trimmed,
    };
  }

  if (trimmed.startsWith('steps.')) {
    const parts = trimmed.split('.');
    if (parts.length < 4) {
      throw new ExpressionSyntaxError(`Incomplete step reference: ${body}`);
    }

    const [, stepId, source, ...path] = parts;
    if (!stepId) {
      throw new ExpressionSyntaxError(`Step reference is missing a step id: ${body}`);
    }
    if (source !== 'output' && source !== 'artifacts') {
      throw new ExpressionSyntaxError(`Unsupported step reference source: ${body}`);
    }
    if (path.length === 0 || path.some((part) => part.length === 0)) {
      throw new ExpressionSyntaxError(`Step reference is missing a field path: ${body}`);
    }

    return {
      'kind': 'reference',
      'source': source === 'output' ? 'step_output' : 'step_artifacts',
      'step_id': stepId,
      'path': path,
      'raw': trimmed,
    };
  }

  throw new ExpressionSyntaxError(`Unsupported expression: ${body}`);
}

/**
 * Parse JSON-like literal forms supported in expressions.
 *
 * 解析表达式里支持的 JSON 风格字面量。
 *
 * @param value - Candidate literal text.
 * 待识别的字面量文本。
 * @returns Parsed literal value, or `undefined` when the text is not a supported literal.
 * 解析后的字面量值；如果文本不是支持的字面量则返回 `undefined`。
 * @throws {@link ExpressionSyntaxError}
 * 当 JSON 形式的字面量无法被正确解析时抛出。
 */
function parseLiteral(value: string): JsonValue | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null') {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('[') && value.endsWith(']'))
    || (value.startsWith('{') && value.endsWith('}'))
  ) {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      throw new ExpressionSyntaxError(`Invalid JSON literal: ${value}`);
    }
  }

  return undefined;
}

/**
 * Parse a dotted field path and reject empty segments.
 *
 * 解析点号分隔的字段路径，并拒绝空路径片段。
 *
 * @param value - Raw dotted path text.
 * 原始点号路径文本。
 * @param body - Original expression body used to construct diagnostics.
 * 用于生成错误信息的原始表达式主体。
 * @returns Parsed path segments.
 * 解析后的路径片段数组。
 * @throws {@link ExpressionSyntaxError}
 * 当路径中存在空片段时抛出。
 */
function parsePath(value: string, body: string): string[] {
  const path = value.split('.');
  if (path.length === 0 || path.some((part) => part.length === 0)) {
    throw new ExpressionSyntaxError(`Reference is missing a field path: ${body}`);
  }

  return path;
}
