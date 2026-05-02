/**
 * AST node types and the syntax error class for SOP expressions.
 *
 * SOP 表达式 AST 节点类型与语法错误类。
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
