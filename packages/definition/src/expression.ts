/**
 * Expression parser for `${...}` templates embedded in SOP definitions.
 *
 * 用于解析 SOP 定义中 `${...}` 模板表达式的轻量解析器。
 */
import {JsonValue} from './json_value.js';

/**
 * Literal expression node.
 *
 * 字面量表达式节点。
 *
 * @public
 */
export interface ExpressionLiteral {
  /** Discriminant for literal expression nodes. 字面量表达式节点的类型标识。 */
  kind: 'literal';
  /** Parsed JSON-compatible literal value. 解析后的 JSON 兼容字面量值。 */
  value: JsonValue;
}

/**
 * Reference expression node that points to run input or step data.
 *
 * 指向运行输入或步骤数据的引用表达式节点。
 *
 * @public
 */
export interface ExpressionReference {
  /** Discriminant for reference expression nodes. 引用表达式节点的类型标识。 */
  kind: 'reference';
  /** Source namespace referenced by the expression. 表达式引用的数据来源命名空间。 */
  source: 'run_input' | 'step_output' | 'step_artifacts';
  /** Step id for step-scoped references. 仅步骤级引用需要的步骤标识。 */
  step_id?: string;
  /** Field path segments after the source prefix. 去除来源前缀后的字段路径片段。 */
  path: string[];
  /** Original normalized source text for diagnostics. 供诊断复用的原始规范化表达式文本。 */
  raw: string;
}

/**
 * Fallback expression node that evaluates candidates from left to right.
 *
 * 按从左到右顺序尝试候选值的回退表达式节点。
 *
 * @public
 */
export interface CoalesceExpression {
  /** Discriminant for coalesce expressions. coalesce 表达式节点的类型标识。 */
  kind: 'coalesce';
  /** Candidate expressions evaluated from left to right. 从左到右依次求值的候选表达式。 */
  expressions: ExpressionNode[];
}

/**
 * Supported AST node types for SOP expressions.
 *
 * SOP 表达式支持的抽象语法树节点类型。
 *
 * @public
 */
export type ExpressionNode = CoalesceExpression | ExpressionLiteral | ExpressionReference;

/**
 * Template segment that holds a parsed expression.
 *
 * 保存已解析表达式的模板片段。
 *
 * @public
 */
export interface ExpressionSegment {
  /** Segment type for an embedded expression. 表示模板中的表达式片段。 */
  kind: 'expression';
  /** Parsed AST for the embedded expression body. 内嵌表达式主体解析后的 AST。 */
  expression: ExpressionNode;
}

/**
 * Template segment that preserves literal text.
 *
 * 保留原始文本的模板片段。
 *
 * @public
 */
export interface TextSegment {
  /** Segment type for raw template text. 表示模板中的普通文本片段。 */
  kind: 'text';
  /** Verbatim text content outside of `${...}` blocks. `${...}` 之外保留的原始文本。 */
  value: string;
}

/**
 * Segment union returned by {@link parseExpressionTemplate}.
 *
 * {@link parseExpressionTemplate} 返回的模板片段联合类型。
 *
 * @public
 */
export type TemplateSegment = ExpressionSegment | TextSegment;

/**
 * Syntax error raised while parsing template expressions.
 *
 * 模板表达式解析期间抛出的语法错误。
 *
 * @public
 */
export class ExpressionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionSyntaxError';
  }
}

/**
 * Split a template string into text and expression segments.
 *
 * 把模板字符串拆分为普通文本片段与表达式片段。
 *
 * @param template - Raw template string containing zero or more `${...}` sections.
 * 包含零个或多个 `${...}` 片段的原始模板字符串。
 * @returns Parsed segment list in source order.
 * 按源码顺序排列的解析后片段列表。
 *
 * @public
 */
export function parseExpressionTemplate(template: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let cursor = 0;

  while (cursor < template.length) {
    const start = template.indexOf('${', cursor);
    if (start === -1) {
      if (cursor < template.length) {
        segments.push({
          'kind': 'text',
          'value': template.slice(cursor),
        });
      }
      break;
    }

    if (start > cursor) {
      segments.push({
        'kind': 'text',
        'value': template.slice(cursor, start),
      });
    }

    const end = findTemplateExpressionEnd(template, start + 2);
    const body = template.slice(start + 2, end).trim();
    segments.push({
      'kind': 'expression',
      'expression': parseExpressionBody(body),
    });
    cursor = end + 1;
  }

  if (segments.length === 0) {
    return [{
      'kind': 'text',
      'value': template,
    }];
  }

  return segments;
}

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
 * Find the closing brace for a `${...}` expression while respecting nesting.
 *
 * 在考虑引号与嵌套结构的前提下定位 `${...}` 的结束大括号。
 *
 * @param template - Whole template string being parsed.
 * 当前正在解析的完整模板字符串。
 * @param start - Cursor position immediately after the opening `${`.
 * 起始游标位置，位于 `${` 之后。
 * @returns Index of the matching closing brace.
 * 与之匹配的结束大括号下标。
 * @throws {@link ExpressionSyntaxError}
 * 当表达式未闭合或出现非法括号配对时抛出。
 */
function findTemplateExpressionEnd(template: string, start: number): number {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let cursor = start; cursor < template.length; cursor += 1) {
    const char = template[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
      continue;
    }

    if (char === ')') {
      if (parenDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected ')' in template: ${template}`);
      }
      parenDepth -= 1;
      continue;
    }

    if (char === '[') {
      bracketDepth += 1;
      continue;
    }

    if (char === ']') {
      if (bracketDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected ']' in template: ${template}`);
      }
      bracketDepth -= 1;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      continue;
    }

    if (char === '}') {
      if (braceDepth > 0) {
        braceDepth -= 1;
        continue;
      }
      if (parenDepth === 0 && bracketDepth === 0) {
        return cursor;
      }
    }
  }

  throw new ExpressionSyntaxError(`Unclosed expression in template: ${template}`);
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

/**
 * Split `coalesce(...)` arguments without breaking nested JSON or function calls.
 *
 * 拆分 `coalesce(...)` 参数，同时避免误切分嵌套 JSON 或函数调用。
 *
 * @param value - Raw comma-separated argument list inside `coalesce(...)`.
 * `coalesce(...)` 内部原始的逗号分隔参数串。
 * @returns Parsed top-level argument strings.
 * 解析得到的顶层参数字符串列表。
 * @throws {@link ExpressionSyntaxError}
 * 当参数存在空项或括号结构不平衡时抛出。
 */
function splitTopLevelArguments(value: string): string[] {
  const parts: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: '"' | '\'' | null = null;
  let escaped = false;
  let tokenStart = 0;

  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
      continue;
    }

    if (char === ')') {
      if (parenDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected ')' in coalesce expression: ${value}`);
      }
      parenDepth -= 1;
      continue;
    }

    if (char === '[') {
      bracketDepth += 1;
      continue;
    }

    if (char === ']') {
      if (bracketDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected ']' in expression: ${value}`);
      }
      bracketDepth -= 1;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      continue;
    }

    if (char === '}') {
      if (braceDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected '}' in expression: ${value}`);
      }
      braceDepth -= 1;
      continue;
    }

    if (char === ',' && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      const part = value.slice(tokenStart, cursor).trim();
      if (part.length === 0) {
        throw new ExpressionSyntaxError(`Empty coalesce argument: ${value}`);
      }
      parts.push(part);
      tokenStart = cursor + 1;
    }
  }

  if (quote !== null || braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) {
    throw new ExpressionSyntaxError(`Unbalanced expression: ${value}`);
  }

  const last = value.slice(tokenStart).trim();
  if (last.length === 0 && parts.length > 0) {
    throw new ExpressionSyntaxError(`Empty coalesce argument: ${value}`);
  }
  if (last.length > 0) {
    parts.push(last);
  }

  return parts;
}
